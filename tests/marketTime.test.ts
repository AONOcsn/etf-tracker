import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BEIJING_TZ,
  EXCHANGE_TZ,
  addDaysIso,
  beijingStamp,
  clockIn,
  dateIn,
  formatIn,
  isTradingDay,
  isWeekend,
  marketNow,
  nextTradingDay,
  nyInstant,
  offsetMinutes,
  partsIn,
  phaseLabel,
  previousTradingDay,
  sessionFor,
  humanDuration,
  dayLabel
} from '../src/core/marketTime.ts'
import { NYSE_CALENDAR, type HolidayLookup } from '../src/core/marketHolidays.ts'

const cal = NYSE_CALENDAR

/** 纽约时间某点的 UTC 瞬间，测试里读起来更直观。 */
const ny = (y: number, m: number, d: number, hh: number, mm: number) => nyInstant(y, m, d, hh, mm)

// ---------------------------------------------------------------------------
// 时区基础
// ---------------------------------------------------------------------------

test('纽约偏移：冬令时 −300、夏令时 −240；北京恒为 +480', () => {
  assert.equal(offsetMinutes(EXCHANGE_TZ, new Date('2026-01-15T12:00:00Z')), -300)
  assert.equal(offsetMinutes(EXCHANGE_TZ, new Date('2026-07-15T12:00:00Z')), -240)
  assert.equal(offsetMinutes(BEIJING_TZ, new Date('2026-01-15T12:00:00Z')), 480)
  assert.equal(offsetMinutes(BEIJING_TZ, new Date('2026-07-15T12:00:00Z')), 480)
})

test('纽约钟面反查精确：00:00 与 23:59 都不串日', () => {
  const midnight = ny(2026, 7, 15, 0, 0)
  assert.equal(formatIn(EXCHANGE_TZ, midnight), '2026-07-15 00:00')
  const endOfDay = ny(2026, 7, 15, 23, 59)
  assert.equal(formatIn(EXCHANGE_TZ, endOfDay), '2026-07-15 23:59')
})

test('无效时区会抛错（调用方需兜底），不会静默返回本地时间', () => {
  assert.throws(() => partsIn('Not/AZone', new Date()))
})

// ---------------------------------------------------------------------------
// 开盘对应的北京时间（本功能的核心）
// ---------------------------------------------------------------------------

test('冬令时：开盘 22:30、收盘次日 05:00（北京）', () => {
  const s = sessionFor('2026-01-15', cal)
  assert.equal(beijingStamp(s.open), '2026-01-15 22:30')
  assert.equal(beijingStamp(s.close), '2026-01-16 05:00')
})

test('夏令时：开盘 21:30、收盘次日 04:00（北京）', () => {
  const s = sessionFor('2026-07-15', cal)
  assert.equal(beijingStamp(s.open), '2026-07-15 21:30')
  assert.equal(beijingStamp(s.close), '2026-07-16 04:00')
})

test('夏令时开始（3 月第二个周日）当天即切换', () => {
  // 2026 年 3 月第二个周日是 3-08
  assert.equal(beijingStamp(sessionFor('2026-03-07', cal).open), '2026-03-07 22:30') // 前一天仍是 EST
  assert.equal(beijingStamp(sessionFor('2026-03-09', cal).open), '2026-03-09 21:30') // 之后是 EDT
})

test('夏令时结束（11 月第一个周日）当天即切换', () => {
  // 2026 年 11 月第一个周日是 11-01
  assert.equal(beijingStamp(sessionFor('2026-10-30', cal).open), '2026-10-30 21:30') // 前一天仍是 EDT
  assert.equal(beijingStamp(sessionFor('2026-11-02', cal).open), '2026-11-02 22:30') // 之后是 EST
})

test('盘前与盘后时段换算正确', () => {
  const summer = sessionFor('2026-07-15', cal)
  assert.equal(beijingStamp(summer.preMarketOpen), '2026-07-15 16:00')
  assert.equal(beijingStamp(summer.afterHoursEnd), '2026-07-16 08:00')

  const winter = sessionFor('2026-01-15', cal)
  assert.equal(beijingStamp(winter.preMarketOpen), '2026-01-15 17:00')
  assert.equal(beijingStamp(winter.afterHoursEnd), '2026-01-16 09:00')
})

