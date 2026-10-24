import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDrafts, saveDrafts } from '../data/db.ts'
import type { Drafts } from '../data/db.ts'
import type { RecordForm, RecordKind } from '../core/ledger.ts'

export function useDrafts() {
  const [drafts, setDrafts] = useState<Drafts>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const latest = useRef<Drafts>({})
  const queue = useRef<Promise<void>>(Promise.resolve())
  const ready = useRef(false)
  useEffect(() => {
    let cancelled = false
    void loadDrafts().then(value => {
      if (cancelled) return
      latest.current = value
      setDrafts(value)
      ready.current = true
      setLoading(false)
    }).catch(e => { if (!cancelled) { setLoadError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const put = useCallback((kind: RecordKind, form?: RecordForm) => {
    if (!ready.current) return Promise.reject(new Error('草稿尚未读完，请重新打开页面。'))
    const next = { ...latest.current }
    if (form) next[kind] = { form, at: new Date().toISOString() }
    else delete next[kind]
    latest.current = next
    setDrafts(next)
    setSaving(true)
    const write = queue.current.catch(() => undefined).then(() => saveDrafts(next))
    queue.current = write
    void write.then(() => {
      if (latest.current === next) { setSaving(false); setError(undefined) }
    }).catch(e => { setSaving(false); setError(e instanceof Error ? e.message : String(e)) })
    return write
  }, [])
  return { drafts, loading, loadError, error, saving, put }
}
