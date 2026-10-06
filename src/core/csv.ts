/**
 * CSV 导出。
 *
 * 两个必须处理的细节：
 * - 加 UTF-8 BOM，否则 Excel 打开中文表头会乱码（WPS／Excel 都按系统编码猜）。
 * - 字段转义：含逗号、引号、换行的值用双引号包起来，内部引号翻倍。
 */

/** BOM，写成常量方便单测断言。 */
export const BOM = '\uFEFF'

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | undefined | null
}

/** 转义单个 CSV 字段。 */
export function escapeField(value: unknown): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** 生成 CSV 文本（不含 BOM）。 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = []
  lines.push(columns.map(c => escapeField(c.header)).join(','))
  for (const row of rows) {
    lines.push(columns.map(c => escapeField(c.value(row))).join(','))
  }
  // Excel 对结尾换行更友好
  return `${lines.join('\r\n')}\r\n`
}

/** 生成带 BOM 的 CSV 文本，用于直接下载。 */
export function toCsvWithBom<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return BOM + toCsv(rows, columns)
}

/** 数字格式化：保留 2 位小数，空值输出空字符串而不是 0。 */
export function money(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return ''
  // toFixed 对 1.005 会给出 "1.00"（二进制表示略小于 1.005），
  // 财务数字上这种偏差会让人以为少了一分钱，所以先按精度做一次补偿舍入。
  return roundTo(value, 2).toFixed(2)
}

/** 份额格式化：保留 6 位小数。 */
export function shares(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return ''
  return roundTo(value, 6).toFixed(6)
}

/** 补偿浮点误差的定点舍入（half-up）。 */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * factor) / factor
}
