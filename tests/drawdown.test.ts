import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORWARD_MONTHS, computeDrawdown, tierAmount, visiblePlanRows } from '../src/core/drawdown.ts'
import { DEFAULT_SETTINGS } from '../src/core/empty.ts'
import { periodRange } from '../src/core/types.ts'
import type { PlanMonth, Settings, Trade } from '../src/core/types.ts'

const settings: Settings = { ...DEFAULT_SETTINGS } // base 500 / budget 5000 / peak 7794.35 / day 10 / rebalance .1

function months(...specs: Partial<PlanMonth>[]): PlanMonth[] {
  return specs.map((s, i) => ({
    period: `2026-${String(i + 1).padStart(2, '0')}`,
    ...s
  }))
}

function run(specs: Partial<PlanMonth>[], trades: Trade[] = [], s: Settings = settings) {
  return computeDrawdown({ months: months(...specs), settings: s, trades })
}

test('档位边界：恰好 10% 进中档，恰好 20% 进高档', () => {
  assert.equal(tierAmount(500, 0), 500)
  assert.equal(tierAmount(500, 0.0999), 500)
  assert.equal(tierAmount(500, 0.1), 750) // 恰好 10% 已是中档
  assert.equal(tierAmount(500, 0.1999), 750)
  assert.equal(tierAmount(500, 0.2), 1000) // 恰好 20% 已是高档
  assert.equal(tierAmount(500, 0.5), 1000)
})

test('没有行情时只列基础额，并提示待补', () => {
  const r = run([{}])
  const row = r.rows[0]
  assert.equal(row.drawdown, undefined)
  assert.equal(row.tierAmount, undefined)
  assert.equal(row.plannedExtra, 0)
  assert.equal(row.monthTotal, 500)
  assert.equal(row.vooPlan, 450)
  assert.equal(row.qqqmPlan, 50)
  assert.equal(row.status, '待补指数收盘／历史基准；先列基础额')
})

test('20% 回撤：高档 1000，计划额外 500，本月合计 1000', () => {
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 * 0.8 }])
  const row = r.rows[0]
  assert.equal(row.tierAmount, 1000)
  assert.equal(row.budgetAtStart, 5000)
  assert.equal(row.plannedExtra, 500)
  // 档位总额就是本月合计，不能写成 500 + 500 = 1000 以外的数
  assert.equal(row.monthTotal, 1000)
  assert.equal(row.vooPlan, 900)
  assert.equal(row.qqqmPlan, 100)
})

test('10%~20% 中档 750，计划额外 250', () => {
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 * 0.85 }])
  assert.equal(r.rows[0].tierAmount, 750)
  assert.equal(r.rows[0].plannedExtra, 250)
})

test('历史高点只增不减，且当月收盘自身参与比较', () => {
  const r = run([
    // 当月收盘创新高：沿用高点应被抬到 8000
    { observedDate: '2026-01-05', spClose: 8000 },
    // 之后回落到 7000：高点必须仍是 8000，回撤 12.5%
    { observedDate: '2026-02-05', spClose: 7000 }
  ])
  assert.equal(r.rows[0].peak, 8000)
  assert.equal(r.rows[1].peak, 8000)
  assert.equal(r.rows[1].drawdown, 0.125)
  assert.equal(r.rows[1].tierAmount, 750)
})

test('手填新高抬高沿用高点；低于既有高点时被忽略', () => {
  const r = run([
    { observedDate: '2026-01-05', spClose: 7000, newPeak: 9000 },
    { observedDate: '2026-02-05', spClose: 7000, newPeak: 8000 } // 更低，应被忽略
  ])
  assert.equal(r.rows[0].peak, 9000)
  assert.equal(r.rows[1].peak, 9000)
})

test('实际定投扣预算：额外参考 = max(0, 实际定投 − 基础额)', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 1350, fee: 0, shares: 1, purpose: '定投' },
    { id: 't2', date: '2026-01-15', symbol: 'QQQM', side: 'buy', amount: 150, fee: 0, shares: 1, purpose: '定投' }
  ]
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 * 0.8 }], trades)
  const row = r.rows[0]
  assert.equal(row.tierAmount, 1000)
  assert.equal(row.monthTotal, 1000) // 本月合计 = 档位总额
  assert.equal(row.actualInvested, 1500) // 实际投了 1500
  assert.equal(row.extraReference, 1000) // 1500 − 500
  assert.equal(row.extraUsed, 1000)
  assert.equal(row.budgetAtEnd, 4000)
  // 实际 1500 与计划 1000 有差额
  assert.equal(row.status, '实际定投与计划有差额')
})

test('手填实际额外时状态改为按手填值扣预算', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 1350, fee: 0, shares: 1, purpose: '定投' },
    { id: 't2', date: '2026-01-15', symbol: 'QQQM', side: 'buy', amount: 150, fee: 0, shares: 1, purpose: '定投' }
  ]
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 * 0.8, actualExtraOverride: 500 }], trades)
  const row = r.rows[0]
  assert.equal(row.extraReference, 1000)
  assert.equal(row.extraUsed, 500) // 按手填值，而不是参考值
  assert.equal(row.budgetAtEnd, 4500)
  assert.equal(row.status, '已按手填额外支出扣预算')
})

