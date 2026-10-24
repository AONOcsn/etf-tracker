import { useEffect, useMemo, useState } from 'react'
import type { AppData } from '../core/types.ts'
import { KIND_LABEL, filterLedger, ledgerRows } from '../core/ledger.ts'
import type { LedgerRow, RecordRequest, RecordKind } from '../core/ledger.ts'
import type { Drafts } from '../data/db.ts'
import { Card, Empty, Field, Row, Sheet, StatusBadge } from '../components/ui.tsx'
import { Icon } from '../components/Icon.tsx'

export function LedgerPage({ data, drafts, focus, onEdit, onDelete }: {
  data: AppData; drafts: Drafts; focus?: string; onEdit: (request: RecordRequest) => void
  onDelete: (row: LedgerRow) => Promise<void>
}) {
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState('')
  const [symbol, setSymbol] = useState('')
  const [account, setAccount] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [selected, setSelected] = useState<string>()
  useEffect(() => { if (focus) setSelected(focus) }, [focus])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const rows = useMemo(() => ledgerRows(data), [data])
  const visible = filterLedger(rows, { type, query, month, symbol, account })
  const detail = rows.find(r => `${r.kind}:${r.id}` === selected)
  const filters = [month, symbol, account].filter(Boolean).length
  const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
  const reset = () => { setType('all'); setMonth(''); setSymbol(''); setAccount(''); setQuery('') }

  return <>
    <p className="page-caption">所有投资流水，都在这里</p>
    {Object.keys(drafts).length > 0 && <Card title="未完成草稿" hint={`${Object.keys(drafts).length} 份`}><div className="draft-list">{(Object.keys(drafts) as RecordKind[]).map(kind => <button className="setting-link" key={kind} onClick={() => onEdit({ kind, id: drafts[kind]!.form.id })}><span>{KIND_LABEL[kind]} {drafts[kind]?.form.symbol ?? ''}<small>{new Date(drafts[kind]!.at).toLocaleString('zh-CN', { hour12: false })}</small></span><Icon name="chevron" /></button>)}</div></Card>}
    <div className="search-box"><Icon name="search" /><input aria-label="搜索记录" type="search" placeholder="搜索标的、账户或备注" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="segmented" role="group" aria-label="记录类型">{[['all', '全部'], ['trades', '成交'], ['funds', '资金'], ['dividend', '分红']].map(([key, label]) => <button key={key} aria-pressed={type === key} className={type === key ? 'active' : ''} onClick={() => setType(key)}>{label}</button>)}</div>
    <div className="filter-bar"><span>{visible.length} 笔{filters ? ` · ${[month, symbol, account].filter(Boolean).join(' / ')}` : ''}</span><button className="text-button" onClick={() => setFiltering(true)}>筛选{filters ? ` (${filters})` : ''}</button>{(filters > 0 || query || type !== 'all') && <button className="text-button" onClick={reset}>清除</button>}</div>
    {visible.length === 0 ? <Empty text={rows.length ? '没有匹配的记录，试试清除筛选。' : '还没有投资流水。点击「记一笔」开始。'} /> : <div className="timeline">{visible.map((r, i) => <div key={`${r.kind}:${r.id}`}>
      {(i === 0 || visible[i - 1].date.slice(0, 7) !== r.date.slice(0, 7)) && <h2 className="month-heading">{r.date.slice(0, 7) || '待补日期'}</h2>}
      <button className="record-row" onClick={() => { setSelected(`${r.kind}:${r.id}`); setDeleting(false); setDeleteError(undefined) }}>
        <span className={`record-symbol ${r.kind === 'dividend' ? 'income' : ''}`}>{r.symbol?.slice(0, 4) ?? KIND_LABEL[r.kind].slice(0, 2)}</span>
        <span className="record-main"><strong>{r.title}</strong><small>{r.date || '待补日期'} · {r.description}</small><StatusBadge status={r.status} /></span>
        <span className="record-amount">{r.kind === 'buy' || r.kind === 'withdrawal' ? '−' : r.kind === 'dividend' || r.kind === 'sell' ? '+' : ''}{fmt(r.amount)}<small>{r.currency}</small></span>
      </button>
    </div>)}</div>}
    {filtering && <Sheet title="筛选记录" onClose={() => setFiltering(false)}>
      <Field label="具体类型"><select value={type} onChange={e => setType(e.target.value)}><option value="all">全部</option><option value="trades">所有成交</option><option value="funds">所有资金</option>{Object.entries(KIND_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="月份"><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></Field>
      <Field label="标的"><select value={symbol} onChange={e => setSymbol(e.target.value)}><option value="">全部标的</option>{[...new Set(rows.map(r => r.symbol).filter(Boolean))].map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="账户"><select value={account} onChange={e => setAccount(e.target.value)}><option value="">全部账户</option>{[...new Set(rows.flatMap(r => r.accounts).filter(Boolean))].map(a => <option key={a}>{a}</option>)}</select></Field>
      <div className="btn-row"><button onClick={reset}>重置</button><button className="primary" onClick={() => setFiltering(false)}>查看 {visible.length} 笔记录</button></div>
    </Sheet>}
    {detail && <Sheet title={detail.title} onClose={() => setSelected(undefined)}>
      <div className="detail-amount">{fmt(detail.amount)} <small>{detail.currency}</small></div>
      <Row label="日期" value={detail.date || '待补'} />
      <StatusBadge status={detail.status} />
      {Object.entries(detail.form).filter(([key, value]) => value !== undefined && key in DETAIL_FIELDS).map(([key, value]) => <Row key={key} label={DETAIL_FIELDS[key]} value={String(value)} />)}
      {detail.effect && <details className="form-details"><summary>成本与份额变动</summary><Row label="份额变动" value={String(detail.effect.sharesDelta)} /><Row label="持仓成本变动 USD" value={fmt(detail.effect.costDelta)} />{detail.kind === 'sell' && <Row label="已实现盈亏 USD" value={fmt(detail.effect.realized)} />}<p className="note">卖出成本按移动加权平均法计算，完整持仓与盈亏请在总览核对。</p></details>}
      {detail.kind === 'batch' ? <p className="note">旧批次资料仅供查阅，完整保留在 JSON 备份中。</p> : <>
        {deleteError && <div className="banner err">{deleteError}</div>}
        {deleting && <div className="banner info">确认删除这笔记录？删除前会保留恢复点。<div className="btn-row"><button className="danger" onClick={() => void onDelete(detail).then(() => setSelected(undefined)).catch(e => setDeleteError(String(e)))}>确认删除</button><button onClick={() => setDeleting(false)}>取消删除</button></div></div>}
        <div className="btn-row"><button className="danger" onClick={() => setDeleting(true)}>删除</button><button className="primary" onClick={() => { onEdit({ kind: detail.kind as RecordKind, id: detail.id }); setSelected(undefined) }}>编辑记录</button></div>
      </>}
    </Sheet>}
  </>
}

const DETAIL_FIELDS: Record<string, string> = { symbol: '标的', amount: '成交／汇出本金', shares: '份额', fee: '手续费／费用', purpose: '买入用途', gross: '税前分红', tax: '预扣税', fromAccount: '汇出账户', toAccount: '收款账户', fromCurrency: '付币', toCurrency: '收币', currency: '币种', received: '实际收到', receivedDate: '到账日期', feeAmount: '另付费用', feeCurrency: '另付费币种', ref: '流水／关联编号', note: '备注', rmbPrincipal: '购汇本金 RMB', hkdBought: '购得 HKD', extraFeeRmb: '额外费用 RMB', sentHkd: '国内汇出 HKD', hsbcInHkd: '汇丰到账 HKD', hsbcOutHkd: '汇丰汇出 HKD', hkdFee: '另扣费用 HKD', usdReceived: '嘉信到账 USD', usdDate: '美元到账日期' }
