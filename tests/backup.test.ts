import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyData } from '../src/core/empty.ts'
import { validateBackup, retainSnapshots } from '../src/core/backup.ts'
import type { Snapshot } from '../src/core/types.ts'

test('有效备份及缺少后加出金字段的旧备份可以导入', () => {
  const data = emptyData()
  assert.deepEqual(validateBackup(data).trades, [])
  const { withdrawals: _oldMissing, ...legacy } = data
  assert.deepEqual(validateBackup(legacy).withdrawals, [])
})

test('无关 JSON、未知版本和坏交易记录拒绝覆盖账本', () => {
  for (const invalid of [{}, [], null, { ...emptyData(), version: 2 },
    { ...emptyData(), trades: [{ id: 'a', date: '2026-10-01', symbol: 'VOO', side: 'buy', amount: '100', shares: 1, fee: 0 }] },
    { ...emptyData(), etfs: [{ symbol: 'VOO', price: 'bad' }] },
    { ...emptyData(), trades: [{ id: 'a', date: '2026-10-01', symbol: 'VOO', side: 'oops' }] }]) {
    assert.throws(() => validateBackup(invalid))
  }
})

test('自动快照不会挤掉误删前恢复点，两类各保留最近七份', () => {
  const data = emptyData()
  const list: Snapshot[] = Array.from({ length: 9 }, (_, i) => ({
    label: `auto-${i}`, at: `2026-10-${String(i + 1).padStart(2, '0')}`, data
  }))
  list.push({ label: '操作前-删除-a', at: '2026-10-01', data })
  const retained = retainSnapshots(list)
  assert.equal(retained.filter(s => s.label.startsWith('auto-')).length, 7)
  assert.ok(retained.some(s => s.label === '操作前-删除-a'))
  assert.ok(!retained.some(s => s.label === 'auto-0'))
})

test('缺少交易必填金额和非法可选日期不能覆盖现有账本', () => {
  const backup = emptyData()
  const trade = { id: 'a', date: '2026-10-01', symbol: 'VOO', side: 'buy', amount: 100, shares: 1 }
  assert.throws(() => validateBackup({ ...backup, trades: [trade] }))
  const transfer = { id: 'b', date: '2026-10-01', fromAccount: '香港汇丰', toAccount: '嘉信证券', currency: 'USD', amount: 100, receivedDate: { bad: true } }
  assert.throws(() => validateBackup({ ...backup, transfers: [transfer] }))
})