test('分红再投与其他买入不计入实际定投', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 500, fee: 0, shares: 1, purpose: '定投' },
    { id: 't2', date: '2026-01-16', symbol: 'VOO', side: 'buy', amount: 999, fee: 0, shares: 1, purpose: '分红再投' },
    { id: 't3', date: '2026-01-17', symbol: 'QQQM', side: 'buy', amount: 888, fee: 0, shares: 1, purpose: '其他' }
  ]
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(r.rows[0].actualInvested, 500)
  assert.equal(r.rows[0].extraReference, 0)
})

test('用途留空按定投处理（与原表 P 列留空即定投一致）', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 700, fee: 0, shares: 1 }
  ]
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(r.rows[0].actualInvested, 700)
  assert.equal(r.rows[0].extraReference, 200)
})

test('卖出不消耗额外预算', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'sell', amount: 1000, fee: 0, shares: 1 }
  ]
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(r.rows[0].actualInvested, 0)
  assert.equal(r.rows[0].extraUsed, 0)
})

test('预算逐月耗尽：余款不足时只加余款，用尽后回退基础额且不自动重置', () => {
  // 每个月实际定投 1500（VOO 1350 + QQQM 150）→ 每月消耗 1000 额外预算
  const build = (period: string, day: string, id: string): Trade[] => [
    { id: `${id}a`, date: `${period}-${day}`, symbol: 'VOO', side: 'buy', amount: 1350, fee: 0, shares: 1, purpose: '定投' },
    { id: `${id}b`, date: `${period}-${day}`, symbol: 'QQQM', side: 'buy', amount: 150, fee: 0, shares: 1, purpose: '定投' }
  ]
  const trades: Trade[] = [
    ...build('2026-01', '15', 't1'),
    ...build('2026-02', '15', 't2'),
    ...build('2026-03', '15', 't3')
  ]
  const r = run(
    [
      { observedDate: '2026-01-05', spClose: 7794.35 * 0.8 },
      { observedDate: '2026-02-05', spClose: 7794.35 * 0.8 },
      { observedDate: '2026-03-05', spClose: 7794.35 * 0.8 }
    ],
    trades
  )
  assert.equal(r.rows[0].budgetAtStart, 5000)
  assert.equal(r.rows[0].budgetAtEnd, 4000)
  assert.equal(r.rows[1].budgetAtStart, 4000)
  assert.equal(r.rows[1].budgetAtEnd, 3000)
  assert.equal(r.rows[2].budgetAtStart, 3000)
  assert.equal(r.usedTotal, 3000)
  assert.equal(r.budgetLeft, 2000)
})

test('预算用尽后档位总额退回基础额，且不因反弹回补', () => {
  // 用超大买单一次性吃光预算
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 6000, fee: 0, shares: 1 }
  ]
  const r = run(
    [
      { observedDate: '2026-01-05', spClose: 7794.35 * 0.8 },
      { observedDate: '2026-02-05', spClose: 7794.35 } // 反弹回高点，回撤 0
    ],
    trades
  )
  assert.equal(r.rows[0].budgetAtEnd, 0)
  // 反弹后不再有额外预算，档位虽为基础额，但余款仍为 0
  assert.equal(r.rows[1].budgetAtStart, 0)
  assert.equal(r.rows[1].plannedExtra, 0)
  assert.equal(r.rows[1].monthTotal, 500)
  assert.equal(r.rows[1].status, '预算用完：基础定投')
})

test('月中余款不足时计划额外只取余款', () => {
  const trades: Trade[] = [
    { id: 't1', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 4700, fee: 0, shares: 1 }
  ]
  const r = run(
    [
      { observedDate: '2026-01-05', spClose: 7794.35 * 0.8 },
      { observedDate: '2026-02-05', spClose: 7794.35 * 0.8 }
    ],
    trades
  )
  // 第一月消耗 4700 − 500 = 4200，余 800
  assert.equal(r.rows[0].budgetAtEnd, 800)
  // 第二月高档需要 500 额外，800 够用
  assert.equal(r.rows[1].plannedExtra, 500)
})

test('手填实际额外覆盖自动值，填 0 同样有效', () => {
  const r = run([
    { observedDate: '2026-01-05', spClose: 7794.35 * 0.8, actualExtraOverride: 0 },
    { observedDate: '2026-02-05', spClose: 7794.35 * 0.8, actualExtraOverride: 300 }
  ])
  assert.equal(r.rows[0].extraUsed, 0)
  assert.equal(r.rows[0].budgetAtEnd, 5000)
  assert.equal(r.rows[1].extraUsed, 300)
  assert.equal(r.rows[1].budgetAtStart, 5000)
  assert.equal(r.rows[1].budgetAtEnd, 4700)
})

