/**
 * 数字输入框的取值规则（纯函数，便于单测）。
 *
 * 抽到这里而不是留在组件里，有两个原因：
 * 1. 这里出过一个真实 bug——原来用 `<input type="number" step="any">`，
 *    用户反馈「成交份额填不了 0.01」。规则独立出来才能被测试盯住。
 * 2. Node 的测试运行器认不得 `.tsx`，纯逻辑放 `.ts` 才能直接跑。
 */

/**
 * 只允许数字、一个小数点、可选负号；非法字符会被剔除。
 * 中文输入法下的全角句号「。」与全角逗号「，」一并归一化。
 *
 * 多个小数点或位置不对的负号属于「不合规」，整体拒绝（返回 undefined），
 * 而不是猜用户想要什么。
 */
export function sanitizeNumericInput(raw: string): string | undefined {
  const normalized = raw.replace(/[．。]/g, '.').replace(/[，,]/g, '').replace(/[^\d.-]/g, '')
  if (!/^-?\d*\.?\d*$/.test(normalized)) return undefined
  return normalized
}

/**
 * 把输入文本解析成数字。
 *
 * `ready` 为 false 表示文本还是中间态（如 `1.`），此时不该向上报值——
 * 否则用户敲 `0.` 的瞬间会被清成 0，感觉「刚敲就被擦掉」。
 * 空串、单独的负号或小数点算「未填」，返回 undefined 而不是 0。
 */
export function parseNumericInput(current: string): { ready: boolean; value: number | undefined } {
  const trimmed = current.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return { ready: true, value: undefined }
  }
  if (trimmed.endsWith('.')) return { ready: false, value: undefined }
  const n = Number(trimmed)
  return Number.isFinite(n) ? { ready: true, value: n } : { ready: false, value: undefined }
}

/** 数字转成输入框显示用的文本；无值或非法值显示空串。 */
export function numericToText(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value)
}
