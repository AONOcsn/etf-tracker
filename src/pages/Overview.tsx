import { useMemo, useState } from 'react'
import { Card, Empty, Field, NumberInput, Row, StatusBadge } from '../components/ui.tsx'
import type { AppData } from '../core/types.ts'
import { today } from '../core/types.ts'
import { computeHoldings } from '../core/holdings.ts'
import { computeOverview } from '../core/overview.ts'
import { computeDrawdown } from '../core/drawdown.ts'
import { computeDividends, computeFx, computeTransfers, netDividendsTotal, receivedUsdTotal } from '../core/funds.ts'

/**
 * 总览页：等价于原表「总览」工作表。
 *
 * 数据来自其它表的实时重算，所以任何一处录入都会立刻反映到这里，
 * 不像 Excel 需要手动重算。
 */
export function OverviewPage({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [editingPrice, setEditingPrice] = useState<string | undefined>(undefined)

  const holdings = useMemo(() => computeHoldings(data.trades), [data.trades])
  const fx = useMemo(() => computeFx(data.fxRecords), [data.fxRecords])
  const transfers = useMemo(() => computeTransfers(data.transfers), [data.transfers])
  const dividends = useMemo(() => computeDividends(data.dividends), [data.dividends])
  const drawdown = useMemo(
    () => computeDrawdown({ months: data.planMonths, settings: data.settings, trades: data.trades }),
    [data.planMonths, data.settings, data.trades]
  )

  const overview = useMemo(
    () =>
      computeOverview({
        etfs: data.etfs,
        holdings,
        baseMonthly: data.settings.baseMonthly,
        cash: data.etfs.reduce((s, e) => s + (e.cash ?? 0), 0),
        extraUsed: drawdown.usedTotal,
        extraTotal: data.settings.extraBudgetTotal,
        receivedUsd: receivedUsdTotal(fx, transfers),
        netDividends: netDividendsTotal(dividends)
      }),
    [data.etfs, data.settings, holdings, drawdown.usedTotal, fx, transfers, dividends]
  )

  const cash = data.etfs.reduce((s, e) => s + (e.cash ?? 0), 0)
  const noHoldings = data.trades.length === 0

  function setPrice(symbol: string, price: number | undefined, date: string | undefined) {
    update(current => ({
      ...current,
      etfs: current.etfs.map(e => (e.symbol === symbol ? { ...e, price: price ?? 0, priceDate: date } : e))
    }))
  }

  function setCash(value: number | undefined) {
    // 现金统一记在第一个 ETF 行上，避免引入一个新的「账户」概念
    const first = data.etfs[0]?.symbol
    if (!first) return
    update(current => ({
      ...current,
      etfs: current.etfs.map(e => (e.symbol === first ? { ...e, cash: value ?? 0 } : { ...e, cash: e.cash ?? 0 }))
    }))
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`

  return (
    <>
      {noHoldings && (
        <div className="banner info">
          这是空白账本。先到「设置」确认基础月投、额外预算与目标比例，然后去「交易」记第一笔买入；总览会自动算出一切。
        </div>
      )}

      <Card title="账户总值" hint="市值 ＋ 现金">
        <Row label="ETF 市值" value={fmt(overview.totals.marketValue)} big />
        <Row label="现金 USD" value={fmt(cash)} />
        <Row label="总值 USD" value={fmt(overview.totalValue)} big />
        <Field label="现金（按嘉信实际余额填写）">
          <NumberInput value={cash || undefined} onChange={setCash} placeholder="0.00" />
        </Field>
      </Card>

      <Card title="持仓" hint="移动加权平均成本">
        {overview.rows.length === 0 ? (
          <Empty text="还没有 ETF，去设置里加一只" />
        ) : (
          <div className="list">
            {overview.rows.map(row => (
              <div className="item" key={row.symbol}>
                <div className="main">
                  <div className="title">
                    {row.symbol}
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="meta">
                    份额 {row.shares.toLocaleString('en-US', { maximumFractionDigits: 6 })} · 均价{' '}
                    {row.avgCost ? fmt(row.avgCost) : '—'} · 现价 {row.price ? fmt(row.price) : '—'}
                    {row.priceDate ? `（${row.priceDate}）` : ''}
                  </div>
                  <div className="meta">
                    成本 {fmt(row.cost)} · 目标 {pct(row.targetRatio)} · 占比 {pct(row.weight)} · 偏离{' '}
                    {row.deviation >= 0 ? '+' : ''}
                    {pct(row.deviation)}
                  </div>
                  <div className="meta">
                    <button className="ghost" style={{ minHeight: 28, padding: '2px 8px', fontSize: 12 }} onClick={() => setEditingPrice(row.symbol)}>
                      改现价
                    </button>
                  </div>
                </div>
                <div className="amount">
                  <div>{fmt(row.marketValue)}</div>
                  <div className={row.unrealized >= 0 ? 'pos' : 'neg'} style={{ fontSize: 13 }}>
                    {row.unrealized >= 0 ? '+' : ''}
                    {fmt(row.unrealized)}
                  </div>
                  <div className={row.returnRate >= 0 ? 'pos' : 'neg'} style={{ fontSize: 12 }}>
                    {row.cost ? pct(row.returnRate) : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="合计">
        <Row label="持仓成本" value={fmt(overview.totals.cost)} />
        <Row label="市值" value={fmt(overview.totals.marketValue)} />
        <Row
          label="未实现盈亏"
          value={`${overview.totals.unrealized >= 0 ? '+' : ''}${fmt(overview.totals.unrealized)}`}
          tone={overview.totals.unrealized >= 0 ? 'pos' : 'neg'}
        />
        <Row label="持仓收益率" value={overview.totals.cost ? pct(overview.totals.returnRate) : '—'} />
        <p className="note">持仓收益率为未实现盈亏 ÷ 当前持仓成本，不是年化收益率。</p>
      </Card>

      <Card title="累计">
        <Row label="累计买入 USD" value={fmt(overview.totalBought)} />
        <Row label="到账 USD（嘉信渠道）" value={fmt(overview.receivedUsd)} />
        <Row label="税后分红 USD" value={fmt(overview.netDividends)} />
        <Row label="已实现盈亏 USD" value={fmt(overview.realized)} tone={overview.realized >= 0 ? 'pos' : 'neg'} />
        <p className="note">
          到账只累计真正进入嘉信渠道的美元：收币为 USD 且收款账户是嘉信证券／嘉信入金中转的换汇，加上到账账户为嘉信证券的
          USD 转账。中转步骤不重复加总。
        </p>
      </Card>

      <Card title="额外预算" hint="回撤计划">
        <Row label="预算总额 USD" value={fmt(overview.extraBudgetTotal)} />
        <Row label="已用 USD" value={fmt(overview.extraBudgetUsed)} />
        <Row label="剩余 USD" value={fmt(overview.extraBudgetLeft)} big />
        <p className="note">只被真实成交消耗，不随反弹或新高回补；用尽后回到基础月投。</p>
      </Card>

      {editingPrice !== undefined && (
        <PriceSheet
          symbol={editingPrice}
          price={data.etfs.find(e => e.symbol === editingPrice)?.price}
          date={data.etfs.find(e => e.symbol === editingPrice)?.priceDate}
          onClose={() => setEditingPrice(undefined)}
          onSave={(p, d) => {
            setPrice(editingPrice, p, d)
            setEditingPrice(undefined)
          }}
        />
      )}
    </>
  )
}

function PriceSheet({
  symbol,
  price,
  date,
  onClose,
  onSave
}: {
  symbol: string
  price: number | undefined
  date: string | undefined
  onClose: () => void
  onSave: (price: number | undefined, date: string | undefined) => void
}) {
  const [p, setP] = useState<number | undefined>(price || undefined)
  const [d, setD] = useState<string | undefined>(date || today())
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>{symbol} 现价</h2>
        <Field label="现价 USD／份">
          <NumberInput value={p} onChange={setP} placeholder="0.00" />
        </Field>
        <Field label="价格日期" sub="也可以直接用顶部「更新行情」自动填。">
          <input type="date" value={d ?? ''} onChange={e => setD(e.target.value || undefined)} />
        </Field>
        <div className="btn-row">
          <button className="primary" onClick={() => onSave(p, d)}>
            保存
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
