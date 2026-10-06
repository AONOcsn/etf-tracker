import type { PlanMonth, Settings, Trade } from './types.ts'
import { monthOf, nextPeriod, num, plannedDate, today } from './types.ts'

/**
 * 回撤计划，对应原表「回撤计划」第 9 行起每一行。
 *
 * 核心规则（来自原表公式与「使用说明」第 29、33、46 条）：
 * 1. 回撤 = max(0, 1 − 观察收盘 ÷ 沿用历史高点)
 * 2. 档位：<10% → 基础额；10%~<20% → 基础额+250；≥20% → 基础额+500
 * 3. 沿用历史高点只增不减，且必须把「当月自身收盘」也算进去
 * 4. 额外预算 5000 只被真实成交消耗，不随反弹或新高回补，用尽后档位总额退回基础额
 * 5. 只有计划、没记成交时不扣预算
 */

export const TIER_MID = 250
export const TIER_HIGH = 500

export interface PlanRow {
  period: string
  /** 计划日期（每月 planDay 日），原表 A 列。 */
  plannedDate: string
  /** 观察收盘日，原表 B 列。 */
  observedDate?: string
  /** 标普500收盘，原表 C 列。 */
  spClose?: number
  /** 沿用历史高点（累计最大值），原表 E 列的最终含义。 */
  peak: number
  /** 回撤幅度，原表 F 列。 */
  drawdown?: number
  /** 标准月额（档位总额），原表 G 列。 */
  tierAmount?: number
  /** 月初加投余款 = max(0, 预算总额 − 此前已用)，原表 H 列。 */
  budgetAtStart: number
  /** 计划额外，原表 I 列。 */
  plannedExtra: number
  /** 本月合计 = 基础额 + 计划额外，原表 J 列。 */
  monthTotal: number
  /** VOO 计划金额，原表 K 列。 */
  vooPlan: number
  /** QQQM 计划金额，原表 L 列。 */
  qqqmPlan: number
  /** 实际定投（当月 VOO/QQQM 买入金额+手续费，排除分红再投／其他），原表 M 列。 */
  actualInvested: number
  /** 额外支出参考 = max(0, 实际定投 − 基础额)，原表 N 列。 */
  extraReference: number
  /** 已用额外：手填值优先，否则取参考值，原表 P 列。 */
  extraUsed: number
  /** 月底加投余款，原表 Q 列。 */
  budgetAtEnd: number
  /** 状态，原表 R 列。 */
  status: string
  note?: string
}

export interface DrawdownResult {
  rows: PlanRow[]
  /** 累计已用额外预算 = 各行 extraUsed 之和。 */
  usedTotal: number
  /** 额外预算剩余。 */
  budgetLeft: number
}

/** 判断 x 是否达到阈值 t。加容差，避免 7794.35×0.8 这类算式因浮点误差落在阈值下方。 */
function atLeast(x: number, t: number): boolean {
  return x >= t - 1e-9
}

/**
 * 档位总额：回撤低于 10% 拿基础额，10%~<20% 加 250，20% 及以上加 500。
 *
 * 用容差比较而不是四舍五入后判等：回撤是从收盘价算出来的，
 * 「恰好 20%」在二进制浮点里常常是 0.19999999999999996 或 0.20000000000000018，
 * 直接比较会让本该进高档的月份掉回中档。
 */
export function tierAmount(base: number, drawdown: number | undefined): number | undefined {
  if (drawdown === undefined || !Number.isFinite(drawdown)) return undefined
  if (!atLeast(drawdown, 0.2)) return atLeast(drawdown, 0.1) ? base + TIER_MID : base
  return base + TIER_HIGH
}

/**
 * 逐月推进算出整张回撤计划表。
 *
 * @param months    计划月份（按 period 升序）
 * @param settings  参数（基础额、预算总额、起始高点、计划日、调仓比例）
 * @param trades    全部交易（用于统计当月实际定投）
 */
