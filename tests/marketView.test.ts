import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMarketView } from '../src/core/marketView.ts'
import { nyInstant } from '../src/core/marketTime.ts'

/**
 * 这一组测的是「界面上到底显示了什么」。
 *
 * 时区换算本身由 marketTime.test.ts 覆盖；这里专门盯展示层的坑：
 * 夏令时切换导致的时刻变化、跨天必须标「次日」、倒计时、以及休市时的建议文案。
 */

const summerOpen = nyInstant(2026, 7, 15, 9, 30) // 夏令时开盘瞬间
const winterOpen = nyInstant(2026, 1, 15, 9, 30) // 冬令时开盘瞬间

/** 固定时区，避免测试结果随运行机器的时区变化。 */
const VIEW_TZ = 'Asia/Shanghai'
const view = (at: Date) => buildMarketView(at, VIEW_TZ)

test('夏令时：开盘 21:30、收盘次日 04:00，且收盘标「次日」', () => {
  const v = view(summerOpen)
  assert.equal(v.openClock, '21:30')
  assert.equal(v.closeClock, '04:00')
  assert.equal(v.openDayLabel, '') // 开盘当天，不标注
  assert.equal(v.closeDayLabel, '次日') // 收盘在北京次日
  assert.equal(v.statusText, '正在交易')
})

test('冬令时：开盘 22:30、收盘次日 05:00', () => {
  const v = view(winterOpen)
  assert.equal(v.openClock, '22:30')
  assert.equal(v.closeClock, '05:00')
  assert.equal(v.closeDayLabel, '次日')
})

test('盘前阶段：状态为盘前，倒计时指向开盘', () => {
  const v = view(nyInstant(2026, 7, 15, 8, 0))
  assert.equal(v.statusText, '盘前')
  assert.equal(v.countdownLabel, '开盘')
  assert.equal(v.countdown, '1 小时 30 分')
  assert.match(v.advice, /盘前/)
})

test('交易中：倒计时指向收盘，建议是「可以直接下单」', () => {
  const v = view(nyInstant(2026, 7, 15, 10, 0))
  assert.equal(v.statusText, '正在交易')
  assert.equal(v.countdownLabel, '收盘')
  assert.match(v.advice, /可以直接下单/)
})

test('盘后：明确提示不会立即成交、会挂到下一次开盘', () => {
  const v = view(nyInstant(2026, 7, 15, 18, 0))
  assert.equal(v.statusText, '盘后')
  assert.match(v.advice, /不会立即成交/)
  assert.match(v.advice, /开盘价/)
})

test('周末：状态与建议都指到下一个交易日', () => {
  const v = view(nyInstant(2026, 7, 18, 12, 0)) // 周六
  assert.equal(v.statusText, '周末休市')
  assert.equal(v.nyDate, '2026-07-20') // 下周一
  assert.equal(v.openClock, '21:30') // 7 月是夏令时
  assert.match(v.advice, /下周一/)
  // 休市日不显示「对应美股交易日」那行
  assert.equal(v.tradingDate, undefined)
})

test('节假日：状态带出节日名，且指向下一个交易日', () => {
  const v = view(nyInstant(2026, 7, 3, 12, 0)) // 独立日观察日
  assert.equal(v.statusText, '假日休市：独立日（观察日）')
  assert.equal(v.nyDate, '2026-07-06')
  assert.match(v.advice, /休市/)
})

test('提前收盘日：收盘时间与提示都变成 13:00 ET', () => {
  const v = view(nyInstant(2026, 11, 27, 10, 0)) // 感恩节次日
  assert.equal(v.closeClock, '02:00') // 冬令时 13:00 ET = 次日 02:00 北京
  assert.equal(v.closeDayLabel, '次日')
  assert.equal(v.earlyCloseReason, '感恩节次日')
  assert.equal(v.tradingDate, true)
})

test('盘前/竞价/盘后各时点都带正确的跨天标注', () => {
  const v = view(summerOpen)
  assert.equal(v.preClock, '16:00')
  assert.equal(v.preDayLabel, '') // 盘前与开盘同为北京当天
  assert.equal(v.auctionClock, '21:28')
  assert.equal(v.auctionDayLabel, '')
  assert.equal(v.afterClock, '08:00')
  assert.equal(v.afterDayLabel, '次日') // 盘后结束在北京次日
})

test('超出节假日表覆盖年份时给出提示', () => {
  const v = view(nyInstant(2029, 7, 17, 10, 0))
  assert.equal(v.calendarUnknown, true)
})

