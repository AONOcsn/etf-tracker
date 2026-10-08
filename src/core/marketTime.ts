/**
 * 美股交易时段换算（纯函数，无 DOM、无网络）。
 *
 * 核心问题：美股按纽约时间 09:30–16:00 交易，用户在北京，想知道「我该几点下单」。
 * 麻烦在于两地都有夏令时，而且**切换日期不同步**：
 * 美国 3 月第二个周日切、11 月第一个周日切；中国不实行夏令时。
 * 所以开盘对应的北京时间在一年里会在 21:30 和 22:30 之间跳。
 *
 * 解法：不自己实现夏令时规则，交给 `Intl` 的 IANA 时区库（iOS Safari、
 * 现代浏览器、Node 都自带）。做法是「猜一个 UTC 时刻 → 用 Intl 反查纽约
 * 当地钟面 → 按差值修正」，迭代两三次即可精确收敛。
 *
 * 另一处容易错的地方：纽约的一个交易日横跨北京的两个日历日
 * （开盘 21:30 当天，收盘 04:00 次日）。所以内部一律**以纽约当地日期为基准**，
 * 只在展示时转成北京时间，并且明确标注「次日」。
 */

import type { HolidayLookup } from './marketHolidays.ts'

/** 参考时区。用户明确按北京时间看，所以展示固定用它。 */
export const BEIJING_TZ = 'Asia/Shanghai'
/** 交易所所在时区。 */
export const EXCHANGE_TZ = 'America/New_York'

/** 常规时段（纽约当地钟面）。 */
export const REGULAR_OPEN = { hh: 9, mm: 30 }
export const REGULAR_CLOSE = { hh: 16, mm: 0 }
/** 提前收盘日的收盘时间。 */
export const EARLY_CLOSE = { hh: 13, mm: 0 }
/** 盘前。 */
export const PRE_MARKET_OPEN = { hh: 4, mm: 0 }
/** 盘后结束。 */
export const AFTER_HOURS_END = { hh: 20, mm: 0 }
/** 开盘集合竞价开始（约 09:28，11:00 前下达的市价单在此撮合）。 */
export const AUCTION_START = { hh: 9, mm: 28 }

// ---------------------------------------------------------------------------
// 时区基础工具
// ---------------------------------------------------------------------------

export interface ClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** 取某时刻在指定时区的钟面。时区无效时抛错，由调用方兜底。 */
export function partsIn(tz: string, at: Date): ClockParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const out: Record<string, number> = {}
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  // 少数实现会用 24 表示午夜
  const hour = out.hour === 24 ? 0 : out.hour
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour,
    minute: out.minute,
    second: out.second
  }
}

