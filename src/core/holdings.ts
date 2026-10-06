import type { AppData, Side, Trade } from './types.ts'
import { dayToOrdinal, isDay, round6 } from './types.ts'

/**
 * 持仓重算：移动加权平均法。
 *
 * 这一支直接对应原表「交易记录」的 G–O 列和 P 列：
 *   K 列 检查状态、H 列 成本变动、I 列 份额变动、J 列 已实现盈亏、
 *   M/N/O 列 前序份额／前序成本／前序缺项。
 *
 * 原表用逐行 SUMIF 往上累加实现「前序」，这里改成一次按日期重放，
 * 结果等价，但关系是显式的、可单测的（原表那种自引用公式很难验证）。
 */

export type CheckState =
  | '待补日期／金额／份额'
  | '请检查输入'
  | '待补前序记录'
  | '卖出超过持仓'
  | '已记录'

export interface TradeComputed extends Trade {
  /** 该笔之前，同一 ETF 的已有份额。 */
  priorShares: number
  /** 该笔之前，同一 ETF 的已有成本。 */
  priorCost: number
  /** 该笔之前，同一 ETF 尚未「已记录」的笔数（原表 O 列）。 */
  priorIncomplete: number
  /** 现金变动：买入为负（含手续费），卖出为正。 */
  cashDelta: number
  /** 成本变动：买入为 +（金额+手续费），卖出为扣减的账面成本（负数）。 */
  costDelta: number
  /** 份额变动：买入为 +，卖出为 −。 */
  sharesDelta: number
  /** 已实现盈亏（仅卖出有值，其余为 0）。 */
  realized: number
  status: CheckState
}

export interface Holding {
  symbol: string
  /** 当前份额。 */
  shares: number
  /** 当前持仓成本。 */
  cost: number
  /** 平均成本／份。 */
  avgCost: number
  /** 累计已实现盈亏。 */
  realized: number
  /** 累计买入金额（不含手续费）。 */
  bought: number
  /** 累计买入手续费。 */
  feePaid: number
}

export interface HoldingsResult {
  trades: TradeComputed[]
  bySymbol: Record<string, Holding>
  /** 任何一笔没能入账（状态不是「已记录」）时为 true。 */
  hasBlocking: boolean
}

/**
 * 一笔交易的检查状态，逐条对应原表 K 列公式。
 *
 * 关键区别（照原表公式来，不要想当然）：
 * - 单元格**空着** → 「待补日期／金额／份额」
 * - 单元格填了 **0 或负数** → 「请检查输入」
 * 原表是 IF(OR(A6="",D6="",F6="",C6=""),"待补…", IF(OR(D6<=0,…),"请检查输入",…))，
 * 所以 0 走的是「请检查输入」那一支，不是「待补」。
 */
export function tradeStatus(
  t: Pick<Trade, 'date' | 'symbol' | 'side' | 'amount' | 'fee' | 'shares'>,
  priorShares: number,
  priorIncomplete: number
): CheckState {
  if (!t.symbol) return '待补日期／金额／份额'
  const blank =
    !isDay(t.date) ||
    t.amount === undefined ||
    t.amount === null ||
    t.shares === undefined ||
    t.shares === null ||
    !t.side
  if (blank) return '待补日期／金额／份额'

  const validSide = t.side === 'buy' || t.side === 'sell'
  if (
    t.amount <= 0 ||
    t.shares <= 0 ||
    t.fee < 0 ||
    !validSide ||
    (t.side === 'sell' && t.fee > t.amount)
  ) {
    return '请检查输入'
  }
  if (priorIncomplete > 0) return '待补前序记录'
  // 加一个极小容差，避免浮点误差把刚好卖完的仓位判成超卖（原表用 0.00000001）。
  if (t.side === 'sell' && t.shares > priorShares + 1e-8) return '卖出超过持仓'
  return '已记录'
}

/**
 * 把交易列表按时间重放，算出逐笔变化与每只 ETF 的最终持仓。
 *
 * 排序按日期升序，同一天保持录入顺序（原表「同一天按实际成交顺序」的要求）。
 * 未通过检查的交易仍然出现在结果里（界面要显示它和原因），但不入账。
 */