test('倒计时不会是负数：收盘后转为指向下一时点', () => {
  const v = view(nyInstant(2026, 7, 15, 16, 30)) // 刚收盘
  assert.equal(v.statusText, '盘后')
  assert.ok(v.countdown !== undefined && !v.countdown.startsWith('-'))
})

test('设备时区不是北京时给出提示，是北京时不提示', () => {
  assert.equal(view(summerOpen).tzNotice, undefined) // 传入 Asia/Shanghai
  const other = buildMarketView(summerOpen, 'America/New_York')
  assert.match(other.tzNotice ?? '', /America\/New_York/)
})

// ---------------------------------------------------------------------------
// 美东时间并列显示
// ---------------------------------------------------------------------------

test('美东时间与北京并列：夏令时 21:30/09:30、04:00/16:00', () => {
  const v = view(summerOpen)
  assert.equal(v.openClock, '21:30')
  assert.equal(v.etOpen, '09:30')
  assert.equal(v.closeClock, '04:00')
  assert.equal(v.etClose, '16:00')
})

test('冬令时美东时间不变（变的是北京那一侧）', () => {
  const v = view(winterOpen)
  assert.equal(v.etOpen, '09:30') // 美东恒为 09:30
  assert.equal(v.etClose, '16:00')
  assert.equal(v.openClock, '22:30') // 北京侧随夏令时变化
  assert.equal(v.closeClock, '05:00')
})

test('盘前/竞价/盘后的美东时间', () => {
  const v = view(summerOpen)
  assert.equal(v.etPre, '04:00')
  assert.equal(v.etAuction, '09:28')
  assert.equal(v.etAfter, '20:00')
})

test('美东日期就是交易日；提前收盘日美东收盘为 13:00', () => {
  assert.equal(view(summerOpen).etDate, '2026-07-15')
  const early = view(nyInstant(2026, 11, 27, 10, 0))
  assert.equal(early.etDate, '2026-11-27')
  assert.equal(early.etClose, '13:00')
  assert.equal(early.closeClock, '02:00') // 北京次日 02:00
})

// ---------------------------------------------------------------------------
// 休市时带出下一个交易日的日期
// ---------------------------------------------------------------------------

test('周末：带出下一个交易日的完整日期与星期', () => {
  const v = view(nyInstant(2026, 7, 18, 12, 0)) // 周六
  assert.equal(v.nextSessionLabel, '2026-07-20（周一）美东时间')
  assert.equal(v.etDate, '2026-07-20') // 开盘时间属于这一天
  assert.equal(v.etOpen, '09:30')
})

test('节假日：同样带出下一个交易日（并跳过周末）', () => {
  const v = view(nyInstant(2026, 7, 3, 12, 0)) // 周五独立日观察日
  // 7-3 周五休市 → 跳过 7-4/5 周末 → 7-6 周一
  assert.equal(v.nextSessionLabel, '2026-07-06（周一）美东时间')
})

test('交易日进行中不显示「下一个交易日」，避免误读', () => {
  assert.equal(view(summerOpen).nextSessionLabel, undefined) // 交易中
  assert.equal(view(nyInstant(2026, 7, 15, 8, 0)).nextSessionLabel, undefined) // 盘前
  assert.equal(view(nyInstant(2026, 7, 15, 18, 0)).nextSessionLabel, undefined) // 盘后
})

test('2026-10-10（周六）的实际展示：休市、带出 10-12 周一', () => {
  const v = view(nyInstant(2026, 10, 10, 12, 0)) // 周六美东中午
  assert.equal(v.statusText, '周末休市')
  assert.equal(v.nextSessionLabel, '2026-10-12（周一）美东时间')
  assert.equal(v.etOpen, '09:30')
  assert.equal(v.openClock, '21:30') // 10 月仍是夏令时
  assert.equal(v.closeClock, '04:00')
  // 休市时不加跨天标注：日期已由「下一个交易日」那行交代，再加「次日」会误导成周日开盘
  assert.equal(v.closeDayLabel, '')
  assert.equal(v.tradingDate, undefined) // 不显示「交易日」那一行
  assert.match(v.advice, /下周一/)
})

test('休市时不加「次日」标注，避免让人以为周日早上有盘后时段', () => {
  const v = view(nyInstant(2026, 10, 10, 12, 0)) // 周六
  assert.equal(v.afterDayLabel, '') // 否则会显示「08:00 次日」误导成周日
  assert.equal(v.preDayLabel, '')
})

test('交易日里跨天标注正常保留', () => {
  const v = view(summerOpen)
  assert.equal(v.closeDayLabel, '次日')
  assert.equal(v.afterDayLabel, '次日')
})
