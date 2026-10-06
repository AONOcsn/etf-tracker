import type { EtfSetting, Trade } from './types.ts'
import { monthOf, num } from './types.ts'
import type { PlanRow } from './drawdown.ts'

/**
 * 月度计划，对应原表「月度计划」第 6 行起每一行。
 *
 * 计划金额直接取回撤计划的本月合计，再按各 ETF 的目标比例分配；
 * 实际金额按当月真实成交统计。
 *
 * 与原表的一处刻意差异：原表 F/G/H 列统计实际金额时**不过滤买入用途**，
 * 因此分红再投会被算进「实际合计」，看起来像是超预算。这里对计划相关的
 * ETF 排除「分红再投」与「其他」，让「实际−预算」只反映真实的定投行为。
 * 有特殊用途的买入在交易页单独看得到，不会丢。
 */

export interface MonthRow {
  period: string
  plannedDate: string
  /** 回撤计划本月合计，原表 B 列。 */
  plannedTotal: number
  /** 每只 ETF 的计划金额与实际金额。 */
  etfs: { symbol: string; planned: number; actual: number }[]
  /** 实际合计，原表 I 列。 */
  actualTotal: number
  /** 实际 − 预算，原表 J 列。 */
  diff: number | undefined
  /** 执行状态，原表 K 列。 */
  status: string
}

/**
 * 逐月生成月度计划。
 *
 * @param planRows 回撤计划结果（提供每月合计与计划日）
 * @param etfs     ETF 清单（只有 planned 为 true 的参与计划分配）
 * @param trades   全部交易
 */
export function computeMonthly(planRows: PlanRow[], etfs: EtfSetting[], trades: Trade[]): MonthRow[] {
  const plannedEtfs = etfs.filter(e => e.planned)
  const byMonth = new Map<string, Trade[]>()
  for (const t of trades) {
    const m = monthOf(t.date)
    if (!m) continue
    const list = byMonth.get(m)
    if (list) list.push(t)
    else byMonth.set(m, [t])
  }

  return planRows.map(plan => {
    const monthTrades = byMonth.get(plan.period) ?? []
    const cells = plannedEtfs.map(etf => {
      const planned = plan.monthTotal * num(etf.targetRatio, 0)
      const actual = monthTrades
        .filter(t =>
          t.side === 'buy' &&
          t.symbol === etf.symbol &&
          t.purpose !== '分红再投' &&
          t.purpose !== '其他'
        )
        .reduce((s, t) => s + num(t.amount, 0) + num(t.fee, 0), 0)
      return { symbol: etf.symbol, planned, actual }
    })

    const actualTotal = cells.reduce((s, c) => s + c.actual, 0)
    const diff = actualTotal === 0 ? undefined : actualTotal - plan.monthTotal

    return {
      period: plan.period,
      plannedDate: plan.plannedDate,
      plannedTotal: plan.monthTotal,
      etfs: cells,
      actualTotal,
      diff,
      status:
        actualTotal === 0
          ? '尚未记录买入'
          : diff !== undefined && Math.abs(diff) < 0.01
            ? '已记录预算金额'
            : '已记录，金额有差额'
    }
  })
}
