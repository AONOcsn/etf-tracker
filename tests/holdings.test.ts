import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeHoldings, holdingOf, tradeStatus, type CheckState } from '../src/core/holdings.ts'
import type { Trade } from '../src/core/types.ts'

/** 造一笔交易，只写关心的字段。 */
function trade(over: Partial<Trade> & { id: string }): Trade {
  return {
    date: '2026-01-01',
    symbol: 'VOO',
    side: 'buy',
    amount: 100,
    fee: 0,
    shares: 1,
    ...over
  } as Trade
}

const statusOf = (t: Trade, priorShares = 0, priorIncomplete = 0): CheckState =>
  tradeStatus(t, priorShares, priorIncomplete)

test('买入：份额与成本按金额加手续费累加，平均成本正确', () => {
  const r = computeHoldings([
    trade({ id: 'a', date: '2026-01-01', amount: 100, fee: 1, shares: 2 }),
    trade({ id: 'b', date: '2026-02-01', amount: 200, fee: 2, shares: 2 })
  ])
  const h = holdingOf(r, 'VOO')
  assert.equal(h.shares, 4)
  assert.equal(h.cost, 303) // 101 + 202
  assert.equal(h.avgCost, 75.75)
  assert.equal(h.realized, 0)
  assert.equal(h.bought, 300) // 累计买入不含手续费
  assert.equal(h.feePaid, 3)
  assert.equal(r.hasBlocking, false)
})

test('卖出：按此前平均成本扣减，差额计入已实现盈亏', () => {
  const r = computeHoldings([
    trade({ id: 'a', date: '2026-01-01', amount: 100, fee: 0, shares: 2 }), // 均价 50
    trade({ id: 'b', date: '2026-02-01', side: 'sell', amount: 120, fee: 0, shares: 2 })
  ])
  const h = holdingOf(r, 'VOO')
  assert.equal(h.shares, 0)
  assert.equal(h.cost, 0) // 卖出全部后成本归零
  assert.equal(h.realized, 20) // 120 − 100
  assert.equal(r.trades[1].realized, 20)
  assert.equal(r.trades[1].costDelta, -100)
  assert.equal(r.trades[1].cashDelta, 120)
})

test('部分卖出：剩余成本按比例扣减，平均成本不变', () => {
  const r = computeHoldings([
    trade({ id: 'a', date: '2026-01-01', amount: 300, fee: 0, shares: 3 }), // 均价 100
    trade({ id: 'b', date: '2026-02-01', side: 'sell', amount: 110, fee: 10, shares: 1 })
  ])
  const h = holdingOf(r, 'VOO')
  assert.equal(h.shares, 2)
  assert.equal(h.cost, 200) // 300 − 100
  assert.equal(h.avgCost, 100) // 部分卖出不改变均价
  assert.equal(h.realized, 0) // 110 − 10 − 100
})

test('卖出手续费计入已实现盈亏', () => {
  const r = computeHoldings([
    trade({ id: 'a', amount: 100, shares: 1 }),
    trade({ id: 'b', date: '2026-02-01', side: 'sell', amount: 150, fee: 5, shares: 1 })
  ])
  assert.equal(holdingOf(r, 'VOO').realized, 45) // 150 − 5 − 100
})

test('卖出超过持仓：拒绝入账并标记，持仓保持不变', () => {
  const r = computeHoldings([
    trade({ id: 'a', amount: 100, shares: 1 }),
    trade({ id: 'b', date: '2026-02-01', side: 'sell', amount: 500, shares: 5 })
  ])
  assert.equal(r.trades[1].status, '卖出超过持仓')
  assert.equal(r.trades[1].sharesDelta, 0)
  assert.equal(r.trades[1].cashDelta, 0)
  assert.equal(holdingOf(r, 'VOO').shares, 1) // 没有被扣掉
  assert.equal(r.hasBlocking, true)
})

test('刚好卖完全部持仓不算超卖（浮点容差）', () => {
  const r = computeHoldings([
    trade({ id: 'a', amount: 375, shares: 0.5373 }),
    trade({ id: 'b', date: '2026-02-01', side: 'sell', amount: 400, shares: 0.5373 })
  ])
  assert.equal(r.trades[1].status, '已记录')
  assert.equal(holdingOf(r, 'VOO').shares, 0)
})

