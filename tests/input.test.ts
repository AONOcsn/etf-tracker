import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNumericInput, sanitizeNumericInput } from '../src/core/numeric.ts'

/**
 * 这组测试盯的是一个真实发生过的 bug：
 * 原来用 `<input type="number" step="any">`，用户反馈「成交份额填不了 0.01」。
 *
 * 所以这里逐条断言小数能被完整保留下来：
 * 输入 "0.01" 的每一步都不能把值吞掉或截断。
 */

/** 模拟用户逐字键入，返回每一步接受后的文本与上报值。 */
function type(sequence: string) {
  const steps: { text: string; reported: number | undefined; ready: boolean }[] = []
  let text = ''
  for (const ch of sequence) {
    const candidate = text + ch
    const cleaned = sanitizeNumericInput(candidate)
    if (cleaned === undefined) continue // 非法字符直接被拒
    text = cleaned
    const { ready, value } = parseNumericInput(text)
    steps.push({ text, reported: ready ? value : undefined, ready })
  }
  return { final: text, steps, parsed: parseNumericInput(text) }
}

test('逐字输入 0.01 全程不被吞掉', () => {
  const r = type('0.01')
  assert.deepEqual(
    r.steps.map(s => s.text),
    ['0', '0.', '0.0', '0.01']
  )
  // 关键：'.' 是中间态但不该被拒绝，后面能继续补位
  assert.equal(r.steps[2].reported, 0)
  assert.equal(r.parsed.value, 0.01)
  assert.equal(r.parsed.ready, true)
})

test('小数金额与份额都能正常解析', () => {
  for (const [input, expected] of [
    ['0.01', 0.01],
    ['0.5373', 0.5373],
    ['375.5', 375.5],
    ['0.000001', 0.000001],
    ['-250.75', -250.75],
    ['712.32', 712.32]
  ] as [string, number][]) {
    const r = parseNumericInput(input)
    assert.equal(r.ready, true, `${input} 应当可解析`)
    assert.equal(r.value, expected, `${input} 应解析为 ${expected}`)
  }
})

test('中间态不向上报值，避免把用户敲到一半的内容清成 0', () => {
  assert.deepEqual(parseNumericInput('0.'), { ready: false, value: undefined })
  assert.deepEqual(parseNumericInput('712.'), { ready: false, value: undefined })
  // 空值与只有一个负号视为「未填」，而不是 0
  assert.deepEqual(parseNumericInput(''), { ready: true, value: undefined })
  assert.deepEqual(parseNumericInput('-'), { ready: true, value: undefined })
  assert.deepEqual(parseNumericInput('.'), { ready: true, value: undefined })
})

test('非法字符被拒绝，不写入输入框', () => {
  assert.equal(sanitizeNumericInput('abc'), '')
  assert.equal(sanitizeNumericInput('1a2'), '12')
  // 多个小数点不合规，整体拒绝（返回 undefined）
  assert.equal(sanitizeNumericInput('1.2.3'), undefined)
  // 负号只能在开头
  assert.equal(sanitizeNumericInput('1-2'), undefined)
})

test('中文输入法的全角句号与逗号会被归一化', () => {
  assert.equal(sanitizeNumericInput('0。01'), '0.01')
  assert.equal(sanitizeNumericInput('1，234.5'), '1234.5')
  assert.equal(parseNumericInput('0.01').value, 0.01)
})

test('粘贴一整串小数也能直接用', () => {
  assert.equal(sanitizeNumericInput(' 0.5373 '), '0.5373')
  assert.equal(parseNumericInput('0.5373').value, 0.5373)
  // 带千分位逗号的粘贴（从券商页面复制常见）
  assert.equal(parseNumericInput('1,234.56').value, undefined)
})