test('开盘集合竞价 09:28 ET 换算正确', () => {
  assert.equal(beijingStamp(sessionFor('2026-07-15', cal).auctionStart), '2026-07-15 21:28')
})

// ---------------------------------------------------------------------------
// 交易日判定
// ---------------------------------------------------------------------------

test('周末不交易，且 nextTradingDay 跳到周一', () => {
  assert.equal(isWeekend('2026-07-18'), true) // 周六
  assert.equal(isWeekend('2026-07-19'), true) // 周日
  assert.equal(isWeekend('2026-07-20'), false) // 周一
  assert.equal(isTradingDay(sessionFor('2026-07-18', cal)), false)
  assert.equal(nextTradingDay('2026-07-17', cal), '2026-07-20')
})

test('节假日不交易，且会连续跳过假期与周末', () => {
  assert.equal(isTradingDay(sessionFor('2026-07-03', cal)), false) // 独立日观察日（周五）
  assert.equal(sessionFor('2026-07-03', cal).holiday, '独立日（观察日）')
  // 7-02 周四 → 跳过 7-03 假日与 7-04/05 周末 → 7-06 周一
  assert.equal(nextTradingDay('2026-07-02', cal), '2026-07-06')
})

test('previousTradingDay 反向跳过假期', () => {
  assert.equal(previousTradingDay('2026-07-06', cal), '2026-07-02')
  assert.equal(previousTradingDay('2026-07-20', cal), '2026-07-17') // 周一 → 上周五
})

test('提前收盘日收盘时间为 13:00 ET', () => {
  const s = sessionFor('2026-11-27', cal)
  assert.equal(s.earlyCloseReason, '感恩节次日')
  assert.equal(formatIn(EXCHANGE_TZ, s.close), '2026-11-27 13:00')
  // 冬令时下对应北京 11-28 02:00
  assert.equal(beijingStamp(s.close), '2026-11-28 02:00')
})

test('提前收盘日仍是交易日', () => {
  assert.equal(isTradingDay(sessionFor('2026-11-27', cal)), true)
})

// ---------------------------------------------------------------------------
// 节假日表越界：不猜
// ---------------------------------------------------------------------------

test('超出已核对年份时标记 calendarUnknown，且不误判为休市', () => {
  const far = sessionFor('2028-01-03', cal) // 周一，表外年份
  assert.equal(far.calendarUnknown, true)
  assert.equal(far.holiday, undefined)
  // 不会被当成节假日，因此仍按交易日处理（界面需提示无法确认）
  assert.equal(isTradingDay(far), true)
})

test('表内年份不标记 calendarUnknown', () => {
  assert.equal(sessionFor('2026-07-15', cal).calendarUnknown, false)
  assert.equal(sessionFor('2027-07-15', cal).calendarUnknown, false)
})

// ---------------------------------------------------------------------------
// 当前阶段
// ---------------------------------------------------------------------------

test('交易日开盘前 → 盘前，倒计时指向开盘', () => {
  const r = marketNow(ny(2026, 7, 15, 8, 0), cal)
  assert.equal(r.phase, 'pre')
  assert.equal(r.session.nyDate, '2026-07-15') // 关注当天
  assert.equal(r.nextLabel, '开盘')
  assert.equal(beijingStamp(r.nextAt), '2026-07-15 21:30')
})

test('开盘瞬间即进入交易中', () => {
  assert.equal(marketNow(ny(2026, 7, 15, 9, 29), cal).phase, 'pre')
  assert.equal(marketNow(ny(2026, 7, 15, 9, 30), cal).phase, 'open')
})

test('收盘前仍是交易中，收盘瞬间转为盘后', () => {
  assert.equal(marketNow(ny(2026, 7, 15, 15, 59), cal).phase, 'open')
  assert.equal(marketNow(ny(2026, 7, 15, 16, 0), cal).phase, 'after')
})

