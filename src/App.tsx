import { useCallback, useEffect, useState } from 'react'
import { useAppData } from './state/useAppData.ts'
import { OverviewPage } from './pages/Overview.tsx'
import { PlanPage } from './pages/Plan.tsx'
import { LedgerPage } from './pages/Ledger.tsx'
import { useDrafts } from './state/useDrafts.ts'
import { RecordEditor } from './components/RecordEditor.tsx'
import { Icon } from './components/Icon.tsx'
import { Sheet } from './components/ui.tsx'
import { createRecord, recordTable, saveRecord, KIND_LABEL } from './core/ledger.ts'
import type { RecordForm, RecordKind, RecordRequest, LedgerRow } from './core/ledger.ts'
import { MorePage } from './pages/More.tsx'
import { fetchEtfPrices, fetchDailyClose } from './net/quotes.ts'
import { currentPeriod } from './core/types.ts'

const TABS = [
  { key: 'overview', label: '总览' }, { key: 'plan', label: '计划' },
  { key: 'records', label: '记录' }, { key: 'settings', label: '设置' }
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const app = useAppData()
  const drafts = useDrafts()
  const [tab, setTab] = useState<TabKey>('overview')
  const [picker, setPicker] = useState(false)
  const [editor, setEditor] = useState<RecordRequest & { form: RecordForm }>()
  const [conflict, setConflict] = useState<RecordRequest>()
  const [settingsSection, setSettingsSection] = useState<string>()
  const [recordFocus, setRecordFocus] = useState<string>()
  const [quoting, setQuoting] = useState(false)
  const [quoteMessage, setQuoteMessage] = useState<{ kind: 'ok' | 'err'; text: string } | undefined>(undefined)

  // 离开页面前把防抖窗口里的改动落盘，避免切走时丢掉最后几秒的输入
  useEffect(() => {
    const handler = () => {
      void app.flush().catch(() => undefined)
    }
    window.addEventListener('pagehide', handler)
    document.addEventListener('visibilitychange', handler)
    return () => {
      window.removeEventListener('pagehide', handler)
      document.removeEventListener('visibilitychange', handler)
    }
  }, [app.flush])

  /**
   * 更新行情。
   *
   * 两路数据：ETF 现价用日线（同时给出交易日日期），标普500 收盘写回本月回撤计划。
   * 单只失败不影响其它——能更新几只就先更新几只。
   */
  const refreshQuotes = useCallback(async () => {
    setQuoting(true)
    setQuoteMessage(undefined)
    try {
      const symbols = app.data.etfs.map(e => e.symbol)
      const { updates, errors } = await fetchEtfPrices(symbols)

      // 标普500 收盘单独取：它填进回撤计划，不进 ETF 清单
      let spx: { price: number; date?: string } | undefined
      let spxError: string | undefined
      try {
        const spBar = await fetchDailyClose('^GSPC')
        if (spBar) spx = { price: spBar.close, date: spBar.date }
        else spxError = '标普500 日线没有返回数据'
      } catch (error) {
        spxError = error instanceof Error ? error.message : String(error)
      }

      const at = new Date().toISOString()
      const period = currentPeriod()

      app.update(current => {
        const etfs = current.etfs.map(etf => {
          const hit = updates.find(u => u.symbol === etf.symbol)
          return hit ? { ...etf, price: hit.price, priceDate: hit.date ?? etf.priceDate } : etf
        })

        // 只写入本月，不凭空造出新月份；
        // 用户手工核对过的月份（spManual）不覆盖——对应原表「已完成月的收盘观察不要覆盖」。
        const planMonths = spx
          ? current.planMonths.some(m => m.period === period)
            ? current.planMonths.map(m =>
                m.period === period && !m.spManual
                  ? { ...m, spClose: spx.price, observedDate: spx.date }
                  : m
              )
            : [...current.planMonths, { period, spClose: spx.price, observedDate: spx.date }]
          : current.planMonths

        return {
          ...current,
          etfs,
          planMonths,
          settings: {
            ...current.settings,
            lastQuoteAt: at,
            lastQuoteSource: 'qt.gtimg.cn'
          }
        }
      })

      const parts: string[] = []
      if (updates.length) {
        parts.push(`已更新 ${updates.map(u => `${u.symbol} ${u.price}`).join('、')}`)
      }
      if (spx) parts.push(`标普500 收盘 ${spx.price}（${spx.date ?? '日期未知'}）`)
      const problems = [...errors, ...(spxError ? [`标普500：${spxError}`] : [])]

      if (parts.length === 0) {
        setQuoteMessage({ kind: 'err', text: `行情更新失败：${problems.join('；') || '未取到任何数据'}` })
      } else {
        setQuoteMessage({
          kind: problems.length ? 'err' : 'ok',
          text: `${parts.join('；')}${problems.length ? `\n未成功：${problems.join('；')}` : ''}`
        })
      }
    } catch (error) {
      setQuoteMessage({ kind: 'err', text: `行情更新失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setQuoting(false)
    }
  }, [app])

  function openRecord(request: RecordRequest, ignoreDraft = false) {
    const draft = drafts.drafts[request.kind]
    if (!ignoreDraft && draft && ((request.id && request.id !== draft.form.id) || (request.symbol && request.symbol !== draft.form.symbol) || (request.date && request.date !== draft.form.date))) { setConflict(request); return }
    const record = request.id ? app.data[recordTable(request.kind)].find(r => r.id === request.id) : undefined
    const resumed = !ignoreDraft && draft && (!request.id || request.id === draft.form.id)
    const form = resumed ? draft.form : record ?? { ...createRecord(app.data, request.kind), ...(request.symbol ? { symbol: request.symbol } : {}), ...(request.date ? { date: request.date } : {}) }
    setPicker(false)
    setEditor({ ...request, referenceAmount: resumed || record ? undefined : request.referenceAmount, form })
  }

  const showRecord = (row: LedgerRow) => { setRecordFocus(`${row.kind}:${row.id}`); setTab('records') }
  if (app.loading || drafts.loading) return <div className="center">正在读取本机账本…</div>
  if (app.loadError || drafts.loadError) return <div className="app"><div className="banner err">读取失败：{app.loadError ?? drafts.loadError}。尚未覆盖任何数据，请保留网站数据并重试。</div><button onClick={() => location.reload()}>重新读取</button></div>

  return <div className="app">
    <header className="topbar"><div><p className="app-label">我的投资</p><h1>{TABS.find(t => t.key === tab)?.label}</h1></div><div className="header-actions">{app.saving && <span className="save-indicator" role="status">保存中</span>}<button className="icon-button" aria-label="记一笔" onClick={() => setPicker(true)}><Icon name="plus" /></button></div></header>
    {app.saveError && <div className="banner err" role="alert">保存失败：{app.saveError}。请先导出备份，或<button onClick={() => void app.flush().catch(() => undefined)}>重试保存</button></div>}
    {drafts.error && <div className="banner err" role="alert">草稿尚未保存：{drafts.error}。请保留页面，在表单中继续填写以重试。</div>}
    {quoteMessage && tab !== 'settings' && <div className={`banner ${quoteMessage.kind}`} role="status">{quoteMessage.text}</div>}
    {app.busy && <div className="busy-overlay" role="status">正在保存账本与恢复点…</div>}
    {tab === 'overview' && <OverviewPage data={app.data} update={app.update} onGoToPlan={() => setTab('plan')} onGoToTrades={() => openRecord({ kind: 'buy' })} refreshQuotes={refreshQuotes} quoting={quoting} onOpenRecord={showRecord} />}
    {tab === 'plan' && <PlanPage data={app.data} update={app.update} onRecord={openRecord} onSettings={() => { setSettingsSection('strategy'); setTab('settings') }} />}
    {tab === 'records' && <LedgerPage data={app.data} drafts={drafts.drafts} focus={recordFocus} onEdit={openRecord} onDelete={async row => {
      if (row.kind === 'batch') return
      const table = recordTable(row.kind)
      app.update(c => ({ ...c, [table]: c[table].filter(r => r.id !== row.id) }))
      await app.flush()
    }} />}
    {tab === 'settings' && <MorePage key={settingsSection ?? 'main'} initialSection={settingsSection} data={app.data} update={app.update} importData={app.importData} snapshots={app.snapshots} rollback={app.rollback} resetAll={app.resetAll} refreshQuotes={refreshQuotes} quoting={quoting} quoteMessage={quoteMessage} />}
    <nav className="tabbar" aria-label="主导航">{TABS.map(t => <button key={t.key} aria-current={tab === t.key ? 'page' : undefined} className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); setRecordFocus(undefined); setSettingsSection(undefined); window.scrollTo(0, 0) }}><Icon name={t.key === 'settings' ? 'settings' : t.key} /><span>{t.label}</span></button>)}</nav>
    {picker && <Sheet title="记一笔" onClose={() => setPicker(false)}><p className="page-caption">选择要记录的类型</p><div className="entry-grid">{(Object.keys(KIND_LABEL).filter(k => k !== 'batch') as RecordKind[]).map(kind => <button key={kind} onClick={() => openRecord({ kind })}><strong>{KIND_LABEL[kind]}</strong><small>{drafts.drafts[kind] ? '有未完成草稿' : ({ buy: '记录实际成交', sell: '记录卖出成交', dividend: '记录税后收入', fx: '记录币种兑换', transfer: '记录资金汇入', withdrawal: '记录资金汇出' })[kind]}</small></button>)}</div></Sheet>}
    {conflict && <Sheet title="已有一份未完成草稿" onClose={() => setConflict(undefined)}><p>这类记录已保存另一份草稿。可以先继续填写，或明确放弃后编辑当前记录。</p><div className="btn-row"><button onClick={() => { const kind = conflict.kind; setConflict(undefined); openRecord({ kind }) }}>继续原草稿</button><button className="danger" onClick={() => { const next = conflict; void drafts.put(next.kind).then(() => { setConflict(undefined); openRecord(next, true) }).catch(() => undefined) }}>{conflict.id ? '放弃草稿并编辑' : '放弃草稿并新建'}</button></div></Sheet>}
    {editor && <RecordEditor key={`${editor.kind}:${editor.form.id}`} data={app.data} kind={editor.kind} initial={editor.form} referenceAmount={editor.referenceAmount} draftSaving={drafts.saving} draftError={drafts.error}
      onDraft={form => { void drafts.put(editor.kind, form).catch(() => undefined) }} onClose={() => setEditor(undefined)} onDiscard={async () => { await drafts.put(editor.kind); setEditor(undefined) }}
      onSave={async form => { app.update(c => saveRecord(c, editor.kind, form)); await app.flush(); await drafts.put(editor.kind); setEditor(undefined) }} />}
  </div>
}
