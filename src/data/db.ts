/**
 * 数据持久化：IndexedDB 单 store 快照模型。
 *
 * 为什么是 IndexedDB 而不是 localStorage：账本会随年份增长，
 * localStorage 在 iOS Safari 上有 5MB 级别的限制，存满之后写入会直接抛错，
 * 表现为「明明点了保存但数据没进去」。IndexedDB 配额宽得多。
 *
 * 写入策略：整份 AppData 作为一个对象存进单一 key。账本量级是几百条，
 * 整存整取最简单也最不容易写坏；改成逐条 store 反而要处理大量同步逻辑。
 */

import { emptyData, normalizeData } from '../core/empty.ts'
import type { AppData, Snapshot } from '../core/types.ts'
import { today } from '../core/types.ts'

const DB_NAME = 'etf-tracker'
const DB_VERSION = 1
const STORE = 'state'
const KEY = 'main'

/** 自动快照保留份数。 */
const MAX_SNAPSHOTS = 7

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | undefined

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  return dbPromise
}

/**
 * 读取账本。
 * 任何异常（浏览器禁用存储、配额问题、数据损坏）都退回空白账本，
 * 宁可让用户看到一张空表，也不要直接白屏。
 */
export async function loadData(): Promise<AppData> {
  try {
    const db = await openDb()
    const raw = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
    return raw === undefined ? emptyData() : normalizeData(raw)
  } catch {
    return emptyData()
  }
}

/** 写入账本；snapshots 不参与主记录写入（单独管理，避免把历史版本套娃写进自己）。 */
export async function saveData(data: AppData): Promise<void> {
  const db = await openDb()
  const { snapshots: _ignored, ...rest } = data
  void _ignored
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(rest, KEY)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * 每天保留一份自动快照，最多 MAX_SNAPSHOTS 份。
 *
 * 这一层是 IndexedDB 之外的第二道保险：误删一行、误清空账面之后，
 * 还能在设置页回滚到当天早些时候的状态。
 */
export async function saveSnapshot(data: AppData): Promise<Snapshot[]> {
  const db = await openDb()
  const list = await listSnapshots()
  const label = `auto-${today()}`
  const entry: Snapshot = { at: new Date().toISOString(), label, data: stripSnapshots(data) }

  const existingIndex = list.findIndex(s => s.label === label)
  if (existingIndex >= 0) list[existingIndex] = entry
  else list.push(entry)

  // 只保留最近 MAX_SNAPSHOTS 份
  const trimmed = list.slice(-MAX_SNAPSHOTS)
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(trimmed, 'snapshots')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return trimmed
}

export async function listSnapshots(): Promise<Snapshot[]> {
  try {
    const db = await openDb()
    const raw = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get('snapshots'))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((s): s is Snapshot => Boolean(s) && typeof s === 'object' && 'data' in s && 'label' in s)
      .map(s => ({ at: String(s.at ?? ''), label: String(s.label ?? ''), data: normalizeData(s.data) }))
  } catch {
    return []
  }
}

export async function restoreSnapshot(label: string): Promise<AppData | undefined> {
  const list = await listSnapshots()
  const hit = list.find(s => s.label === label)
  return hit ? normalizeData(hit.data) : undefined
}

/** 清空本机全部数据（含快照）。用于「重新开始」。 */
export async function clearAll(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  await request(tx.objectStore(STORE).clear())
}

export function stripSnapshots(data: AppData): AppData {
  const { snapshots: _ignored, ...rest } = data
  void _ignored
  return rest as AppData
}
