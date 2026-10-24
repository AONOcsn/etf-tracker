import { useMemo, useState } from 'react'
import { Card, Empty, Field, NumberInput, Row, Sheet, StatusBadge } from '../components/ui.tsx'
import { MarketLine } from '../components/MarketClock.tsx'
import type { AppData } from '../core/types.ts'
import { today } from '../core/types.ts'
import { computeHoldings } from '../core/holdings.ts'
import { computeOverview } from '../core/overview.ts'
import { planning } from '../core/planning.ts'
import { ledgerRows } from '../core/ledger.ts'
import type { LedgerRow } from '../core/ledger.ts'
import { computeDividends, computeFx, computeTransfers, netDividendsTotal, receivedUsdTotal } from '../core/funds.ts'

export function OverviewPage({ data, update, onGoToPlan, onGoToTrades, refreshQuotes, quoting, onOpenRecord }: {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  onGoToPlan: () => void
  onGoToTrades: () => void
  refreshQuotes: () => Promise<void>
  quoting: boolean
  onOpenRecord: (row: LedgerRow) => void
}) {
  const [editingPrice, setEditingPrice] = useState<string>()
  const [editingCash, setEditingCash] = useState(false)
  const [cashInput, setCashInput] = useState<number>()
  const holdings = useMemo(() => computeHoldings(data.trades), [data.trades])
  const fx = useMemo(() => computeFx(data.fxRecords), [data.fxRecords])
  const transfers = useMemo(() => computeTransfers(data.transfers), [data.transfers])
  const dividends = useMemo(() => computeDividends(data.dividends), [data.dividends])
  const { drawdown, execution: current } = useMemo(() => planning(data), [data])
  const cash = data.settings.cashUsd ?? 0
  const pending = useMemo(() => ledgerRows(data).filter(r => r.status && !['已记录', '已计算', '已完整划转'].includes(r.status)), [data])
  const overview = useMemo(() => computeOverview({
    etfs: data.etfs, holdings, baseMonthly: data.settings.baseMonthly, cash,
    extraUsed: drawdown.usedTotal, extraTotal: data.settings.extraBudgetTotal,
    receivedUsd: receivedUsdTotal(fx, transfers), netDividends: netDividendsTotal(dividends)
  }), [data.etfs, holdings, data.settings, cash, drawdown.usedTotal, fx, transfers, dividends])
  const fmt = (n: number | undefined) => n === undefined ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pct = (n: number | undefined) => n === undefined ? '—' : `${(n * 100).toFixed(2)}%`
  const signedPct = (n: number | undefined) => n === undefined ? '—' : `${n >= 0 ? '+' : ''}${pct(n)}`
  const signed = (n: number | undefined) => n === undefined ? '—' : `${n >= 0 ? '+' : ''}${fmt(n)}`
  const tone = (n: number | undefined) => n === undefined ? undefined : n >= 0 ? 'pos' as const : 'neg' as const
  const missing = overview.rows.filter(r => r.shares > 0 && r.marketValue === undefined)

  return <>
    {data.trades.length === 0 && <div className="banner info">欢迎使用。先在「设置」确认投资参数，再记下第一笔成交。</div>}
    <Card title="券商资产" hint={missing.length ? '估值不完整' : 'USD'}>
      <div className="asset-value">{fmt(overview.totalValue)}</div>
      {missing.length > 0 && <div className="banner info">{missing.map(r => r.symbol).join('、')} 缺少价格，补齐后显示账户总值与盈亏。</div>}
      <Row label="持仓盈亏" value={`${signed(overview.totals.unrealized)} USD`} tone={tone(overview.totals.unrealized)} />
      <Row label="持仓收益率" value={overview.totals.cost ? signedPct(overview.totals.returnRate) : '—'} tone={tone(overview.totals.returnRate)} />
      <Row label="ETF 市值 / 现金" value={`${fmt(overview.totals.marketValue)} / ${fmt(cash)}`} />
      <div className="btn-row">
        <button onClick={() => void refreshQuotes()} disabled={quoting}>{quoting ? '正在更新…' : '更新行情'}</button>
        <button onClick={() => { setCashInput(cash); setEditingCash(true) }}>核对现金</button>
      </div>
      <p className="note">估值采用各持仓显示的价格日期；收益率为未实现盈亏 ÷ 持仓成本。</p>
    </Card>
    {current && <Card title="本月执行" hint={current.period}>
      <Row label="本月计划 USD" value={fmt(current.plannedTotal)} big />
      <Row label="已记录定投 USD" value={fmt(current.actualTotal)} />
      <Row label="还差 USD" value={fmt(Math.max(0, current.plannedTotal - current.actualTotal))} />
      <div className="btn-row"><button onClick={onGoToPlan}>查看计划</button><button className="primary" onClick={onGoToTrades}>记一笔成交</button></div>
      <p className="note">以已记录成交核对执行情况；请先在计划页确认观察行情。</p>
    </Card>}
    {pending.length > 0 && <Card title="待办与在途" hint={`${pending.length} 笔`}><div className="pending-list">{pending.slice(0, 3).map(r => <button key={`${r.kind}:${r.id}`} className="setting-link" onClick={() => onOpenRecord(r)}><span><strong>{r.title}</strong><small>{r.status}</small></span><span>查看 ›</span></button>)}</div></Card>}
    <MarketLine onOpen={onGoToPlan} />
    <Card title="持仓" >
      {overview.rows.filter(r => r.shares > 0).length === 0 ? <Empty text="还没有持仓" /> : <div className="list">
        {overview.rows.filter(r => r.shares > 0).map(row => <div className="item" key={row.symbol}>
          <div className="main">
            <div className="title">{row.symbol}<StatusBadge status={row.status} /></div>
            <div className="meta">{row.shares.toLocaleString('en-US', { maximumFractionDigits: 6 })} 份 · 现价 {row.price ? fmt(row.price) : '待补'}</div>
            <div className="meta">价格日期 {row.priceDate ?? '未填写'}</div>
            <details className="holding-details"><summary>成本与配置</summary>
              <div className="meta">成本 {fmt(row.cost)} · 均价 {row.avgCost ? fmt(row.avgCost) : '—'}</div>
              <div className="meta">目标 {pct(row.targetRatio)} · 占比 {pct(row.weight)} · 偏离 {signedPct(row.deviation)}</div>
            </details>
            <button className="ghost" onClick={() => setEditingPrice(row.symbol)}>修改价格</button>
          </div>
          <div className="amount"><div>{fmt(row.marketValue)}</div><div className={tone(row.unrealized)}>{signed(row.unrealized)}</div><div className={tone(row.returnRate)}>{row.cost ? signedPct(row.returnRate) : '—'}</div></div>
        </div>)}
      </div>}
    </Card>
    <details className="doc"><summary>累计与额外预算</summary>
      <Row label="持仓成本 USD" value={fmt(overview.totals.cost)} />
      <Row label="累计买入 USD" value={fmt(overview.totalBought)} />
      <Row label="到账 USD（嘉信渠道）" value={fmt(overview.receivedUsd)} />
      <Row label="税后分红 USD" value={fmt(overview.netDividends)} />
      <Row label="已实现盈亏 USD" value={fmt(overview.realized)} />
      <Row label="额外预算总额 / 已用" value={`${fmt(overview.extraBudgetTotal)} / ${fmt(overview.extraBudgetUsed)}`} />
      <Row label="额外预算剩余 USD" value={fmt(overview.extraBudgetLeft)} />
      <p className="note">到账仅统计嘉信渠道，不重复加总中转。额外预算只被真实定投成交消耗，不随反弹回补。</p>
    </details>
    {editingCash && <Sheet title="核对券商现金" onClose={() => setEditingCash(false)}>
      <Field label="券商实际现金余额 USD"><NumberInput value={cashInput} onChange={setCashInput} /></Field>
      <p className="note">按券商实际余额填写，不会自动根据流水推算。</p>
      <div className="btn-row"><button className="primary" disabled={cashInput === undefined || cashInput < 0} onClick={() => {
        update(c => ({ ...c, settings: { ...c.settings, cashUsd: cashInput, cashCheckedAt: new Date().toISOString() } }))
        setEditingCash(false)
      }}>保存现金</button><button onClick={() => setEditingCash(false)}>取消</button></div>
    </Sheet>}
    {editingPrice !== undefined && <PriceSheet symbol={editingPrice} price={data.etfs.find(e => e.symbol === editingPrice)?.price} date={data.etfs.find(e => e.symbol === editingPrice)?.priceDate}
      onClose={() => setEditingPrice(undefined)} onSave={(price, date) => {
        update(c => ({ ...c, etfs: c.etfs.some(e => e.symbol === editingPrice)
          ? c.etfs.map(e => e.symbol === editingPrice ? { ...e, price: price ?? 0, priceDate: date } : e)
          : [...c.etfs, { symbol: editingPrice, price: price ?? 0, priceDate: date, targetRatio: 0, planned: false }] }))
        setEditingPrice(undefined)
      }} />}
  </>
}

function PriceSheet({ symbol, price, date, onClose, onSave }: {
  symbol: string; price?: number; date?: string; onClose: () => void
  onSave: (price: number | undefined, date: string | undefined) => void
}) {
  const [p, setP] = useState<number | undefined>(price || undefined)
  const [d, setD] = useState(date || today())
  return <Sheet title={`${symbol} 价格`} onClose={onClose}>
    <Field label="价格 USD／份"><NumberInput value={p} onChange={setP} placeholder="0.00" /></Field>
    <Field label="价格日期"><input type="date" value={d} onChange={e => setD(e.target.value)} /></Field>
    <div className="btn-row"><button className="primary" disabled={p === undefined || p <= 0 || !d} onClick={() => onSave(p, d)}>保存价格</button><button onClick={onClose}>取消</button></div>
  </Sheet>
}
