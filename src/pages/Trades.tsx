import { useMemo, useState } from 'react'
import { Card, DateInput, Empty, Field, NumberInput, PURPOSE_OPTIONS, Select, Sheet, StatusBadge, TextInput, sideText } from '../components/ui.tsx'
import type { AppData, Purpose, Side, Trade } from '../core/types.ts'
import { num, today, uid } from '../core/types.ts'
import { computeHoldings, holdingOf, tradeStatus } from '../core/holdings.ts'

/**
 * 交易页：等价于原表「交易记录」。
 *
 * 每一行都带上重算后的持仓影响（份额变动、成本变动、已实现盈亏），
 * 这样不用回 Excel 看 G–O 列也能判断一笔录入对不对。
 */
export function TradesPage({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [editing, setEditing] = useState<Trade | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined)

  const result = useMemo(() => computeHoldings(data.trades), [data.trades])
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sh = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })

  function saveTrade(trade: Trade) {
    update(current => {
      const exists = current.trades.some(t => t.id === trade.id)
      return {
        ...current,
        trades: exists ? current.trades.map(t => (t.id === trade.id ? trade : t)) : [...current.trades, trade]
      }
    })
    setEditing(undefined)
  }

  function removeTrade(id: string) {
    update(current => ({ ...current, trades: current.trades.filter(t => t.id !== id) }))
    setConfirmDelete(undefined)
  }

  function newTrade(): Trade {
    return {
      id: uid(),
      date: today(),
      symbol: data.etfs[0]?.symbol ?? 'VOO',
      side: 'buy',
      amount: 0,
      fee: 0,
      shares: 0,
      purpose: '定投'
    }
  }

  return (
    <>
      <Card
        title="交易记录"
        hint={`${data.trades.length} 笔`}
        footer={
          <div className="btn-row">
            <button className="primary" onClick={() => setEditing(newTrade())}>
              ＋ 记一笔成交
            </button>
          </div>
        }
      >
        {result.trades.length === 0 ? (
          <Empty text="还没有成交记录。点下面的按钮记第一笔。" />
        ) : (
          <div className="list">
            {[...result.trades].reverse().map(t => (
              <div className="item" key={t.id}>
                <div className="main">
                  <div className="title">
                    {t.symbol} {sideText(t.side)}
                    <StatusBadge status={t.status} />
                    {t.purpose && t.purpose !== '定投' && <span className="badge plain">{t.purpose}</span>}
                  </div>
                  <div className="meta">
                    {t.date} · 金额 {fmt(t.amount)} · 手续费 {fmt(t.fee)} · 份额 {sh(t.shares)}
                  </div>
                  <div className="meta">
                    份额变动 {t.sharesDelta >= 0 ? '+' : ''}
                    {sh(t.sharesDelta)} · 成本变动 {t.costDelta >= 0 ? '+' : ''}
                    {fmt(t.costDelta)}
                    {t.side === 'sell' && ` · 已实现 ${fmt(t.realized)}`}
                  </div>
                  {t.note && <div className="meta">备注：{t.note}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="edit" onClick={() => setEditing(t)} aria-label="编辑">
                    ✎
                  </button>
                  <button className="edit" onClick={() => setConfirmDelete(t.id)} aria-label="删除">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="当前持仓" hint="按移动加权平均法重算">
        {data.etfs.map(etf => {
          const h = holdingOf(result, etf.symbol)
          return (
            <div key={etf.symbol}>
              <div className="section-title">
                {etf.symbol} — 份额 {sh(h.shares)}
              </div>
              <div className="row">
                <span className="k">持仓成本 / 平均成本 / 已实现</span>
                <span className="v">
                  {fmt(h.cost)} / {h.avgCost ? fmt(h.avgCost) : '—'} / {fmt(h.realized)}
                </span>
              </div>
            </div>
          )
        })}
        <p className="note">
          采用移动加权平均法：卖出按此前平均成本扣减，差额计入已实现盈亏。它用于投资分析；报税或核对券商成本时请用正式资料。
        </p>
      </Card>

      {editing && (
        <TradeSheet
          trade={editing}
          symbols={data.etfs.map(e => e.symbol)}
          result={result}
          onClose={() => setEditing(undefined)}
          onSave={saveTrade}
        />
      )}

      {confirmDelete && (
        <Sheet title="删除这笔成交？" onClose={() => setConfirmDelete(undefined)}>
          <div className="banner info">删除后无法撤销（可用设置页的历史快照回滚）。</div>
          <div className="btn-row">
            <button className="primary" onClick={() => removeTrade(confirmDelete)}>
              确认删除
            </button>
            <button onClick={() => setConfirmDelete(undefined)}>取消</button>
          </div>
        </Sheet>
      )}
    </>
  )
}

function TradeSheet({
  trade,
  symbols,
  result,
  onClose,
  onSave
}: {
  trade: Trade
  symbols: string[]
  result: ReturnType<typeof computeHoldings>
  onClose: () => void
  onSave: (trade: Trade) => void
}) {
  const [form, setForm] = useState<Trade>({ ...trade })
  const [symbolFree, setSymbolFree] = useState(false)
  const isNew = !result.trades.some(t => t.id === trade.id)

  const set = (patch: Partial<Trade>) => setForm(f => ({ ...f, ...patch }))

  // 编辑时预演这笔的状态，用「其他交易重算后的前序值」作为基准
  const others = result.trades.filter(t => t.id !== trade.id)
  const preview = useMemo(() => {
    const priorShares = others
      .filter(t => t.symbol === form.symbol && t.status === '已记录' && t.date <= form.date)
      .reduce((s, t) => s + t.sharesDelta, 0)
    const priorIncomplete = others.filter(t => t.symbol === form.symbol && t.status !== '已记录').length
    return tradeStatus(form, priorShares, priorIncomplete)
  }, [others, form])

  return (
    <Sheet title={isNew ? '记一笔成交' : '编辑成交'} onClose={onClose}>
      <Field label="成交日期">
        <DateInput value={form.date} onChange={v => set({ date: v ?? '' })} />
      </Field>

      <Field label="ETF">
        {symbolFree ? (
          <TextInput value={form.symbol} onChange={v => set({ symbol: v })} placeholder="如 ARKK" />
        ) : (
          <select value={form.symbol} onChange={e => set({ symbol: e.target.value })}>
            {symbols.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="sub">
          <button className="ghost" style={{ minHeight: 26, padding: '0 6px', fontSize: 12 }} onClick={() => setSymbolFree(v => !v)}>
            {symbolFree ? '从清单选择' : '填清单外的代码'}
          </button>
        </div>
      </Field>

      <Field label="方向">
        <Select<Side> value={form.side} options={['buy', 'sell'] as const} onChange={v => set({ side: v })} />
      </Field>

      <div className="grid2">
        <Field label="成交金额 USD" sub="不含手续费">
          <NumberInput value={form.amount} onChange={v => set({ amount: v ?? 0 })} placeholder="0.00" />
        </Field>
        <Field label="手续费 USD">
          <NumberInput value={form.fee} onChange={v => set({ fee: v ?? 0 })} placeholder="0.00" />
        </Field>
      </div>

      <Field label="成交份额" sub="保留 6 位小数，如 0.5373">
        <NumberInput value={form.shares} onChange={v => set({ shares: v ?? 0 })} placeholder="0.000000" />
      </Field>

      {form.side === 'buy' && (
        <Field label="买入用途" sub="留空按定投计算；分红再投与其他不计入回撤计划的预算消耗。">
          <select
            value={form.purpose ?? ''}
            onChange={e => set({ purpose: (e.target.value || undefined) as Purpose | undefined })}
          >
            <option value="">（定投）</option>
            {PURPOSE_OPTIONS.filter(p => p !== '定投').map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="备注">
        <TextInput value={form.note} onChange={v => set({ note: v || undefined })} />
      </Field>

      <div className={`banner ${preview === '已记录' ? 'ok' : preview === '请检查输入' || preview === '卖出超过持仓' ? 'err' : 'info'}`}>
        检查状态：{preview}
      </div>

      <div className="btn-row">
        <button className="primary" onClick={() => onSave({ ...form, amount: num(form.amount, 0), fee: num(form.fee, 0), shares: num(form.shares, 0) })}>
          保存
        </button>
        <button onClick={onClose}>取消</button>
      </div>
    </Sheet>
  )
}
