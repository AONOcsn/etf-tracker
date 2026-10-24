import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyData, normalizeData } from '../src/core/empty.ts'
import { computeDrawdown } from '../src/core/drawdown.ts'
import { computeMonthly } from '../src/core/monthly.ts'

test('旧 ETF 现金只迁移一次，独立余额不会再次累加', () => {
  const old = emptyData()
  delete old.settings.cashUsd
  old.etfs[0].cash = 80
  old.etfs[1].cash = 20
  const migrated = normalizeData(old)
  assert.equal(migrated.settings.cashUsd, 100)
  assert.equal(normalizeData(migrated).settings.cashUsd, 100)
  assert.equal(migrated.etfs.reduce((n, e) => n + (e.cash ?? 0), 0), 0)
  assert.equal(normalizeData({ ...old, settings: { ...old.settings, cashUsd: 0 } }).settings.cashUsd, 0)
})

test('投入比例沿用原计划分配，之后与持仓目标占比独立', () => {
  const legacy = emptyData()
  legacy.etfs.forEach(e => { delete e.investRatio })
  const migrated = normalizeData(legacy)
  assert.equal(migrated.etfs[0].investRatio, 0.9)
  migrated.etfs[0].targetRatio = 0.5
  assert.equal(normalizeData(migrated).etfs[0].investRatio, 0.9)
})

test('新账本只创建当前月，旧备份的历史月份不删除', () => {
  assert.deepEqual(emptyData('2026-10').planMonths, [{ period: '2026-10' }])
  const old = emptyData()
  old.planMonths.push({ period: '2025-01', note: '历史' })
  assert.ok(normalizeData(old).planMonths.some(m => m.note === '历史'))
})

test('新建或重置的账本立即具备有效现金和完整投入比例', () => {
  const data = emptyData()
  assert.equal(data.settings.cashUsd, 0)
  assert.equal(data.etfs.filter(e => e.planned).reduce((n, e) => n + (e.investRatio ?? 0), 0), 1)
})

test('月度计划使用投入比例而非持仓目标，未完成成交不计入执行', () => {
  const data = normalizeData(emptyData('2026-10'))
  data.etfs[0].targetRatio = 0.1
  data.trades.push({ id: 'bad', date: '2026-10-01', symbol: 'VOO', side: 'buy', amount: 500, fee: 0, shares: 0 })
  const plan = computeDrawdown({ months: data.planMonths, settings: data.settings, trades: data.trades })
  const month = computeMonthly(plan.rows, data.etfs, data.trades)[0]
  assert.equal(month.etfs[0].planned, 450)
  assert.equal(month.actualTotal, 0)
  assert.equal(plan.rows[0].actualInvested, 0)
})