export function computeHoldings(trades: Trade[]): HoldingsResult {
  const ordered = trades
    .map((t, index) => ({ t, index }))
    .sort((a, b) => {
      const da = dayToOrdinal(a.t.date)
      const db = dayToOrdinal(b.t.date)
      // 日期非法的排在后面，避免 NaN 打乱比较
      const na = Number.isNaN(da) ? Number.POSITIVE_INFINITY : da
      const nb = Number.isNaN(db) ? Number.POSITIVE_INFINITY : db
      if (na !== nb) return na - nb
      return a.index - b.index
    })

  const state: Record<string, { shares: number; cost: number; realized: number; bought: number; fee: number }> = {}
  const incomplete: Record<string, number> = {}
  const out: TradeComputed[] = []

  const bucket = (symbol: string) => {
    state[symbol] ??= { shares: 0, cost: 0, realized: 0, bought: 0, fee: 0 }
    return state[symbol]
  }

  for (const { t } of ordered) {
    const symbol = t.symbol || ''
    const current = symbol ? bucket(symbol) : { shares: 0, cost: 0, realized: 0, bought: 0, fee: 0 }
    const priorShares = current.shares
    const priorCost = current.cost
    const priorIncomplete = incomplete[symbol] ?? 0

    const status = tradeStatus(t, priorShares, priorIncomplete)

    let cashDelta = 0
    let costDelta = 0
    let sharesDelta = 0
    let realized = 0

    if (status === '已记录') {
      if (t.side === 'buy') {
        cashDelta = -(t.amount + t.fee)
        costDelta = t.amount + t.fee
        sharesDelta = t.shares
        current.shares += t.shares
        current.cost += t.amount + t.fee
        current.bought += t.amount
        current.fee += t.fee
      } else {
        const avg = priorShares === 0 ? 0 : priorCost / priorShares
        // 卖出按此前平均成本扣减账面成本；差额计入已实现盈亏。
        const costOut = avg * t.shares
        cashDelta = t.amount - t.fee
        costDelta = -costOut
        sharesDelta = -t.shares
        realized = t.amount - t.fee - costOut
        current.shares -= t.shares
        current.cost -= costOut
        current.realized += realized
        current.fee += t.fee
      }
      // 买卖记在同一张表里，所以 bought 用「买入加、卖出减」净额表达：
      // 累计卖出超过累计买入时它可能为负，含义是净投入减少。
      if (t.side === 'sell') current.bought -= t.amount
      // 份额归零时把残值抹平，避免浮点尾数留在成本里
      if (Math.abs(current.shares) < 1e-9) {
        current.shares = 0
        current.cost = 0
      }
    } else if (symbol) {
      incomplete[symbol] = priorIncomplete + 1
    }

    out.push({
      ...t,
      priorShares,
      priorCost,
      priorIncomplete,
      cashDelta,
      costDelta,
      sharesDelta,
      realized,
      status
    })
  }

  const bySymbol: Record<string, Holding> = {}
  for (const [symbol, s] of Object.entries(state)) {
    bySymbol[symbol] = {
      symbol,
      shares: round6(s.shares),
      cost: s.cost,
      avgCost: s.shares === 0 ? 0 : s.cost / s.shares,
      realized: s.realized,
      bought: s.bought,
      feePaid: s.fee
    }
  }

  return {
    trades: out,
    bySymbol,
    hasBlocking: out.some(t => t.status !== '已记录')
  }
}

/** 某只 ETF 的持仓（没有记录时返回零值，界面无需判空）。 */
export function holdingOf(result: HoldingsResult, symbol: string): Holding {
  return (
    result.bySymbol[symbol] ?? {
      symbol,
      shares: 0,
      cost: 0,
      avgCost: 0,
      realized: 0,
      bought: 0,
      feePaid: 0
    }
  )
}

/** 单笔交易的「方向」显示文案。 */
export function sideLabel(side: Side): string {
  return side === 'buy' ? '买入' : '卖出'
}

/** 从应用数据算出持仓。 */
export function holdingsFrom(data: AppData): HoldingsResult {
  return computeHoldings(data.trades)
}
