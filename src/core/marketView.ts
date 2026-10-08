/**
 * 交易时段卡片的展示逻辑（纯函数，无 React、无 DOM）。
 *
 * 抽到 core 里而不是留在组件内：
 * 1. 这里全是「文本怎么排」的规则，是最容易出现「次日」标注错、倒计时错的地方，
 *    放在 core 才能被单测直接盯住（Node 的测试运行器认不得 .tsx）。
 * 2. 组件只剩渲染，改样式不会碰到逻辑。
 */

import { NYSE_CALENDAR } from './marketHolidays.ts'
import type { MarketPhase } from './marketTime.ts'
import {
  BEIJING_TZ,
  EXCHANGE_TZ,
  beijingDate,
  clockIn,
  dateIn,
  dayLabel,
  deviceTimeZone,
  humanDuration,
  marketNow,
  weekdayZh
} from './marketTime.ts'

export interface MarketView {
  phase: MarketPhase
  /** 状态文案，如「正在交易」「假日休市：独立日」。 */
  statusText: string
  /** 正在关注的美股交易日。 */
  nyDate: string
  openClock: string
  closeClock: string
  preClock: string
  auctionClock: string
  afterClock: string
  openDayLabel: string
  closeDayLabel: string
  preDayLabel: string
  auctionDayLabel: string
  afterDayLabel: string
  /** 开盘所在的北京日期。 */
  openDate: string
  /** 是交易日时给 true；周末／假日为 undefined，界面据此隐藏细节。 */
  tradingDate: true | undefined
  /**
   * 休市时带出下一个交易日的完整日期，如「2026-10-12（周一）」。
   * 休市时「开盘 21:30」看不出是哪一天，光靠建议文案容易被误读成「今晚就开盘」。
   */
  nextSessionLabel?: string
  /** 美东时间（纽约当地），与北京时间并列显示以便与券商界面核对。 */
  etOpen: string
  etClose: string
  etPre: string
  etAuction: string
  etAfter: string
  /** 美股交易日（美东日期）。 */
  etDate: string
  earlyCloseReason?: string
  countdown?: string
  countdownLabel: string
  advice: string
  tzNotice?: string
  calendarUnknown: boolean
}

/** 把某一瞬间整理成界面需要的文本。 */
export function buildMarketView(now: Date, tz: string = safeDeviceTz()): MarketView {
  const state = marketNow(now, NYSE_CALENDAR)
  const session = state.session
  // 参照日取「开盘所在的那个北京日」，所有跨天标注都相对它
  const refBeijing = dateIn(BEIJING_TZ, session.open)
  const todayBeijing = beijingDate(now)
  const labelFor = (at: Date) => dayLabel(dateIn(BEIJING_TZ, at), refBeijing)

  const remaining = state.nextAt.getTime() - now.getTime()
  // 只有真正处在某个交易日的过程里才显示「对应美股交易日」那一行。
  // 不能只看 session 是不是交易日：周末／假日的 session 已经指向下一个
  // 交易日，那样会把「下周一」误当成今天。
  const inSession = state.phase === 'pre' || state.phase === 'open' || state.phase === 'after'
  /**
   * 跨天标注只在实际交易日里加。
   *
   * 休市时加「次日」会误导：周六看到「盘后结束 08:00 次日」，会以为周日
   * 早上有盘后时段，其实周日也休市。休市时日期已由「下一个交易日」那行交代。
   */
  const labeled = (at: Date) => (inSession ? labelFor(at) : '')

  return {
    phase: state.phase,
    statusText: statusLabel(state.phase, state.holidayName),
    nyDate: session.nyDate,
    openClock: clockIn(BEIJING_TZ, session.open),
    closeClock: clockIn(BEIJING_TZ, session.close),
    preClock: clockIn(BEIJING_TZ, session.preMarketOpen),
    auctionClock: clockIn(BEIJING_TZ, session.auctionStart),
    afterClock: clockIn(BEIJING_TZ, session.afterHoursEnd),
    openDayLabel: labeled(session.open),
    closeDayLabel: labeled(session.close),
    preDayLabel: labeled(session.preMarketOpen),
    auctionDayLabel: labeled(session.auctionStart),
    afterDayLabel: labeled(session.afterHoursEnd),
    openDate: refBeijing,
    tradingDate: inSession ? true : undefined,
    nextSessionLabel: inSession
      ? undefined
      : `${session.nyDate}（${weekdayZh(session.nyDate)}）美东时间`,    etOpen: clockIn(EXCHANGE_TZ, session.open),
    etClose: clockIn(EXCHANGE_TZ, session.close),
    etPre: clockIn(EXCHANGE_TZ, session.preMarketOpen),
    etAuction: clockIn(EXCHANGE_TZ, session.auctionStart),
    etAfter: clockIn(EXCHANGE_TZ, session.afterHoursEnd),
    etDate: session.nyDate,
    earlyCloseReason: session.earlyCloseReason,
    countdown: remaining > 0 ? humanDuration(now, state.nextAt) : undefined,
    countdownLabel: state.nextLabel,
    advice: adviceFor(state.phase, todayBeijing, refBeijing),
    tzNotice: tz && tz !== BEIJING_TZ ? `你的设备时区是 ${tz}，本卡片固定按北京时间显示。` : undefined,
    calendarUnknown: session.calendarUnknown
  }
}

/** 状态文案：假日要把节日名带出来，否则用户不知道今天为什么不开市。 */
export function statusLabel(phase: MarketPhase, holidayName?: string): string {
  switch (phase) {
    case 'open':
      return '正在交易'
    case 'pre':
      return '盘前'
    case 'after':
      return '盘后'
    case 'weekend':
      return '周末休市'
    case 'holiday':
      return holidayName ? `假日休市：${holidayName}` : '假日休市'
    default:
      return '休市中'
  }
}

/**
 * 「该怎么做」的一句话建议，比只给时间更实用。
 *
 * 最要紧的一条：盘后下单不会立即成交，会挂到下一次开盘按开盘价撮合。
 * 这点最容易让人误判成「我明明下了单怎么没成交」。
 */
export function adviceFor(phase: MarketPhase, todayBeijing: string, openBeijingDate: string): string {
  switch (phase) {
    case 'open':
      return '现在是常规交易时段，可以直接下单，按盘中实时价成交。'
    case 'pre':
      return '现在是盘前时段，流动性较差、点差较大。想按开盘价成交，可等常规时段开始后下单。'
    case 'after':
      return '常规时段已结束。此刻下的单不会立即成交，会挂到下一个交易日开盘按开盘价撮合。'
    case 'holiday':
      return '今天美股休市，下的单会等到下一个交易日开盘才处理。'
    case 'weekend':
      return '周末美股休市，下单会等到下周一开盘处理。'
    default:
      return todayBeijing === openBeijingDate
        ? '今日交易时段已结束（北京时间次日凌晨收盘），新的时段从今晚盘前开始。'
        : '当前休市中，下一次时段从下面显示的盘前时间开始。'
  }
}

/** 设备时区；在非浏览器环境下 deviceTimeZone 自带兜底。 */
function safeDeviceTz(): string {
  try {
    return deviceTimeZone()
  } catch {
    return BEIJING_TZ
  }
}
