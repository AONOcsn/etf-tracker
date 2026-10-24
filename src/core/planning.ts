import type { AppData } from './types.ts'
import { currentPeriod } from './types.ts'
import { computeDrawdown } from './drawdown.ts'
import { computeMonthly } from './monthly.ts'

/** 不写入空月份；查询时补上选中月份和有成交的月份，旧历史照常保留。 */
export function planning(data: AppData, period = currentPeriod()) {
  const months = [...data.planMonths]
  const periods = new Set(months.map(m => m.period))
  for (const p of [period, currentPeriod(), ...data.trades.map(t => t.date.slice(0, 7))]) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p) && !periods.has(p)) { months.push({ period: p }); periods.add(p) }
  }
  const drawdown = computeDrawdown({ months, settings: data.settings, trades: data.trades, etfs: data.etfs })
  const monthly = computeMonthly(drawdown.rows, data.etfs, data.trades)
  return { drawdown, monthly, current: drawdown.rows.find(r => r.period === period)!, execution: monthly.find(r => r.period === period)! }
}
