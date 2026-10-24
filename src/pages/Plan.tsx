import { useMemo, useState } from 'react'
import { Card, Field, NumberInput, Row, Sheet, StatusBadge, TextInput } from '../components/ui.tsx'
import { MarketClock } from '../components/MarketClock.tsx'
import type { AppData, PlanMonth } from '../core/types.ts'
import { currentPeriod, today } from '../core/types.ts'
import { planning } from '../core/planning.ts'
import { validDate } from '../core/ledger.ts'
import type { RecordRequest } from '../core/ledger.ts'

export function PlanPage({ data, update, onRecord, onSettings }: {
  data: AppData; update: (fn: (d: AppData) => AppData) => void
  onRecord: (request: RecordRequest) => void; onSettings: () => void
}) {
  const [period, setPeriod] = useState(currentPeriod())
  const [editing, setEditing] = useState(false)
  const { drawdown, current, execution } = useMemo(() => planning(data, period), [data, period])
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const ratio = data.etfs.filter(e => e.planned).reduce((n, e) => n + (e.investRatio ?? 0), 0)
  const history = data.planMonths.filter(m => m.spClose !== undefined || m.newPeak !== undefined || m.observedDate || m.note || m.actualExtraOverride !== undefined || data.trades.some(t => t.date.startsWith(m.period))).map(m => m.period)
  return <>
    <div className="month-picker"><label htmlFor="plan-month">计划月份</label><input id="plan-month" type="month" value={period} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setPeriod(e.target.value) }} /></div>
    <Card title={period === currentPeriod() ? '本月计划' : '月度计划'} hint={period}>
      <div className="plan-total"><span>计划投入 USD</span><strong>{fmt(current.monthTotal)}</strong></div>
      <div className="plan-progress"><div style={{ width: `${Math.min(100, execution.actualTotal / Math.max(1, current.monthTotal) * 100)}%` }} /></div>
      <div className="progress-caption"><span>已记录 {fmt(execution.actualTotal)}</span><span>还差 {fmt(Math.max(0, current.monthTotal - execution.actualTotal))}</span></div>
      {!current.observedDate && <button className="inline-notice" onClick={() => setEditing(true)}>本月指数行情待补，当前先列基础月投。点击填写 ›</button>}
      {Math.abs(ratio - 1) > 0.0001 && <button className="inline-notice" onClick={onSettings}>投入比例合计不是 100%，请到设置核对 ›</button>}
      <div className="plan-allocations">{execution.etfs.map(e => <div className="plan-allocation" key={e.symbol}><div><strong>{e.symbol}</strong><small>计划 {fmt(e.planned)} · 已投 {fmt(e.actual)}</small></div><button className="primary" onClick={() => onRecord({ kind: 'buy', symbol: e.symbol, date: period === currentPeriod() ? today() : current.plannedDate, referenceAmount: Math.max(0, e.planned - e.actual) })}>记买入</button></div>)}</div>
      <details className="calculation-details"><summary>回撤与预算依据</summary>
        <Row label="计划日期" value={current.plannedDate} /><Row label="观察收盘日" value={current.observedDate ?? '待补'} /><Row label="指数收盘" value={current.spClose ? fmt(current.spClose) : '—'} /><Row label="沿用历史高点" value={fmt(current.peak)} /><Row label="回撤" value={current.drawdown === undefined ? '—' : `${(current.drawdown * 100).toFixed(2)}%`} /><Row label="基础 / 额外投入" value={`${fmt(data.settings.baseMonthly)} / ${fmt(current.plannedExtra)}`} /><Row label="月初额外预算" value={fmt(current.budgetAtStart)} /><Row label="已用额外预算" value={fmt(current.extraUsed)} /><Row label="月末额外预算" value={fmt(current.budgetAtEnd)} /><StatusBadge status={current.status} />
      </details>
      <button className="text-button full-width" onClick={() => setEditing(true)}>填写或核对观察行情</button>
    </Card>
    <div className="settings-group"><button className="setting-link" onClick={onSettings}><span><strong>投资参数</strong><small>基础月投 {fmt(data.settings.baseMonthly)} USD · 额外预算余 {fmt(drawdown.budgetLeft)}</small></span><span>›</span></button></div>
    <details className="doc"><summary>美股交易时段</summary><MarketClock /></details>
    {history.length > 0 && <details className="doc"><summary>已记录的计划月份</summary><div className="month-options">{[...new Set(history)].sort().reverse().map(p => <button key={p} onClick={() => setPeriod(p)}>{p}</button>)}</div></details>}
    <p className="privacy-note">按实际成交核对进度。计划金额仅供参考，不会自动下单。</p>
    {editing && <MonthSheet row={data.planMonths.find(m => m.period === period) ?? { period }} data={data} onClose={() => setEditing(false)} onSave={patch => {
      update(c => ({ ...c, planMonths: c.planMonths.some(m => m.period === period) ? c.planMonths.map(m => m.period === period ? { ...m, ...patch } : m) : [...c.planMonths, { period, ...patch }] }))
      setEditing(false)
    }} />}
  </>
}

