import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOM, escapeField, money, shares, toCsv, toCsvWithBom } from '../src/core/csv.ts'

test('含逗号、引号、换行的字段会被正确转义', () => {
  assert.equal(escapeField('普通'), '普通')
  assert.equal(escapeField('a,b'), '"a,b"')
  assert.equal(escapeField('说"引号"'), '"说""引号"""')
  assert.equal(escapeField('两\n行'), '"两\n行"')
  assert.equal(escapeField(undefined), '')
  assert.equal(escapeField(null), '')
  assert.equal(escapeField(0), '0') // 0 不能被当成空
})

test('表头与数据行按 CRLF 分隔，列表为空也能出表头', () => {
  const columns = [
    { header: '日期', value: (r: { date: string; amount: number }) => r.date },
    { header: '金额', value: (r: { date: string; amount: number }) => money(r.amount) }
  ]
  const csv = toCsv([], columns)
  assert.equal(csv, '日期,金额\r\n')

  const csv2 = toCsv([{ date: '2026-01-01', amount: 1.5 }], columns)
  assert.equal(csv2, '日期,金额\r\n2026-01-01,1.50\r\n')
})

test('带 BOM 的 CSV 开头是 UTF-8 BOM，Excel 打开中文不乱码', () => {
  const csv = toCsvWithBom([], [{ header: '日期', value: () => 'x' }])
  assert.ok(csv.startsWith(BOM))
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.equal(BOM, '\uFEFF')
})

test('表头本身含逗号时也会被转义', () => {
  const csv = toCsv([], [{ header: '金额,USD', value: () => 1 }])
  assert.equal(csv, '"金额,USD"\r\n')
})

test('金额格式化保留 2 位，份额保留 6 位，空值输出空字符串', () => {
  assert.equal(money(1.005), '1.01')
  assert.equal(money(0), '0.00')
  assert.equal(money(undefined), '')
  assert.equal(shares(0.5373), '0.537300')
  assert.equal(shares(undefined), '')
})

test('CSV 里的值不会因为数字 0 而丢列', () => {
  const csv = toCsv(
    [{ a: 0, b: 0 }],
    [
      { header: 'A', value: (r: { a: number }) => r.a },
      { header: 'B', value: (r: { b: number }) => r.b }
    ]
  )
  assert.equal(csv, 'A,B\r\n0,0\r\n')
})
