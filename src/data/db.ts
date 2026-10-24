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

import { emptyData } from '../core/empty.ts'
import type { AppData, Snapshot } from '../core/types.ts'
import { today } from '../core/types.ts'
import { retainSnapshots, validateBackup } from '../core/backup.ts'
import type { RecordForm, RecordKind } from '../core/ledger.ts'

const DB_NAME = 'etf-tracker'
const DB_VERSION = 1
const STORE = 'state'
const KEY = 'main'

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
 * 仅首次使用返回空白账本；读取失败必须交给界面提示，避免覆盖旧数据。
 */
export async function loadData(): Promise<AppData> {
  const db = await openDb()
  const raw = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
  if (raw === undefined) return validateBackup(emptyData())
  const loaded = validateBackup(raw)
  const previous = raw as AppData
  if (previous.settings.cashUsd === undefined || previous.etfs.some(e => e.investRatio === undefined)) {
    await saveData(loaded, { data: previous, reason: '版本升级' })
  }
  return loaded
}

/** 写入账本；snapshots 不参与主记录写入（单独管理，避免把历史版本套娃写进自己）。 */
export async function saveData(data: AppData, recovery?: { data: AppData; reason: string }): Promise<void> {
  const db = await openDb()
  const existing = await listSnapshots()
  const at = new Date().toISOString()
  const label = `auto-${today()}`
  const list = existing.filter(s => s.label !== label)
  list.push({ at, label, data: stripSnapshots(data) })
  if (recovery) list.push({ at, label: `操作前-${recovery.reason}-${at}-${crypto.randomUUID()}`, data: stripSnapshots(recovery.data) })
  const { snapshots: _ignored, ...rest } = data
  void _ignored
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(rest, KEY)
  tx.objectStore(STORE).put(retainSnapshots(list), 'snapshots')
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('保存事务被取消'))
  })
}

/** 本机自动快照与操作前恢复点，与主账本使用同一数据库。 */
export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDb()
  const raw = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get('snapshots'))
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Snapshot => Boolean(s) && typeof s === 'object' && 'data' in s && 'label' in s)
    .map(s => ({ at: String(s.at ?? ''), label: String(s.label ?? ''), data: s.data }))
}

export async function restoreSnapshot(label: string): Promise<AppData | undefined> {
  const list = await listSnapshots()
  const hit = list.find(s => s.label === label)
  return hit ? validateBackup(hit.data) : undefined
}

export function stripSnapshots(data: AppData): AppData {
  const { snapshots: _ignored, ...rest } = data
  void _ignored
  return rest as AppData
}

export type Drafts = Partial<Record<RecordKind, { form: RecordForm; at: string }>>

export async function loadDrafts(): Promise<Drafts> {
  const db = await openDb()
  const raw = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get('drafts'))
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('草稿格式不正确，请保留网站数据后重试。')
  return raw as Drafts
}

export async function saveDrafts(drafts: Drafts): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(drafts, 'drafts')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('草稿保存被取消'))
  })
}