test('盘后指向下一个交易日的盘前', () => {
  const r = marketNow(ny(2026, 7, 15, 18, 0), cal)
  assert.equal(r.phase, 'after')
  assert.equal(r.session.nyDate, '2026-07-16')
  assert.equal(r.nextLabel, '盘前开始')
})

test('深夜（纽约）属于收盘后 → 指向下一个交易日', () => {
  const r = marketNow(ny(2026, 7, 15, 23, 0), cal)
  assert.equal(r.phase, 'closed')
  assert.equal(r.session.nyDate, '2026-07-16')
})

test('周末 → weekend，并指向周一', () => {
  const r = marketNow(ny(2026, 7, 18, 12, 0), cal) // 周六
  assert.equal(r.phase, 'weekend')
  assert.equal(r.session.nyDate, '2026-07-20') // 周一
})

test('节假日 → holiday，并带出节日名', () => {
  const r = marketNow(ny(2026, 7, 3, 12, 0), cal)
  assert.equal(r.phase, 'holiday')
  assert.equal(r.session.nyDate, '2026-07-06') // 跳过周末
  assert.equal(phaseLabel(r.phase, sessionFor('2026-07-03', cal).holiday), '假日休市：独立日（观察日）')
})

test('阶段文案', () => {
  assert.equal(phaseLabel('open'), '正在交易')
  assert.equal(phaseLabel('pre'), '盘前')
  assert.equal(phaseLabel('after'), '盘后')
  assert.equal(phaseLabel('weekend'), '周末休市')
  assert.equal(phaseLabel('closed'), '休市中')
  assert.equal(phaseLabel('holiday'), '假日休市')
})

// ---------------------------------------------------------------------------
// 北京时间视角：跨天必须标「次日」
// ---------------------------------------------------------------------------

test('夏令时开盘在北京当天晚上、收盘在北京次日凌晨', () => {
  const s = sessionFor('2026-07-15', cal)
  const ref = dateIn(BEIJING_TZ, s.open)
  assert.equal(ref, '2026-07-15')
  assert.equal(dateIn(BEIJING_TZ, s.close), '2026-07-16')
  assert.equal(dayLabel(dateIn(BEIJING_TZ, s.close), ref), '次日')
  assert.equal(dayLabel(ref, ref), '') // 同一天不标注
})

test('冬令时同理：开盘当天、收盘次日', () => {
  const s = sessionFor('2026-01-15', cal)
  const ref = dateIn(BEIJING_TZ, s.open)
  assert.equal(ref, '2026-01-15')
  assert.equal(dayLabel(dateIn(BEIJING_TZ, s.close), ref), '次日')
})

test('到点时间只取 HH:mm', () => {
  assert.equal(clockIn(BEIJING_TZ, sessionFor('2026-07-15', cal).open), '21:30')
  assert.equal(clockIn(BEIJING_TZ, sessionFor('2026-01-15', cal).open), '22:30')
})

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

test('日期加减与跨月跨年', () => {
  assert.equal(addDaysIso('2026-07-31', 1), '2026-08-01')
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysIso('2026-01-01', -1), '2025-12-31')
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28')
})

test('倒计时文案', () => {
  assert.equal(humanDuration(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-15T03:12:00Z')), '3 小时 12 分')
  assert.equal(humanDuration(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-15T00:45:00Z')), '45 分')
  assert.equal(humanDuration(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-15T00:00:00Z')), '0 分')
  // 目标已过时不返回负数
  assert.equal(humanDuration(new Date('2026-07-15T03:00:00Z'), new Date('2026-07-15T00:00:00Z')), '0 分')
})

test('注入自定义节假日表：验证查询器被真正使用（不写死内置表）', () => {
  const fake: HolidayLookup = {
    holiday: iso => (iso === '2026-07-15' ? '假想的假日' : undefined),
    earlyClose: () => undefined,
    covered: () => true
  }
  const s = sessionFor('2026-07-15', fake)
  assert.equal(s.holiday, '假想的假日')
  assert.equal(isTradingDay(s), false)
  // 原本 7-15 是交易日，注入后应被跳过
  assert.equal(nextTradingDay('2026-07-14', fake), '2026-07-16')
  assert.equal(nextTradingDay('2026-07-14', cal), '2026-07-15')
})
