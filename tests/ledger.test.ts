import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyData } from '../src/core/empty.ts'
import { createRecord, validateRecord, saveRecord, ledgerRows, filterLedger, isDuplicate } from '../src/core/ledger.ts'

test('新资金表单只沿用账户和币种，不复制金额与到账日期', () => {
  const data = emptyData()
  data.transfers.push({ id: 'a', date: '2026-10-01', fromAccount: 'A', toAccount: 'B', currency: 'HKD', amount: 500, received: 490, receivedDate: '2026-10-02', note: '旧备注' })
  const form = createRecord(data, 'transfer')
  assert.equal(form.fromAccount, 'A')
  assert.equal(form.currency, 'HKD')
  assert.equal(form.amount, undefined)
  assert.equal(form.received, undefined)
  assert.equal(form.receivedDate, undefined)
  assert.equal(form.note, undefined)
})

test('缺字段与超卖不能进入正式账本，有效成交保持计算口径', () => {
  const data = emptyData()
  const form = { ...createRecord(data, 'buy'), symbol: 'VOO', amount: 100, shares: 1, fee: 0 }
  assert.equal(validateRecord(data, 'buy', form), undefined)
  const saved = saveRecord(data, 'buy', form)
  assert.equal(saved.trades[0].amount, 100)
  assert.ok(validateRecord(data, 'sell', { ...form, id: 'b', shares: 2 }))
  assert.ok(validateRecord(data, 'buy', { ...form, shares: undefined }))
  assert.throws(() => saveRecord(data, 'buy', { ...form, amount: -1 }))
})

test('资金在途是有效正式记录，到账信息必须成对且金额合理', () => {
  const data = emptyData()
  const form = { ...createRecord(data, 'transfer'), amount: 100 }
  assert.equal(validateRecord(data, 'transfer', form), undefined)
  assert.ok(validateRecord(data, 'transfer', { ...form, received: 90 }))
  assert.ok(validateRecord(data, 'transfer', { ...form, feeAmount: -1 }))
})

test('统一记录保留类型和 ID，筛选可组合月份账户备注', () => {
  const data = emptyData()
  data.transfers.push({ id: 'same', date: '2026-10-01', fromAccount: '汇丰', toAccount: '嘉信证券', currency: 'USD', amount: 100, note: '十月定投' })
  data.dividends.push({ id: 'same', date: '2026-10-01', symbol: 'VOO', gross: 10, tax: 1 })
  const rows = ledgerRows(data)
  assert.equal(new Set(rows.map(r => `${r.kind}:${r.id}`)).size, 2)
  const selected = filterLedger(rows, { month: '2026-10', account: '汇丰', query: '定投', type: 'funds' })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].kind, 'transfer')
  assert.equal(filterLedger(rows, { symbol: 'VOO' }).length, 1)
})

test('重复成交提醒排除正在编辑的自己，并允许用户确认后记真实相同成交', () => {
  const data = emptyData()
  const form = { ...createRecord(data, 'buy'), symbol: 'VOO', amount: 100, shares: 1, fee: 0 }
  const saved = saveRecord(data, 'buy', form)
  assert.equal(isDuplicate(saved, 'buy', form), false)
  assert.equal(isDuplicate(saved, 'buy', { ...form, id: 'other' }), true)
  assert.equal(saveRecord(saved, 'buy', { ...form, id: 'other' }).trades.length, 2)
})

test('同日成交在编辑后仍维持原存储顺序', () => {
  const data = emptyData()
  const first = { ...createRecord(data, 'buy'), symbol: 'VOO', amount: 100, shares: 1, fee: 0 }
  const a = saveRecord(data, 'buy', first)
  const b = saveRecord(a, 'buy', { ...first, id: 'second', amount: 200 })
  const edited = saveRecord(b, 'buy', { ...first, amount: 110 })
  assert.deepEqual(edited.trades.map(t => t.id), [first.id, 'second'])
})
