import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData, Snapshot } from '../core/types.ts'
import { emptyData, normalizeData } from '../core/empty.ts'
import { validateBackup } from '../core/backup.ts'
import { listSnapshots, loadData, restoreSnapshot, saveData } from '../data/db.ts'

/** 串行保存最新状态；失败时保留内存账本与操作前恢复点，允许重试。 */
export function useAppData() {
  const [data, setData] = useState<AppData>(() => emptyData())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [savedAt, setSavedAt] = useState<string>()
  const latest = useRef(data)
  const ready = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const recovery = useRef<{ data: AppData; reason: string } | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadData(), listSnapshots()]).then(([loaded, history]) => {
      if (cancelled) return
      latest.current = loaded
      setData(loaded)
      setSnapshots(history)
      ready.current = true
      setLoading(false)
    }).catch(error => {
      if (cancelled) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const flush = useCallback(async () => {
    if (!ready.current) return
    if (timer.current) clearTimeout(timer.current)
    const next = latest.current
    let before: typeof recovery.current
    setSaving(true)
    const write = writes.current.then(() => {
      before = recovery.current
      return saveData(next, before)
    })
    writes.current = write.catch(() => undefined)
    try {
      await write
      setSnapshots(await listSnapshots())
      if (latest.current === next) {
        if (recovery.current === before) recovery.current = undefined
        setSavedAt(new Date().toISOString())
        setSaveError(undefined)
        setSaving(false)
      }
    } catch (error) {
      recovery.current ??= before
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
      throw error
    }
  }, [])

  const update = useCallback((mutate: (current: AppData) => AppData) => {
    if (!ready.current) return
    const before = latest.current
    const next = normalizeData(mutate(before))
    const removed = (['trades', 'fxRecords', 'transfers', 'withdrawals', 'dividends', 'batches'] as const)
      .some(key => before[key].some(row => !next[key].some(item => item.id === row.id)))
    if (removed && !recovery.current) recovery.current = { data: before, reason: '删除记录' }
    latest.current = next
    setData(next)
    setSaving(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => undefined) }, 200)
  }, [flush])

  const replace = useCallback(async (next: AppData, reason: string) => {
    if (!ready.current) throw new Error('账本尚未就绪，请稍后重试。')
    const pending = flush()
    ready.current = false
    setBusy(true)
    try {
      await pending
      await saveData(next, { data: latest.current, reason })
      latest.current = next
      setData(next)
      setSnapshots(await listSnapshots())
      setSavedAt(new Date().toISOString())
      setSaveError(undefined)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      ready.current = true
      setBusy(false)
    }
    return next
  }, [flush])

  const importData = useCallback((incoming: unknown) => replace(validateBackup(incoming), '导入备份'), [replace])
  const rollback = useCallback(async (label: string) => {
    const restored = await restoreSnapshot(label)
    if (!restored) throw new Error('找不到这份快照，请重新打开更多页。')
    await replace(restored, '回滚')
    return true
  }, [replace])
  const resetAll = useCallback(async () => { await replace(emptyData(), '重新开始') }, [replace])

  return { data, loading, loadError, saveError, saving, busy, snapshots, savedAt, update, importData, rollback, resetAll, flush }
}
