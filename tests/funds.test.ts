import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  batchStatus,
  computeBatches,
  computeDividends,
  computeFx,
  computeTransfers,
  computeWithdrawals,
  creditedUsd,
  fxRate,
  fxStatus,
  netDividendsTotal,
  receivedUsdTotal,
  transferDifference,
  transferStatus,
  totalsByCurrency,
  withdrawalStatus
} from '../src/core/funds.ts'
import type { BatchRecord, FxRecord, TransferRecord, WithdrawalRecord } from '../src/core/types.ts'

function fx(over: Partial<FxRecord> & { id: string }): FxRecord {
  return {
    date: '2026-01-01',
    fromAccount: '国内银行',
    fromCurrency: 'RMB',
    amount: 5000,
    toAccount: '香港汇丰',
    toCurrency: 'HKD',
    received: 5786.19,
    ...over
  } as FxRecord
}

function transfer(over: Partial<TransferRecord> & { id: string }): TransferRecord {
  return {
    date: '2026-01-01',
    fromAccount: '嘉信入金中转',
    currency: 'USD',
    amount: 1000,
    toAccount: '嘉信证券',
    received: 1000,
    receivedDate: '2026-01-01',
    ...over
  } as TransferRecord
}

// ---------------------------------------------------------------------------
// 换汇
// ---------------------------------------------------------------------------

test('汇率 = 付币本金 ÷ 实际收到', () => {
  assert.equal(fxRate(5000, 5786.19), 5000 / 5786.19)
  assert.equal(fxRate(0, 100), undefined)
  assert.equal(fxRate(100, 0), undefined)
})

test('只有收到 USD 且进嘉信渠道才计入嘉信入金', () => {
  assert.equal(creditedUsd(fx({ id: 'a' })), 0) // 收 HKD
  assert.equal(
    creditedUsd(fx({ id: 'b', fromAccount: '香港汇丰', fromCurrency: 'HKD', toAccount: '嘉信入金中转', toCurrency: 'USD', received: 1017.89 })),
    1017.89
  )
  // 付币账户是嘉信证券的属于内部划转，不重复计入
  assert.equal(
    creditedUsd(fx({ id: 'c', fromAccount: '嘉信证券', toAccount: '嘉信入金中转', toCurrency: 'USD' })),
    0
  )
  // 日期非法
  assert.equal(creditedUsd(fx({ id: 'd', date: '', toCurrency: 'USD' })), 0)
})

test('换汇检查状态', () => {
  assert.equal(fxStatus(fx({ id: 'a' })), '已记录')
  assert.equal(fxStatus({ id: 'b' } as FxRecord), '') // 完全空白不提示
  assert.equal(fxStatus(fx({ id: 'c', received: 0 })), '待补换汇信息')
  // 付币与收币同币种
  assert.equal(fxStatus(fx({ id: 'd', toCurrency: 'RMB', received: 5000 })), '请检查币种／金额／费用')
  // 有费用但没填费用币种
  assert.equal(fxStatus(fx({ id: 'e', feeAmount: 10 })), '请检查币种／金额／费用')
  // 费用币种填了就是正常
  assert.equal(fxStatus(fx({ id: 'f', feeAmount: 10, feeCurrency: 'RMB' })), '已记录')
})

test('换汇计算会带上汇率与计入金额', () => {
  const rows = computeFx([
    fx({ id: 'a', fromAccount: '香港汇丰', fromCurrency: 'HKD', toAccount: '嘉信入金中转', toCurrency: 'USD', amount: 8000, received: 1017.89 })
  ])
  assert.equal(rows[0].creditedUsd, 1017.89)
  assert.ok(rows[0].rate !== undefined && Math.abs(rows[0].rate - 8000 / 1017.89) < 1e-9)
})

// ---------------------------------------------------------------------------
// 入金
// ---------------------------------------------------------------------------

test('到账差额 = 汇出本金 − 实际到账', () => {
  assert.equal(transferDifference(1000, 995), 5)
  assert.equal(transferDifference(undefined, 995), undefined)
  assert.equal(transferDifference(1000, undefined), undefined)
})

test('入金检查状态', () => {
  assert.equal(transferStatus(transfer({ id: 'a' })), '已记录')
  assert.equal(transferStatus({ id: 'b' } as TransferRecord), '')
  // 缺汇出信息
  assert.equal(transferStatus(transfer({ id: 'c', fromAccount: '' as TransferRecord['fromAccount'] })), '待补汇出信息')
  // 汇出与收款账户相同
  assert.equal(transferStatus(transfer({ id: 'd', fromAccount: '嘉信证券', toAccount: '嘉信证券' })), '请检查本金／费用／账户')
  // 有费用但没填币种
  assert.equal(transferStatus(transfer({ id: 'e', feeAmount: 5 })), '请检查本金／费用／账户')
  // 未到账是在途状态，不是错误
  assert.equal(transferStatus(transfer({ id: 'f', received: undefined, receivedDate: undefined })), '在途／待补到账')
  // 到账日期早于汇出日期
  assert.equal(transferStatus(transfer({ id: 'g', date: '2026-05-01', receivedDate: '2026-01-01' })), '请检查到账信息')
})