test('观察日晚于计划日且当月无成交 → 提示核对顺序', () => {
  const r = run([{ observedDate: '2026-01-20', spClose: 7794.35 }])
  assert.equal(r.rows[0].status, '核对观察日是否在实际交易前')
})

test('有行情但无成交 → 已计算，尚未记录买入', () => {
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 }])
  assert.equal(r.rows[0].status, '已计算，尚未记录买入')
})

test('累计已用与剩余预算汇总正确', () => {
  const r = run([
    { observedDate: '2026-01-05', spClose: 7794.35 * 0.8, actualExtraOverride: 500 },
    { observedDate: '2026-02-05', spClose: 7794.35 * 0.8, actualExtraOverride: 250 }
  ])
  assert.equal(r.usedTotal, 750)
  assert.equal(r.budgetLeft, 4250)
})

test('改基础额与调仓比例会重算计划金额', () => {
  const custom: Settings = { ...settings, baseMonthly: 1000 }
  const r = run([{ observedDate: '2026-01-05', spClose: 7794.35 * 0.8 }], [], custom)
  assert.equal(r.rows[0].monthTotal, 1500) // 1000 + 计划额外 500
  assert.equal(r.rows[0].vooPlan, 1350)
  assert.equal(r.rows[0].qqqmPlan, 150)
})

// ---------------------------------------------------------------------------
// 计划页月份列表的过滤规则
// ---------------------------------------------------------------------------

const NOW = '2026-10-06'

/**
 * 造一份计划表：从 2026-01 起 120 个月，可选地给某几个月塞入内容。
 * 起点故意早于 NOW，这样才能验证「过去的月份」也会被列出来。
 */
function planTable(filled: Record<string, Partial<PlanMonth>> = {}) {
  const months: PlanMonth[] = periodRange('2026-01', 120).map(period => ({
    period,
    ...(filled[period] ?? {})
  }))
  const result = computeDrawdown({ months, settings, trades: [] })
  return { months, rows: result.rows }
}

test('空白账本只列出当前月及之后两个月，不铺 120 行', () => {
  const { months, rows } = planTable()
  const visible = visiblePlanRows(months, rows, NOW)
  assert.equal(visible.length, FORWARD_MONTHS + 1)
  // 倒序：当前月在最上面
  assert.deepEqual(visible.map(r => r.period), ['2026-12', '2026-11', '2026-10'])
})

test('填过行情的月份会被列出来，即使远在过去或未来', () => {
  const { months, rows } = planTable({
    '2026-03': { observedDate: '2026-03-05', spClose: 7000 },
    '2027-06': { observedDate: '2027-06-05', spClose: 8000 }
  })
  const visible = visiblePlanRows(months, rows, NOW)
  const periods = visible.map(r => r.period)
  assert.ok(periods.includes('2026-03'))
  assert.ok(periods.includes('2027-06'))
  // 当前月窗口仍然保留
  assert.ok(periods.includes('2026-10'))
  assert.ok(periods.includes('2026-11'))
  assert.ok(periods.includes('2026-12'))
  // 完全空的月份不出现
  assert.ok(!periods.includes('2026-05'))
  assert.ok(!periods.includes('2030-01'))
})

test('只填了新高或手填额外预算的月份也算有内容', () => {
  const { months, rows } = planTable({
    '2026-02': { newPeak: 8100 },
    '2026-04': { actualExtraOverride: 0 }
  })
  const periods = visiblePlanRows(months, rows, NOW).map(r => r.period)
  assert.ok(periods.includes('2026-02'))
  assert.ok(periods.includes('2026-04'))
})

test('只写了备注的月份也算有内容', () => {
  const { months, rows } = planTable({ '2026-01': { note: '来源 Yahoo，截止 1/2' } })
  const periods = visiblePlanRows(months, rows, NOW).map(r => r.period)
  assert.ok(periods.includes('2026-01'))
})

test('有真实成交的月份会被列出来（即使行情没填）', () => {
  const months: PlanMonth[] = periodRange('2026-10', 12).map(period => ({ period }))
  const trades: Trade[] = [
    { id: 't1', date: '2026-11-15', symbol: 'VOO', side: 'buy', amount: 500, fee: 0, shares: 1, purpose: '定投' }
  ]
  const result = computeDrawdown({ months, settings, trades })
  const periods = visiblePlanRows(months, result.rows, NOW).map(r => r.period)
  assert.ok(periods.includes('2026-11'))
})

test('月份列表按时间倒序，最近的排最上面', () => {
  const { months, rows } = planTable({
    '2026-01': { observedDate: '2026-01-05', spClose: 7000 },
    '2026-02': { observedDate: '2026-02-05', spClose: 7100 },
    '2026-03': { observedDate: '2026-03-05', spClose: 7200 }
  })
  const visible = visiblePlanRows(months, rows, NOW)
  const periods = visible.map(r => r.period)
  // 倒序：2026-12 在前，2026-01 在最后
  assert.deepEqual(periods, ['2026-12', '2026-11', '2026-10', '2026-03', '2026-02', '2026-01'])
})
