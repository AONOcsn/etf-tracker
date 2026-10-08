import { Card, Row, StatusBadge } from './ui.tsx'
import { useNow } from './useNow.ts'
import { HOLIDAY_TABLE_NOTE, NYSE_CALENDAR } from '../core/marketHolidays.ts'
import { buildMarketView, statusLabel } from '../core/marketView.ts'
import { BEIJING_TZ, EXCHANGE_TZ, clockIn, marketNow } from '../core/marketTime.ts'

/**
 * 美股交易时段（北京时间）提示。
 *
 * 回答一个具体问题：**我该在北京时间几点下单**。
 *
 * 展示逻辑全在 core/marketView.ts（纯函数、有单测）；这里只负责排版。
 * 时钟 state 由 useNow 提供，只驱动本组件重渲染，不拖累整页。
 */
export function MarketClock() {
  const now = useNow()
  const view = buildMarketView(now)

  return (
    <Card title="美股交易时段" hint="北京 / 美东">
      <div className="row big">
        <span className="k">当前状态</span>
        <span className="v">
          <StatusBadge status={view.statusText} />
        </span>
      </div>

      {/* 休市时把下一个交易日的完整日期带出来，否则「开盘 21:30」看不出是哪天 */}
      {view.nextSessionLabel && (
        <div className="row">
          <span className="k">下一个交易日</span>
          <span className="v">{view.nextSessionLabel}</span>
        </div>
      )}

      {/* 北京在前（主）、美东在后（与券商界面核对用） */}
      <Row label="开盘（北京 / 美东）" value={`${view.openClock} / ${view.etOpen}`} big />
      <Row
        label="收盘（北京 / 美东）"
        value={
          <>
            {view.closeDayLabel ? <span className="muted">{view.closeDayLabel} </span> : null}
            {view.closeClock} / {view.etClose}
          </>
        }
        big
      />

      {/* 交易日才有额外的日期信息；休市时日期已由「下一个交易日」那行交代，不重复 */}
      {view.tradingDate && (
        <p className="note" style={{ marginTop: 2 }}>
          美股交易日 {view.etDate}（美东时间），北京时间 {view.openDate} 晚开工
          {view.earlyCloseReason
            ? ` · 今日提前收盘 13:00 ET（北京 ${view.closeClock}），因${view.earlyCloseReason}`
            : ''}
        </p>
      )}

      <div className="section-title">可下单窗口（北京 / 美东）</div>
      <Row
        label="盘前开始"
        value={`${view.preClock}${view.preDayLabel ? ` ${view.preDayLabel}` : ''} / ${view.etPre}`}
      />
      <Row label="开盘集合竞价" value={`${view.auctionClock} / ${view.etAuction}`} />
      <Row label="常规交易时段" value={`${view.openClock} → ${view.closeClock} / ${view.etOpen} → ${view.etClose}`} />
      <Row
        label="盘后结束"
        value={`${view.afterClock}${view.afterDayLabel ? ` ${view.afterDayLabel}` : ''} / ${view.etAfter}`}
      />

      {view.countdown && (
        <div className={`banner ${view.phase === 'open' ? 'ok' : 'info'}`}>
          距离{view.countdownLabel}还有 {view.countdown}
        </div>
      )}

      <p className="note">{view.advice}</p>

      {view.tzNotice && <div className="banner info">{view.tzNotice}</div>}
      {view.calendarUnknown && <div className="banner info">{HOLIDAY_TABLE_NOTE}</div>}

      <p className="note" style={{ color: 'var(--muted)' }}>
        夏令时（3 月第二个周日 ～ 11 月第一个周日）开盘 21:30、收盘次日 04:00；冬令时开盘 22:30、收盘次日 05:00。
        时间由设备时区数据库自动换算。
      </p>
    </Card>
  )
}

/**
 * 紧凑版：一行显示当前能不能下单。
 * 放在「总览」页，不用翻到计划页就能判断时机。
 */
export function MarketLine({ onOpen }: { onOpen?: () => void }) {
  const now = useNow()
  // 直接用纯函数拿状态文案，不必构造整份视图
  const state = marketNow(now, NYSE_CALENDAR)
  const live = state.phase === 'open'
  const status = statusLabel(state.phase, state.holidayName)

  return (
    <div
      className="row"
      onClick={onOpen}
      style={{ cursor: onOpen ? 'pointer' : undefined }}
      role={onOpen ? 'button' : undefined}
    >
      <span className="k">
        美股时段（北京）
        {live && (
          <span className="badge" style={{ marginLeft: 6 }}>
            交易中
          </span>
        )}
      </span>
      <span className="v" style={{ fontSize: 13 }}>
        {clockIn(BEIJING_TZ, state.session.open)} → {clockIn(BEIJING_TZ, state.session.close)}{' '}
        <span className="muted">北京</span> · {clockIn(EXCHANGE_TZ, state.session.open)} →{' '}
        {clockIn(EXCHANGE_TZ, state.session.close)} <span className="muted">美东</span>
        <br />
        <span className={live ? 'pos' : 'muted'}>{status}</span>
        {onOpen && <span className="muted"> ›</span>}
      </span>
    </div>
  )
}