export function computeDrawdown(params: {
  months: PlanMonth[]
  settings: Settings
  trades: Trade[]
  /** 仅在看涨方向计入的只读回调，便于测试注入「今天」。 */
  now?: string
}): DrawdownResult {
  const { months, trades, settings } = params
  const base = num(settings.baseMonthly, 0)
  const budgetTotal = num(settings.extraBudgetTotal, 0)
  const planDay = num(settings.planDay, 10)
  const rebalance = num(settings.rebalance, 0.1)

  // 目标比例：VOO = 1 − rebalance，QQQM = rebalance（与原表 90%/10% 一致）。
  const vooRatio = 1 - rebalance
  const qqqmRatio = rebalance

  // 按月份归档交易，避免每个月都重扫全表
  const byMonth = new Map<string, Trade[]>()
  for (const t of trades) {
    const m = monthOf(t.date)
    if (!m) continue
    const list = byMonth.get(m)
    if (list) list.push(t)
    else byMonth.set(m, [t])
  }

  const ordered = [...months].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))

  const rows: PlanRow[] = []
  let peak = num(settings.startingPeak, 0)
  let usedCumulative = 0

  for (const month of ordered) {
    // 历史高点只增不减：起始高点、此前累计高点、本月手填新高、本月收盘，取最大。
    const candidates = [peak, num(month.newPeak, 0), num(month.spClose, 0)].filter(v => v > 0)
    peak = candidates.length ? Math.max(...candidates) : peak

    const spClose = month.spClose !== undefined && month.spClose > 0 ? month.spClose : undefined
    const observedDate = month.observedDate
    const hasObservation = spClose !== undefined && Boolean(observedDate)

    // 观察日必须早于计划日，否则是「先记成交后补行情」的错序，状态里提示核对。
    const observedAfterPlan = Boolean(observedDate && observedDate > plannedDate(month.period, planDay))

    const drawdown = hasObservation && peak > 0 ? Math.max(0, 1 - spClose / peak) : undefined
    const tier = tierAmount(base, drawdown)

    const budgetAtStart = Math.max(0, budgetTotal - usedCumulative)
    // 档位总额就是本月合计；没有行情时先列基础额
    // （与原表「待补指数收盘／历史基准；先列基础额」的行为一致）。
    const monthTotal = tier === undefined ? base : tier
    // 计划额外 = 本月合计 − 基础额，再被剩余预算封顶。
    // 注意不能写成「base + plannedExtra」：那样等于把基础额算两遍。
    const plannedExtra = Math.min(Math.max(0, monthTotal - base), budgetAtStart)

    const monthTrades = byMonth.get(month.period) ?? []
    const actualInvested = monthTrades
      .filter(t =>
        t.side === 'buy' &&
        (t.symbol === 'VOO' || t.symbol === 'QQQM') &&
        // 空白视作定投；只有明确标了「分红再投」「其他」才排除。
        t.purpose !== '分红再投' &&
        t.purpose !== '其他'
      )
      .reduce((s, t) => s + num(t.amount, 0) + num(t.fee, 0), 0)

    const extraReference = Math.max(0, actualInvested - base)
    // 手填覆盖优先，填 0 同样有效。
    const extraUsed = month.actualExtraOverride !== undefined ? num(month.actualExtraOverride, 0) : extraReference
    const budgetAtEnd = Math.max(0, budgetAtStart - extraUsed)
    usedCumulative += extraUsed

    rows.push({
      period: month.period,
      plannedDate: plannedDate(month.period, planDay),
      observedDate,
      spClose,
      peak,
      drawdown,
      tierAmount: tier,
      budgetAtStart,
      plannedExtra,
      monthTotal,
      vooPlan: monthTotal * vooRatio,
      qqqmPlan: monthTotal * qqqmRatio,
      actualInvested,
      extraReference,
      extraUsed,
      budgetAtEnd,
      status: planStatus({
        extraUsed,
        budgetAtStart,
        hasObservation,
        observedAfterPlan,
        actualInvested,
        monthTotal,
        override: month.actualExtraOverride,
        extraReference
      }),
      note: month.note
    })
  }

  return {
    rows,
    usedTotal: usedCumulative,
    budgetLeft: Math.max(0, budgetTotal - usedCumulative)
  }
}

/** 状态判定，逐条对应原表 R 列公式的分支顺序。 */
function planStatus(p: {
  extraUsed: number
  budgetAtStart: number
  hasObservation: boolean
  observedAfterPlan: boolean
  actualInvested: number
  monthTotal: number
  override?: number
  extraReference: number
}): string {
  if (p.extraUsed > p.budgetAtStart + 0.005) return '实际加投超剩余预算，请核对'
  if (p.budgetAtStart === 0) return '预算用完：基础定投'
  if (!p.hasObservation) return '待补指数收盘／历史基准；先列基础额'
  if (p.observedAfterPlan && p.actualInvested === 0) return '核对观察日是否在实际交易前'
  if (p.override !== undefined && Math.abs(p.override - p.extraReference) > 0.005) {
    return '已按手填额外支出扣预算'
  }
  if (p.actualInvested === 0) return '已计算，尚未记录买入'
  if (Math.abs(p.actualInvested - p.monthTotal) < 0.01) return '已按计划记录'
  return '实际定投与计划有差额'
}

/** 只保留「已到或已过计划日」的行，用于计划页默认聚焦当前月。 */
export function currentPlanRow(rows: PlanRow[], now = today()): PlanRow | undefined {
  const period = now.slice(0, 7)
  return rows.find(r => r.period === period)
}

/** 计划页列表里，当前月之后额外保留的月份数。 */
export const FORWARD_MONTHS = 2

/**
 * 挑选计划页要显示的月份。
 *
 * 空白账本会预置 120 个月，如果全列出来就是一堵空行墙，而且最早的月份
 * 反而最不相关。所以规则是：
 *   1. 有内容的月份——用户填过行情／新高／手填预算／备注，或当月有成交；
 *   2. 当前月及之后 FORWARD_MONTHS 个月，方便提前规划。
 * 两者取并集，按时间倒序（最近的在上）。
 *
 * @param months  原始月份配置（判断「用户填过什么」用的是它，不是算出来的行）
 * @param rows    回撤计划结果
 * @param now     今天的 'YYYY-MM-DD'，便于测试注入
 */
export function visiblePlanRows(
  months: PlanMonth[],
  rows: PlanRow[],
  now = today()
): PlanRow[] {
  const current = now.slice(0, 7)
  const monthByPeriod = new Map(months.map(m => [m.period, m]))

  // 未来窗口：当前月 + 后续 2 个月
  const window = new Set<string>()
  let p = current
  for (let i = 0; i <= FORWARD_MONTHS; i += 1) {
    window.add(p)
    p = nextPeriod(p)
  }

  return rows
    .filter(row => {
      if (window.has(row.period)) return true
      const raw = monthByPeriod.get(row.period)
      // 用户手填过的痕迹
      if (
        raw &&
        (raw.spClose !== undefined ||
          raw.newPeak !== undefined ||
          raw.actualExtraOverride !== undefined ||
          raw.observedDate !== undefined ||
          (raw.note !== undefined && raw.note !== ''))
      ) {
        return true
      }
      // 当月有真实成交
      return row.actualInvested !== 0
    })
    // 倒序：最近的月份排在最上面
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
}