// ---------------------------------------------------------------------------
// 到账 USD 去重口径
// ---------------------------------------------------------------------------

test('到账 USD 只统计换汇计入金额与直接进嘉信证券的转账，中转不重复加总', () => {
  const fxRows = computeFx([
    // 人民币 → 港元（不计入）
    fx({ id: 'a' }),
    // 港元 → 嘉信入金中转 USD（计入 1017.89）
    fx({ id: 'b', fromAccount: '香港汇丰', fromCurrency: 'HKD', toAccount: '嘉信入金中转', toCurrency: 'USD', amount: 8000, received: 1017.89 })
  ])
  const transferRows = computeTransfers([
    // 中转 → 嘉信证券：必须计入
    transfer({ id: 't1', amount: 1017.89, received: 1017.89 }),
    // 直接进中转的转账：不应计入，避免和换汇那笔重复
    transfer({ id: 't2', fromAccount: '香港汇丰', toAccount: '嘉信入金中转', amount: 500, received: 500 })
  ])
  const total = receivedUsdTotal(fxRows, transferRows)
  assert.equal(total, 1017.89 + 1017.89)
})

test('非 USD 的入金不被计入到账美元', () => {
  const transferRows = computeTransfers([transfer({ id: 't1', currency: 'HKD', amount: 1000, received: 1000 })])
  assert.equal(receivedUsdTotal([], transferRows), 0)
})

// ---------------------------------------------------------------------------
// 入金按币种累加（「汇总」卡片）
// ---------------------------------------------------------------------------

test('入金按币种分别累加，不混加不同币种', () => {
  const rows = computeTransfers([
    transfer({ id: 'a', currency: 'USD', amount: 12.73 }),
    transfer({ id: 'b', currency: 'USD', amount: 1273.18 }),
    transfer({ id: 'c', currency: 'USD', amount: 1017.89 }),
    transfer({ id: 'd', currency: 'HKD', amount: 2000 })
  ])
  const totals = totalsByCurrency(rows)
  // 金额大的排前面（USD 2303.8 > HKD 2000）
  assert.deepEqual(totals[0], { currency: 'USD', total: 2303.8, count: 3 })
  assert.deepEqual(totals[1], { currency: 'HKD', total: 2000, count: 1 })
})

test('累加用汇出本金，在途入金也计入（不因未到账而漏掉）', () => {
  const rows = computeTransfers([
    transfer({ id: 'a', currency: 'USD', amount: 100, received: 100, receivedDate: '2026-01-01' }),
    // 在途：还没到账
    transfer({ id: 'b', currency: 'USD', amount: 250, received: undefined, receivedDate: undefined })
  ])
  const totals = totalsByCurrency(rows)
  assert.equal(totals.length, 1)
  assert.equal(totals[0].total, 350) // 100 + 250，两笔本金都算进去
  assert.equal(totals[0].count, 2)
})

test('没有入金时返回空列表，界面显示提示而不是 0.00', () => {
  assert.deepEqual(totalsByCurrency([]), [])
})

test('币种大小写统一，未填币种归到「未填币种」', () => {
  const rows = computeTransfers([
    transfer({ id: 'a', currency: 'usd', amount: 100 }),
    transfer({ id: 'b', currency: 'USD', amount: 50 }),
    transfer({ id: 'c', currency: '', amount: 20 })
  ])
  const totals = totalsByCurrency(rows)
  const usd = totals.find(t => t.currency === 'USD')
  assert.equal(usd?.total, 150)
  assert.equal(usd?.count, 2)
  assert.ok(totals.some(t => t.currency === '未填币种'))
})

test('累加结果取到分，不出现浮点尾数', () => {
  const rows = computeTransfers([
    transfer({ id: 'a', currency: 'USD', amount: 0.1 }),
    transfer({ id: 'b', currency: 'USD', amount: 0.2 })
  ])
  assert.equal(totalsByCurrency(rows)[0].total, 0.3)
})

// ---------------------------------------------------------------------------
// 分红
// ---------------------------------------------------------------------------

test('税后分红 = 税前 − 预扣税 − 其他费用', () => {
  const rows = computeDividends([
    { id: 'a', date: '2026-01-01', symbol: 'VOO', gross: 10, tax: 3, fee: 0.5 },
    { id: 'b', date: '2026-02-01', symbol: 'QQQM', gross: 5, tax: 1.5 }
  ])
  assert.equal(rows[0].net, 6.5)
  assert.equal(rows[1].net, 3.5)
  assert.equal(netDividendsTotal(rows), 10)
})

// ---------------------------------------------------------------------------
// 出金
// ---------------------------------------------------------------------------

function withdrawal(over: Partial<WithdrawalRecord> & { id: string }): WithdrawalRecord {
  return {
    date: '2026-01-01',
    fromAccount: '嘉信证券',
    currency: 'USD',
    amount: 1000,
    toAccount: '国内银行',
    received: 1000,
    receivedDate: '2026-01-02',
    ...over
  } as WithdrawalRecord
}

