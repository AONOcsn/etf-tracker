import { useMemo, useState } from 'react'
import { Card, Empty, Field, NumberInput, Row, Sheet, StatusBadge, TextInput } from '../components/ui.tsx'
import type { AppData, PlanMonth } from '../core/types.ts'
import { currentPeriod, today } from '../core/types.ts'
import { computeDrawdown, visiblePlanRows } from '../core/drawdown.ts'
import { computeMonthly } from '../core/monthly.ts'

/**
 * 计划页：把原表的「回撤计划」与「月度计划」合并。
 *
 * 这两张表在原表里是上下联动的（月度计划引用回撤计划的本月合计），
 * 手机上一屏内并排看反而更清楚，所以合成一个页面。
 */
export function PlanPage({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [showParams, setShowParams] = useState(false)

  const drawdown = useMemo(
    () => computeDrawdown({ months: data.planMonths, settings: data.settings, trades: data.trades }),
    [data.planMonths, data.settings, data.trades]
  )
  const monthly = useMemo(() => computeMonthly(drawdown.rows, data.etfs, data.trades), [drawdown.rows, data.etfs, data.trades])
  // 只列出有内容的月份 + 当前月及之后两个月，避免 120 个空行铺满屏幕
  const visibleRows = useMemo(
    () => visiblePlanRows(data.planMonths, drawdown.rows),
    [data.planMonths, drawdown.rows]
  )

  const period = currentPeriod()
  const current = drawdown.rows.find(r => r.period === period)
  const currentMonthly = monthly.find(m => m.period === period)
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`

  function patchMonth(period: string, patch: Partial<PlanMonth>) {
    update(current => {
      const exists = current.planMonths.some(m => m.period === period)
      return {
        ...current,
        planMonths: exists
          ? current.planMonths.map(m => (m.period === period ? { ...m, ...patch } : m))
          : [...current.planMonths, { period, ...patch }].sort((a, b) => (a.period < b.period ? -1 : 1))
      }
    })
  }

  return (
    <>
      <Card
        title="回撤计划参数"
        hint={
          <button className="ghost" style={{ minHeight: 28, padding: '2px 8px', fontSize: 12 }} onClick={() => setShowParams(v => !v)}>
            {showParams ? '收起' : '修改'}
          </button>
        }
      >
        <Row label="基础月投 USD" value={fmt(data.settings.baseMonthly)} />
        <Row label="额外预算总额 USD" value={fmt(data.settings.extraBudgetTotal)} />
        <Row label="起始历史高收盘" value={fmt(data.settings.startingPeak)} />
        <Row label="每月计划日" value={`${data.settings.planDay} 日`} />
        <Row label="目标调仓" value={`VOO ${pct(1 - data.settings.rebalance)} ／ QQQM ${pct(data.settings.rebalance)}`} />
        <Row label="额外预算剩余 USD" value={fmt(drawdown.budgetLeft)} big />
        {showParams && (
          <div style={{ marginTop: 12 }}>
            <div className="grid2">
              <Field label="基础月投 USD">
                <NumberInput
                  value={data.settings.baseMonthly}
                  onChange={v =>
                    update(c => ({ ...c, settings: { ...c.settings, baseMonthly: v ?? 0 } }))
                  }
                />
              </Field>
              <Field label="额外预算总额 USD">
                <NumberInput
                  value={data.settings.extraBudgetTotal}
                  onChange={v => update(c => ({ ...c, settings: { ...c.settings, extraBudgetTotal: v ?? 0 } }))}
                />
              </Field>
              <Field label="起始历史高收盘">
                <NumberInput
                  value={data.settings.startingPeak}
                  onChange={v => update(c => ({ ...c, settings: { ...c.settings, startingPeak: v ?? 0 } }))}
                />
              </Field>
              <Field label="每月计划日">
                <NumberInput
                  value={data.settings.planDay}
                  onChange={v => update(c => ({ ...c, settings: { ...c.settings, planDay: Math.round(v ?? 1) } }))}
                />
              </Field>
              <Field label="QQQM 目标比例" sub="VOO 自动取 1 − 该值">
                <NumberInput
                  value={data.settings.rebalance}
                  onChange={v => update(c => ({ ...c, settings: { ...c.settings, rebalance: v ?? 0 } }))}
                />
              </Field>
            </div>
          </div>
        )}
      </Card>

      {current && (
        <Card title="本月计划" hint={current.period}>
          <Row label="计划日期" value={current.plannedDate} />
          <Row label="观察收盘日" value={current.observedDate ?? '未填'} />
          <Row label="标普500收盘" value={current.spClose !== undefined ? fmt(current.spClose) : '未填'} />
          <Row label="沿用历史高点" value={fmt(current.peak)} />
          <Row label="回撤幅度" value={current.drawdown !== undefined ? pct(current.drawdown) : '待补行情'} />
          <Row label="档位总额 USD" value={current.tierAmount !== undefined ? fmt(current.tierAmount) : '—'} />
          <Row label="计划额外 USD" value={fmt(current.plannedExtra)} />
          <Row label="本月合计 USD" value={fmt(current.monthTotal)} big />
          <Row label="VOO 计划 USD" value={fmt(current.vooPlan)} />
          <Row label="QQQM 计划 USD" value={fmt(current.qqqmPlan)} />
          <Row label="实际定投 USD" value={fmt(current.actualInvested)} />
          <Row label="已用额外 USD" value={fmt(current.extraUsed)} />
          <Row label="月底余款 USD" value={fmt(current.budgetAtEnd)} />
          <Row label="状态" value={<StatusBadge status={current.status} />} />
          <div className="btn-row">
            <button className="primary" onClick={() => setEditing(current.period)}>
              填本月行情
            </button>
          </div>
          {currentMonthly && (
            <>
              <div className="section-title">月度执行</div>
              {currentMonthly.etfs.map(e => (
                <Row key={e.symbol} label={`${e.symbol} 计划 / 实际`} value={`${fmt(e.planned)} / ${fmt(e.actual)}`} />
              ))}
              <Row label="实际合计" value={fmt(currentMonthly.actualTotal)} />
              <Row label="实际 − 预算" value={currentMonthly.diff !== undefined ? fmt(currentMonthly.diff) : '—'} />
              <Row label="执行状态" value={<StatusBadge status={currentMonthly.status} />} />
            </>
          )}
        </Card>
      )}

      <Card
        title="历史与后续月份"
        hint={visibleRows.length < drawdown.rows.length ? `${visibleRows.length} 个月有内容` : `${drawdown.rows.length} 个月`}
      >
        {visibleRows.length === 0 ? (
          <Empty text="还没有填过行情的月份" />
        ) : (
          <div className="list">
            {visibleRows.map(row => (
              <div className="item" key={row.period}>
                <div className="main">
                  <div className="title">
                    {row.period}
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="meta">
                    收盘 {row.spClose !== undefined ? fmt(row.spClose) : '—'} · 高点 {fmt(row.peak)} · 回撤{' '}
                    {row.drawdown !== undefined ? pct(row.drawdown) : '—'}
                  </div>
                  <div className="meta">
                    合计 {fmt(row.monthTotal)} · 实际 {fmt(row.actualInvested)} · 已用 {fmt(row.extraUsed)} · 余款{' '}
                    {fmt(row.budgetAtEnd)}
                  </div>
                </div>
                <button className="edit" onClick={() => setEditing(row.period)} aria-label="编辑">
                  ✎
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="note">只列出填过行情的月份，以及当前月和之后两个月。其余月份可以点上面的「本月计划」或按需要编辑。</p>
      </Card>

      {editing && (
        <MonthSheet
          row={data.planMonths.find(m => m.period === editing) ?? { period: editing }}
          computed={drawdown.rows.find(r => r.period === editing)}
          onClose={() => setEditing(undefined)}
          onSave={patch => {
            patchMonth(editing, patch)
            setEditing(undefined)
          }}
        />
      )}
    </>
  )
}

function MonthSheet({
  row,
  computed,
  onClose,
  onSave
}: {
  row: PlanMonth
  computed?: { peak: number; drawdown?: number; tierAmount?: number; monthTotal: number }
  onClose: () => void
  onSave: (patch: Partial<PlanMonth>) => void
}) {
  const [observedDate, setObservedDate] = useState(row.observedDate ?? today())
  const [spClose, setSpClose] = useState<number | undefined>(row.spClose)
  const [newPeak, setNewPeak] = useState<number | undefined>(row.newPeak)
  const [override, setOverride] = useState<number | undefined>(row.actualExtraOverride)
  const [overrideOn, setOverrideOn] = useState(row.actualExtraOverride !== undefined)
  const [note, setNote] = useState(row.note ?? '')

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