/** 把钟面按 UTC 解释成毫秒数，用于求偏移差。 */
function asUtcMillis(p: ClockParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/** 指定时区在某瞬间相对 UTC 的偏移分钟数（含夏令时）。 */
export function offsetMinutes(tz: string, at: Date): number {
  return (asUtcMillis(partsIn(tz, at)) - at.getTime()) / 60000
}

/**
 * 纽约当地钟面时刻 → 对应的 UTC 瞬间。
 *
 * 迭代修正：先按「夏令时」猜一个 UTC，再用 Intl 读出实际钟面，
 * 与目标钟面求差后回退修正。两三次之内必定收敛。
 */
export function nyInstant(y: number, m: number, d: number, hh: number, mm: number): Date {
  const target = Date.UTC(y, m - 1, d, hh, mm, 0)
  // 初始猜测用 EDT（−240 分钟），冬令时会在第一轮被修正
  let utc = Date.UTC(y, m - 1, d, hh + 4, mm, 0)
  for (let i = 0; i < 4; i += 1) {
    const p = partsIn(EXCHANGE_TZ, new Date(utc))
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const diff = actual - target
    if (diff === 0) break
    utc -= diff
  }
  return new Date(utc)
}

/** 某瞬间在指定时区的 'YYYY-MM-DD'。 */
export function dateIn(tz: string, at: Date): string {
  const p = partsIn(tz, at)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** 某瞬间在指定时区的 'YYYY-MM-DD HH:mm'。 */
export function formatIn(tz: string, at: Date): string {
  const p = partsIn(tz, at)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

/** 某瞬间在北京时间的 'YYYY-MM-DD'。 */
export function beijingDate(at: Date): string {
  return dateIn(BEIJING_TZ, at)
}

/** 某瞬间在北京时间的 'YYYY-MM-DD HH:mm'。 */
export function beijingStamp(at: Date): string {
  return formatIn(BEIJING_TZ, at)
}

/** 只取北京时间（或任意时区）的 'HH:mm'。 */
export function clockIn(tz: string, at: Date): string {
  const p = partsIn(tz, at)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** 设备本地时区；取不到时回落到北京。 */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || BEIJING_TZ
  } catch {
    return BEIJING_TZ
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// 日期字符串工具（'YYYY-MM-DD'，按 UTC 运算避免本地时区干扰）
// ---------------------------------------------------------------------------

export function parseNyDate(nyDate: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nyDate)
  if (!match) return { y: 1970, m: 1, d: 1 }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

export function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function addDaysIso(iso: string, days: number): string {
  const { y, m, d } = parseNyDate(iso)
  const t = Date.UTC(y, m - 1, d) + days * 86400000
  const at = new Date(t)
  return isoOf(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

function dayOfWeek(iso: string): number {
  const { y, m, d } = parseNyDate(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日
}

export function isWeekend(iso: string): boolean {
  const dow = dayOfWeek(iso)
  return dow === 0 || dow === 6
}

// ---------------------------------------------------------------------------
// 交易日
// ---------------------------------------------------------------------------

export interface Session {
  /** 纽约当地交易日 'YYYY-MM-DD'。 */
  nyDate: string
  weekend: boolean
  /** 节假日名称；不是节假日则为 undefined。 */
  holiday?: string
  /** 提前收盘的原因；正常收盘日为 undefined。 */
  earlyCloseReason?: string
  /** 该年份不在已核对范围内时为 true（此时无法判断是否休市）。 */
  calendarUnknown: boolean
  preMarketOpen: Date
  auctionStart: Date
  open: Date
  close: Date
  afterHoursEnd: Date
}

export interface HourMinute {
  hh: number
  mm: number
}

/** 组装某个纽约交易日的各时点。周末与节假日也会返回结构，由调用方判定。 */
export function sessionFor(nyDate: string, calendar: HolidayLookup): Session {
  const { y, m, d } = parseNyDate(nyDate)
  const weekend = isWeekend(nyDate)
  const holiday = calendar.holiday(nyDate)
  const earlyCloseReason = calendar.earlyClose(nyDate)
  const close = earlyCloseReason ? EARLY_CLOSE : REGULAR_CLOSE

  const at = (hm: HourMinute) => nyInstant(y, m, d, hm.hh, hm.mm)

  return {
    nyDate,
    weekend,
    holiday,
    earlyCloseReason,
    calendarUnknown: !calendar.covered(y),
    preMarketOpen: at(PRE_MARKET_OPEN),
    auctionStart: at(AUCTION_START),
    open: at(REGULAR_OPEN),
    close: at(close),
    afterHoursEnd: at(AFTER_HOURS_END)
  }
}

/** 该交易日是否会真正开市。 */
export function isTradingDay(session: Session): boolean {
  return !session.weekend && session.holiday === undefined
}

/** 找下一个交易日（严格晚于 fromNyDate）。 */
export function nextTradingDay(fromNyDate: string, calendar: HolidayLookup, maxScan = 30): string {
  let cursor = addDaysIso(fromNyDate, 1)
  for (let i = 0; i < maxScan; i += 1) {
    if (isTradingDay(sessionFor(cursor, calendar))) return cursor
    cursor = addDaysIso(cursor, 1)
  }
  return cursor
}

/** 找上一个交易日（严格早于 fromNyDate）。 */
export function previousTradingDay(fromNyDate: string, calendar: HolidayLookup, maxScan = 30): string {
  let cursor = addDaysIso(fromNyDate, -1)
  for (let i = 0; i < maxScan; i += 1) {
    if (isTradingDay(sessionFor(cursor, calendar))) return cursor
    cursor = addDaysIso(cursor, -1)
  }
  return cursor
}

// ---------------------------------------------------------------------------
// 当前所处阶段
// ---------------------------------------------------------------------------

export type MarketPhase = 'holiday' | 'weekend' | 'pre' | 'open' | 'after' | 'closed'

export interface MarketNow {
  phase: MarketPhase
  /** 当前应关注的交易日：交易中就是当天；当天已收盘则指向下一个交易日。 */
  session: Session
  /** 下一个关键时点与含义，用于倒计时。 */
  nextAt: Date
  nextLabel: string
  /**
   * 休市原因（节假日名称）。phase 为 'holiday' 时才有值。
   * 单独带出来是因为假日时 session 已经指向下一个交易日，从那里取不到原因。
   */
  holidayName?: string
}

/**
 * 由「当前瞬间」推出所处阶段与下一个交易日。
 *
 * 关键：以**纽约当地日期**为基准日，再拿 UTC 瞬间与各时点比较。
 * 直接用北京日期会把「北京已经是 1 号、纽约还是 31 号」的情况算错一天。
 */
export function marketNow(now: Date, calendar: HolidayLookup): MarketNow {
  const nyToday = dateIn(EXCHANGE_TZ, now)
  const today = sessionFor(nyToday, calendar)

  // 当天开市，且还没到收盘：就在今天这个交易日内
  if (isTradingDay(today) && now.getTime() < today.close.getTime()) {
    if (now.getTime() < today.preMarketOpen.getTime()) {
      return { phase: 'pre', session: today, nextAt: today.preMarketOpen, nextLabel: '盘前开始' }
    }
    if (now.getTime() < today.open.getTime()) {
      return { phase: 'pre', session: today, nextAt: today.open, nextLabel: '开盘' }
    }
    return { phase: 'open', session: today, nextAt: today.close, nextLabel: '收盘' }
  }

  // 当天开市、已过收盘，但在盘后时段内
  if (isTradingDay(today) && now.getTime() < today.afterHoursEnd.getTime()) {
    const next = sessionFor(nextTradingDay(nyToday, calendar), calendar)
    return { phase: 'after', session: next, nextAt: next.preMarketOpen, nextLabel: '盘前开始' }
  }

  // 其余情况：指向下一个交易日
  const nextDate = nextTradingDay(nyToday, calendar)
  const next = sessionFor(nextDate, calendar)
  const phase: MarketPhase = today.holiday !== undefined ? 'holiday' : today.weekend ? 'weekend' : 'closed'
  return {
    phase,
    session: next,
    nextAt: next.preMarketOpen,
    nextLabel: '盘前开始',
    holidayName: today.holiday
  }
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

/** 相对北京日期的日差描述，跨天必须显式标注。 */
export function dayLabel(beijingDate: string, referenceBeijingDate: string): string {
  if (beijingDate === referenceBeijingDate) return ''
  return beijingDate > referenceBeijingDate ? '次日' : '前一日'
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 'YYYY-MM-DD' → '周一'。用于把「下一个交易日」说清楚是哪一天。 */
export function weekdayZh(iso: string): string {
  const { y, m, d } = parseNyDate(iso)
  return WEEKDAYS_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** 两个时刻之间的时长，格式化成「3 小时 12 分」。 */
export function humanDuration(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime()
  if (ms <= 0) return '0 分'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes} 分`
  return `${hours} 小时 ${minutes} 分`
}

/**
 * 阶段的中文名称。
 *
 * 节假日名称单独传入，而不是从 session 里取——marketNow 在假日会把 session
 * 指向**下一个交易日**，从那里取名称会取到空值。
 */
export function phaseLabel(phase: MarketPhase, holidayName?: string): string {
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
