import type { EtfSetting } from './types.ts'
import type { HoldingsResult } from './holdings.ts'
import { holdingOf } from './holdings.ts'
import { num } from './types.ts'

/**
 * 总览聚合，对应原表「总览」第 7–16 行的全部派生列。
 *
 * 注意口径：
 * - 持仓收益率 = 未实现盈亏 ÷ 当前持仓成本，**不是年化收益率**（原表专门注明过）
 * - 「到账 USD」只统计真正进了嘉信渠道的美元，中转步骤不重复加总
 */

export interface EtfRow {
  symbol: string
  targetRatio: number
  /** 基础计划金额：baseMonthly × targetRatio（原表 C 列）。 */
  basePlan: number
  price: number
  priceDate?: string
  shares: number
  cost: number
  avgCost: number
  marketValue: number
  unrealized: number
  /** 持仓收益率。 */
  returnRate: number
  /** 市值占比。 */
  weight: number
  /** 偏离目标 = 市值占比 − 目标比例（原表 M 列）。 */
  deviation: number
  /** 状态（原表 N 列）。 */
  status: string
}

export interface OverviewResult {
  baseMonthly: number
  rows: EtfRow[]
  /** 合计行。 */
  totals: {
    targetRatio: number
    basePlan: number
    cost: number
    marketValue: number
    unrealized: number
    returnRate: number
  }
  /** 现金 USD（手动填）。 */
  cash: number
  /** 总值 = ETF 市值 + 现金。 */
  totalValue: number
  /** 累计买入（不含手续费）。 */
  totalBought: number
  /** 累计已实现盈亏。 */
  realized: number
  /** 向嘉信渠道实际到账的美元累计。 */
  receivedUsd: number
  /** 税后分红累计。 */
  netDividends: number
  /** 额外预算：总额 / 已用 / 剩余。 */
  extraBudgetTotal: number
  extraBudgetUsed: number
  extraBudgetLeft: number
}

/**
 * 单只 ETF 的状态文案。
 *
 * 原表 N 列的顺序是：有未完成记录 → 无持仓 → 缺现价 → 缺价格日期 → 已计算。
 * 这里保持同样的优先级，并把「待补记录」的措辞统一为网页里的检查状态提示。
 */
export function etfStatus(row: {
  incomplete: number
  shares: number
  price: number
  priceDate?: string
  validPriceDate: boolean
}): string {
  if (row.incomplete > 0) return '有未完成记录，请先核对信息'
  if (row.shares === 0) return '无持仓'
  if (!(row.price > 0)) return '等待现价'
  if (!row.validPriceDate) return '缺价格日期'
  return '已计算'
}

/**
 * 汇总总览。
 *
 * @param etfs      ETF 设置（含手填现价）
 * @param holdings  持仓重算结果
 * @param cash      手填现金
 * @param extraUsed 额外预算已用（来自回撤计划的逐月累计）
 * @param extraTotal 额外预算总额
 * @param receivedUsd 向嘉信渠道实际到账的美元累计
 * @param netDividends 税后分红累计
 */
export function computeOverview(params: {
  etfs: EtfSetting[]
  holdings: HoldingsResult
  baseMonthly: number
  cash: number
  extraUsed: number
  extraTotal: number
  receivedUsd: number
  netDividends: number
}): OverviewResult {
  const { etfs, holdings, baseMonthly, cash, extraUsed, extraTotal, receivedUsd, netDividends } = params

  const incompleteBySymbol: Record<string, number> = {}
  for (const t of holdings.trades) {
    if (t.symbol && t.status !== '已记录') incompleteBySymbol[t.symbol] = (incompleteBySymbol[t.symbol] ?? 0) + 1
  }

  const rows: EtfRow[] = etfs.map(etf => {
    const h = holdingOf(holdings, etf.symbol)
    const price = num(etf.price, 0)
    // 没有现价时市值为 0；界面靠 status === '等待现价' 提示，不在这里编造价格。
    const marketValue = h.shares * price
    const unrealized = marketValue - h.cost
    return {
      symbol: etf.symbol,
      targetRatio: num(etf.targetRatio, 0),
      basePlan: num(baseMonthly, 0) * num(etf.targetRatio, 0),
      price,
      priceDate: etf.priceDate,
      shares: h.shares,
      cost: h.cost,
      avgCost: h.avgCost,
      marketValue,
      unrealized,
      returnRate: h.cost === 0 ? 0 : unrealized / h.cost,
      weight: 0,
      deviation: 0,
      status: etfStatus({
        incomplete: incompleteBySymbol[etf.symbol] ?? 0,
        shares: h.shares,
        price,
        priceDate: etf.priceDate,
        validPriceDate: Boolean(etf.priceDate)
      })
    }
  })

  const totalMarketValue = rows.reduce((s, r) => s + r.marketValue, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const totalUnrealized = totalMarketValue - totalCost
  const totalBought = Object.values(holdings.bySymbol).reduce((s, h) => s + h.bought, 0)
  const realized = Object.values(holdings.bySymbol).reduce((s, h) => s + h.realized, 0)

  for (const row of rows) {
    // 原表 L 列在合计市值为 0 或空时整体留空，这里用 0 表达同一含义。
    row.weight = totalMarketValue === 0 ? 0 : row.marketValue / totalMarketValue
    row.deviation = row.weight - row.targetRatio
  }

  return {
    baseMonthly: num(baseMonthly, 0),
    rows,
    totals: {
      targetRatio: rows.reduce((s, r) => s + r.targetRatio, 0),
      basePlan: rows.reduce((s, r) => s + r.basePlan, 0),
      cost: totalCost,
      marketValue: totalMarketValue,
      unrealized: totalUnrealized,
      returnRate: totalCost === 0 ? 0 : totalUnrealized / totalCost
    },
    cash: num(cash, 0),
    totalValue: totalMarketValue + num(cash, 0),
    totalBought,
    realized,
    receivedUsd,
    netDividends,
    extraBudgetTotal: num(extraTotal, 0),
    extraBudgetUsed: num(extraUsed, 0),
    extraBudgetLeft: Math.max(0, num(extraTotal, 0) - num(extraUsed, 0))
  }
}
