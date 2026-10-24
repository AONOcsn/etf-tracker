import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeOverview } from '../src/core/overview.ts'
import { computeHoldings } from '../src/core/holdings.ts'
import { DEFAULT_ETFS } from '../src/core/empty.ts'

function overview(symbol = 'VOO', price = 0) {
  return computeOverview({
    etfs: DEFAULT_ETFS.map(e => ({ ...e, price: e.symbol === symbol ? price : 0 })),
    holdings: computeHoldings([{ id: 'a', date: '2026-10-01', symbol, side: 'buy', amount: 100, fee: 0, shares: 1 }]),
    baseMonthly: 500, cash: 20, extraUsed: 0, extraTotal: 5000, receivedUsd: 0, netDividends: 0
  })
}

test('缺少持仓现价时不把资产当成零或显示亏损 100%', () => {
  const result = overview()
  assert.equal(result.rows[0].marketValue, undefined)
  assert.equal(result.rows[0].unrealized, undefined)
  assert.equal(result.rows[0].returnRate, undefined)
  assert.equal(result.totalValue, undefined)
  assert.equal(result.totals.marketValue, undefined)
  assert.equal(result.totals.cost, 100)
})

test('清单外的真实持仓仍出现在总览和成本合计中', () => {
  const result = overview('ARKK')
  const row = result.rows.find(r => r.symbol === 'ARKK')
  assert.equal(row?.shares, 1)
  assert.equal(row?.cost, 100)
  assert.equal(result.totals.cost, 100)
  assert.equal(result.totalValue, undefined)
})

test('行情齐全时市值现金盈亏仍按原有口径计算', () => {
  const result = overview('VOO', 120)
  assert.equal(result.totalValue, 140)
  assert.equal(result.totals.unrealized, 20)
  assert.equal(result.rows[0].returnRate, 0.2)
})
