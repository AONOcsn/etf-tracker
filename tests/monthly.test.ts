import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMonthly } from '../src/core/monthly.ts'
import { computeDrawdown } from '../src/core/drawdown.ts'
import { DEFAULT_SETTINGS, DEFAULT_ETFS } from '../src/core/empty.ts'
import type { EtfSetting, PlanMonth, Trade } from '../src/core/types.ts'

const settings = { ...DEFAULT_SETTINGS }
const etfs: EtfSetting[] = DEFAULT_ETFS.map(e => ({ ...e }))

function run(planSpecs: Partial<PlanMonth>[], trades: Trade[], list: EtfSetting[] = etfs) {
  const planMonths: PlanMonth[] = planSpecs.map((s, i) => ({
    period: `2026-${String(i + 1).padStart(2, '0')}`,
    ...s
  }))
  const plan = computeDrawdown({ months: planMonths, settings, trades })
  return computeMonthly(plan.rows, list, trades)
}

test('计划金额按 90/10 分配到 VOO 与 QQQM', () => {
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], [])
  const row = rows[0]
  assert.equal(row.plannedTotal, 500)
  assert.equal(row.etfs.find(e => e.symbol === 'VOO')?.planned, 450)
  assert.equal(row.etfs.find(e => e.symbol === 'QQQM')?.planned, 50)
  // SMH 不参与计划投入
  assert.equal(row.etfs.find(e => e.symbol === 'SMH'), undefined)
})

test('无成交时实际为 0，状态为尚未记录买入', () => {
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], [])
  assert.equal(rows[0].actualTotal, 0)
  assert.equal(rows[0].diff, undefined)
  assert.equal(rows[0].status, '尚未记录买入')
})

test('按计划买入时实际与预算一致', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 450, fee: 0, shares: 1, purpose: '定投' },
    { id: 'b', date: '2026-01-15', symbol: 'QQQM', side: 'buy', amount: 50, fee: 0, shares: 1, purpose: '定投' }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(rows[0].actualTotal, 500)
  assert.equal(rows[0].diff, 0)
  assert.equal(rows[0].status, '已记录预算金额')
})

test('金额有差额时给出提示', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 450, fee: 0, shares: 1, purpose: '定投' }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(rows[0].actualTotal, 450)
  assert.equal(rows[0].diff, -50)
  assert.equal(rows[0].status, '已记录，金额有差额')
})

test('手续费计入实际金额（与原表 M 列「含手续费」一致）', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 449, fee: 1, shares: 1, purpose: '定投' },
    { id: 'b', date: '2026-01-15', symbol: 'QQQM', side: 'buy', amount: 50, fee: 0, shares: 1, purpose: '定投' }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(rows[0].actualTotal, 500)
  assert.equal(rows[0].status, '已记录预算金额')
})

test('分红再投与其他买入不计入实际合计', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 450, fee: 0, shares: 1, purpose: '定投' },
    { id: 'b', date: '2026-01-15', symbol: 'QQQM', side: 'buy', amount: 50, fee: 0, shares: 1, purpose: '定投' },
    { id: 'c', date: '2026-01-20', symbol: 'VOO', side: 'buy', amount: 120, fee: 0, shares: 1, purpose: '分红再投' },
    { id: 'd', date: '2026-01-21', symbol: 'QQQM', side: 'buy', amount: 80, fee: 0, shares: 1, purpose: '其他' }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(rows[0].actualTotal, 500) // 只有定投那两笔
  assert.equal(rows[0].status, '已记录预算金额')
})

test('卖出不影响实际金额', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'sell', amount: 450, fee: 0, shares: 1 }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], trades)
  assert.equal(rows[0].actualTotal, 0)
  assert.equal(rows[0].status, '尚未记录买入')
})

test('当月交易只计入当月，不串月', () => {
  const trades: Trade[] = [
    { id: 'a', date: '2026-01-15', symbol: 'VOO', side: 'buy', amount: 450, fee: 0, shares: 1 },
    { id: 'b', date: '2026-02-15', symbol: 'VOO', side: 'buy', amount: 900, fee: 0, shares: 1 }
  ]
  const rows = run(
    [{ observedDate: '2026-01-05', spClose: 7794.35 }, { observedDate: '2026-02-05', spClose: 7794.35 }],
    trades
  )
  assert.equal(rows[0].actualTotal, 450)
  assert.equal(rows[1].actualTotal, 900)
})

test('自定义调仓比例会改变分配', () => {
  const custom: EtfSetting[] = [
    { symbol: 'VOO', targetRatio: 0.8, planned: true, price: 0 },
    { symbol: 'QQQM', targetRatio: 0.2, planned: true, price: 0 }
  ]
  const rows = run([{ observedDate: '2026-01-05', spClose: 7794.35 }], [], custom)
  assert.equal(rows[0].etfs.find(e => e.symbol === 'VOO')?.planned, 400)
  assert.equal(rows[0].etfs.find(e => e.symbol === 'QQQM')?.planned, 100)
})