test('出金状态：与入金同构，措辞改成出金', () => {
  assert.equal(withdrawalStatus(withdrawal({ id: 'a' })), '已记录')
  assert.equal(withdrawalStatus({ id: 'b' } as WithdrawalRecord), '')
  // 缺信息
  assert.equal(withdrawalStatus(withdrawal({ id: 'c', fromAccount: '' })), '待补出金信息')
  // 汇出与收款账户相同：出金不可能原地打转，判为填错
  assert.equal(withdrawalStatus(withdrawal({ id: 'd', fromAccount: '嘉信证券', toAccount: '嘉信证券' })), '请检查本金／费用／账户')
  // 未到账是在途，不是错误
  assert.equal(withdrawalStatus(withdrawal({ id: 'e', received: undefined, receivedDate: undefined })), '在途／待补到账')
  // 到账日期早于汇出日期
  assert.equal(withdrawalStatus(withdrawal({ id: 'f', date: '2026-05-01', receivedDate: '2026-01-01' })), '请检查到账信息')
})

test('出金计算带上到账差额', () => {
  const rows = computeWithdrawals([withdrawal({ id: 'a', amount: 1000, received: 995 })])
  assert.equal(rows[0].difference, 5)
  assert.equal(rows[0].status, '已记录')
})

test('出金不计入「到账 USD」——那是入金口径，出金是资金离场', () => {
  const transferRows = computeTransfers([transfer({ id: 't1', amount: 1017.89, received: 1017.89 })])
  const before = receivedUsdTotal([], transferRows)
  // 即便出金也是「到嘉信证券」的 USD，也不该被加进去
  const withdrawalRows = computeWithdrawals([
    withdrawal({ id: 'w1', toAccount: '嘉信证券', currency: 'USD', received: 5000 })
  ])
  void withdrawalRows
  const after = receivedUsdTotal([], transferRows)
  assert.equal(before, after)
  assert.equal(after, 1017.89)
})

// ---------------------------------------------------------------------------
// 原入金批次（界面上已移除，函数保留以兼容老备份）
// ---------------------------------------------------------------------------

function batch(over: Partial<BatchRecord> & { id: string }): BatchRecord {
  return {
    date: '2026-01-01',
    rmbPrincipal: 5000,
    hkdBought: 5786.19,
    sentHkd: 5786.19,
    hsbcInHkd: 5786.19,
    hsbcOutHkd: 5786.19,
    usdReceived: 738.29,
    usdDate: '2026-01-03',
    ...over
  } as BatchRecord
}

test('批次四段余额与两段汇率', () => {
  const rows = computeBatches([batch({ id: 'a', hkdFee: 10 })])
  const b = rows[0]
  assert.ok(Math.abs((b.rmbPerHkd ?? 0) - 5000 / 5786.19) < 1e-9)
  assert.equal(b.firstLegDeduction, 0)
  assert.equal(b.domesticLeftover, 0)
  assert.equal(b.hsbcLeftover, -10) // 5786.19 − 5786.19 − 10
  assert.equal(b.status, '金额关系待检查')
})

test('尚有港元余额时不算完整划转，也不出整批成本', () => {
  // 港元买齐、全额汇到汇丰，但只从汇丰汇出 4000 → 汇丰还剩 1786.19
  const rows = computeBatches([batch({ id: 'a', hsbcOutHkd: 4000 })])
  const b = rows[0]
  assert.equal(b.domesticLeftover, 0)
  assert.equal(b.hsbcLeftover, 1786.19)
  assert.equal(b.status, '尚有港元余额')
  assert.equal(b.batchCost, undefined) // 正是原表「不计算整批成本」的用意
  assert.equal(b.rmbPerUsd, undefined)
})

test('国内少汇一段时首段扣减为负，状态报金额关系待检查', () => {
  // 只从国内汇出 4000，却记了汇丰到账 5786.19：这两段对不上
  const rows = computeBatches([batch({ id: 'a', sentHkd: 4000 })])
  assert.equal(rows[0].firstLegDeduction, -1786.19)
  assert.equal(rows[0].status, '金额关系待检查')
})

test('完整划转后才给出整批成本与人民币／美元成本', () => {
  const rows = computeBatches([batch({ id: 'a', extraFeeRmb: 50 })])
  const b = rows[0]
  assert.equal(b.status, '已完整划转')
  assert.equal(b.batchCost, 5050)
  // 汇率保持全精度，不取到分
  assert.equal(b.rmbPerUsd, 5050 / 738.29)
})

test('缺分段信息 → 待补分段记录', () => {
  // 只填了第一段（购汇本金与港元），后续四段全空
  assert.equal(batchStatus({ id: 'a', date: '2026-01-01', rmbPrincipal: 5000, hkdBought: 5786.19 } as BatchRecord), '待补分段记录')
  const rows = computeBatches([batch({ id: 'a', usdReceived: undefined })])
  assert.equal(rows[0].status, '待补分段记录')
})

test('空白批次不提示状态', () => {
  const rows = computeBatches([{ id: 'a', date: '', rmbPrincipal: 0, hkdBought: 0 } as BatchRecord])
  assert.equal(rows[0].status, undefined)
})
