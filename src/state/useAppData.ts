import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from '../core/types.ts'
import { emptyData, normalizeData } from '../core/empty.ts'
import { clearAll, listSnapshots, loadData, restoreSnapshot, saveData, saveSnapshot } from '../data/db.ts'
import type { Snapshot } from '../core/types.ts'

/**
 * 账本状态管理。
 *
 * 三个必须做对的地方：
 * 1. 写入防抖：录入时每敲一个字都写一次 IndexedDB 会卡，200ms 合并足够。
 * 2. 首次加载不要用空白数据覆盖已有数据：加载完成前不写盘。
 * 3. 自动快照按天存一份，误操作后还有回滚机会。
 */
export function useAppData() {
  const [data, setData] = useState<AppData>(() => emptyData())
  const [loading, setLoading] = useState(true)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)

  // 加载完成前、以及由导入／回滚直接落盘时，都不要触发防抖写盘
  const ready = useRef(false)
  const skipWrite = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [loaded, snaps] = await Promise.all([loadData(), listSnapshots()])
      if (cancelled) return
      setData(loaded)
      setSnapshots(snaps)
      ready.current = true
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready.current || skipWrite.current) {
      skipWrite.current = false
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void (async () => {
        await saveData(data)
        setSavedAt(new Date().toISOString())
        setSnapshots(await saveSnapshot(data))
      })()
    }, 200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [data])

  /** 就地修改账本。传入的函数必须返回新对象（保持不可变更新）。 */
  const update = useCallback((mutate: (current: AppData) => AppData) => {
    setData(current => normalizeData(mutate(current)))
  }, [])

  /** 导入：直接落盘，不走防抖，避免用户以为导入没生效。 */
  const importData = useCallback(async (incoming: unknown) => {
    const next = normalizeData(incoming)
    ready.current = false
    skipWrite.current = true
    await saveData(next)
    await saveSnapshot(next)
    setData(next)
    setSnapshots(await listSnapshots())
    ready.current = true
    setSavedAt(new Date().toISOString())
    return next
  }, [])

  const rollback = useCallback(async (label: string) => {
    const restored = await restoreSnapshot(label)
    if (!restored) return false
    ready.current = false
    skipWrite.current = true
    await saveData(restored)
    setData(restored)
    ready.current = true
    setSavedAt(new Date().toISOString())
    return true
  }, [])

  const resetAll = useCallback(async () => {
    await clearAll()
    const fresh = emptyData()
    ready.current = false
    skipWrite.current = true
    await saveData(fresh)
    setData(fresh)
    setSnapshots([])
    ready.current = true
  }, [])

  /** 立即落盘（用户离开页面前调用，避免防抖窗口里丢数据）。 */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    await saveData(data)
  }, [data])

  const refreshSnapshots = useCallback(async () => {
    setSnapshots(await listSnapshots())
  }, [])

  return useMemo(
    () => ({
      data,
      loading,
      snapshots,
      savedAt,
      update,
      importData,
      rollback,
      resetAll,
      flush,
      refreshSnapshots
    }),
    [data, loading, snapshots, savedAt, update, importData, rollback, resetAll, flush, refreshSnapshots]
  )
}