test('单元格空着 → 待补日期／金额／份额', () => {
  assert.equal(statusOf(trade({ id: 'a', date: '' })), '待补日期／金额／份额')
  assert.equal(statusOf(trade({ id: 'b', amount: undefined as unknown as number })), '待补日期／金额／份额')
  assert.equal(statusOf(trade({ id: 'c', shares: undefined as unknown as number })), '待补日期／金额／份额')
  // 没选 ETF 也算没填完
  assert.equal(statusOf(trade({ id: 'd', symbol: '' })), '待补日期／金额／份额')
})

test('填了 0 或负数 → 请检查输入（原表这一支先于「待补」之后的校验）', () => {
  assert.equal(statusOf(trade({ id: 'a', amount: 0 })), '请检查输入')
  assert.equal(statusOf(trade({ id: 'b', shares: 0 })), '请检查输入')
  assert.equal(statusOf(trade({ id: 'c', amount: -1 })), '请检查输入')
})

test('非法输入 → 请检查输入', () => {
  assert.equal(statusOf(trade({ id: 'a', amount: -1 })), '请检查输入')
  assert.equal(statusOf(trade({ id: 'b', fee: -1 })), '请检查输入')
  assert.equal(statusOf(trade({ id: 'c', side: 'x' as Trade['side'] })), '请检查输入')
  // 卖出手续费比成交金额还大
  assert.equal(statusOf(trade({ id: 'd', side: 'sell', amount: 1, fee: 2, shares: 1 })), '请检查输入')
})

test('前面还有未记录的同类交易 → 待补前序记录', () => {
  assert.equal(statusOf(trade({ id: 'a' }), 0, 1), '待补前序记录')
})

test('前序缺项会向后传染，且顺序仍按日期重排', () => {
  const r = computeHoldings([
    trade({ id: 'bad', date: '2026-01-01', amount: undefined as unknown as number, shares: undefined as unknown as number }), // 未填完
    trade({ id: 'later', date: '2026-03-01', amount: 100, shares: 1 })
  ])
  assert.equal(r.trades[0].status, '待补日期／金额／份额')
  assert.equal(r.trades[1].status, '待补前序记录')
  assert.equal(r.trades[1].priorIncomplete, 1)
})

test('乱序录入：重放顺序按日期升序，与录入顺序无关', () => {
  const r = computeHoldings([
    trade({ id: 'late', date: '2026-05-01', amount: 200, shares: 2 }),
    trade({ id: 'early', date: '2026-01-01', amount: 100, shares: 1 })
  ])
  // 结果数组按时间重放顺序输出
  assert.deepEqual(r.trades.map(t => t.id), ['early', 'late'])
  const h = holdingOf(r, 'VOO')
  assert.equal(h.shares, 3)
  assert.equal(h.cost, 300)
})

test('同一天按录入顺序重放', () => {
  const r = computeHoldings([
    trade({ id: 'first', date: '2026-01-01', amount: 100, shares: 1 }),
    trade({ id: 'second', date: '2026-01-01', side: 'sell', amount: 60, shares: 1 })
  ])
  assert.deepEqual(r.trades.map(t => t.id), ['first', 'second'])
  assert.equal(r.trades[1].status, '已记录')
  assert.equal(r.trades[1].priorShares, 1)
})

test('多只 ETF 互不干扰', () => {
  const r = computeHoldings([
    trade({ id: 'v', symbol: 'VOO', amount: 100, shares: 1 }),
    trade({ id: 'q', symbol: 'QQQM', date: '2026-01-02', amount: 50, shares: 2 }),
    trade({ id: 's', symbol: 'SMH', date: '2026-01-03', amount: 25, shares: 5 })
  ])
  assert.equal(holdingOf(r, 'VOO').cost, 100)
  assert.equal(holdingOf(r, 'QQQM').cost, 50)
  assert.equal(holdingOf(r, 'SMH').cost, 25)
  assert.equal(r.hasBlocking, false)
})

test('小数份额保留 6 位，不产生浮点尾数', () => {
  const r = computeHoldings([
    trade({ id: 'a', amount: 375, shares: 0.5373 }),
    trade({ id: 'b', date: '2026-01-02', amount: 300, shares: 0.9629 })
  ])
  assert.equal(holdingOf(r, 'VOO').shares, 1.5002)
})

test('空交易列表返回零持仓，界面无需判空', () => {
  const r = computeHoldings([])
  assert.equal(r.hasBlocking, false)
  assert.equal(holdingOf(r, 'VOO').shares, 0)
  assert.equal(holdingOf(r, 'VOO').avgCost, 0)
})