function MonthSheet({
  row,
  data,
  onClose,
  onSave
}: {
  row: PlanMonth
  data: AppData
  onClose: () => void
  onSave: (patch: Partial<PlanMonth>) => void
}) {
  const [observedDate, setObservedDate] = useState(row.observedDate ?? today())
  const [spClose, setSpClose] = useState<number | undefined>(row.spClose)
  const [newPeak, setNewPeak] = useState<number | undefined>(row.newPeak)
  const [override, setOverride] = useState<number | undefined>(row.actualExtraOverride)
  const [overrideOn, setOverrideOn] = useState(row.actualExtraOverride !== undefined)
  const [note, setNote] = useState(row.note ?? '')

  const patch = { observedDate, spClose, newPeak, actualExtraOverride: overrideOn ? override : undefined, note: note || undefined }
  const months = data.planMonths.some(m => m.period === row.period) ? data.planMonths.map(m => m.period === row.period ? { ...m, ...patch } : m) : [...data.planMonths, { period: row.period, ...patch }]
  const computed = planning({ ...data, planMonths: months }, row.period).current
  const valid = validDate(observedDate) && spClose !== undefined && Number.isFinite(spClose) && spClose > 0 && (newPeak === undefined || newPeak > 0) && (!overrideOn || (override !== undefined && override >= 0))
  return (
    <Sheet title={`${row.period} 行情与额外投入`} onClose={onClose}>
      <Field label="观察收盘日" sub="填最近已结束的美股交易日，不是今天。">
        <input type="date" value={observedDate} onChange={e => setObservedDate(e.target.value)} />
      </Field>
      <Field label="标普500收盘" sub="用 Yahoo ^GSPC Close 或同口径来源；不要用盘中高点。">
        <NumberInput value={spClose} onChange={setSpClose} placeholder="0.00" />
      </Field>
      <Field label="新历史高收盘（选填）" sub="只在高于既有高点时生效；高点不随反弹下调。月中出现新高且已回落时要手工补这里。">
        <NumberInput value={newPeak} onChange={setNewPeak} placeholder="0.00" />
      </Field>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={overrideOn} onChange={e => setOverrideOn(e.target.checked)} />
          <span>手工指定本月动用的额外预算</span>
        </label>
        <div className="sub">留空时按「额外支出参考」自动扣。填 0 是有效值，表示本月确实没动额外预算。</div>
      </div>
      {overrideOn && (
        <Field label="实际额外 USD">
          <NumberInput value={override} onChange={setOverride} placeholder="0.00" />
        </Field>
      )}
      <Field label="备注">
        <TextInput value={note} onChange={setNote} placeholder="行情来源、截止日等" />
      </Field>

      {computed && (
        <div className="banner info">
          预览：沿用高点 {computed.peak.toLocaleString('en-US', { maximumFractionDigits: 2 })} · 回撤{' '}
          {computed.drawdown !== undefined ? `${(computed.drawdown * 100).toFixed(2)}%` : '待补行情'} · 本月合计{' '}
          {computed.monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}

      <div className="btn-row">
        <button
          className="primary"
          disabled={!valid}
          onClick={() =>
            onSave({
              observedDate,
              spClose,
              newPeak,
              actualExtraOverride: overrideOn ? override : undefined,
              // 手工填过就加标记，之后再点「更新行情」不会覆盖它
              spManual: true,
              note: note || undefined
            })
          }
        >
          保存
        </button>
        <button onClick={onClose}>取消</button>
      </div>
    </Sheet>
  )
}
