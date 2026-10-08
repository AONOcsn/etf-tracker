import { useEffect, useRef, useState } from 'react'
import { NYSE_CALENDAR } from '../core/marketHolidays.ts'
import { marketNow } from '../core/marketTime.ts'

/**
 * 自适应刷新频率的「当前时刻」。
 *
 * 交易中每秒跳一次，让开盘/收盘倒计时有读秒感；休市中 30 秒一次足够，也省电。
 * 页面切到后台时停掉定时器——iOS 会节流后台定时器，不停掉的话回到前台会看到
 * 倒计时停滞。回到前台立刻重算一次。
 *
 * 抽成独立 hook，是为了让「实时时钟」只驱动用到它的那个小组件，
 * 不把整页拖进每秒重渲染。
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    let stopped = false

    const tick = () => {
      const next = new Date()
      setNow(next)
      if (stopped) return
      const phase = marketNow(next, NYSE_CALENDAR).phase
      const interval = phase === 'open' || phase === 'pre' ? 1000 : 30000
      if (timer.current) clearInterval(timer.current)
      timer.current = setInterval(tick, interval)
    }

    const start = () => {
      if (timer.current) clearInterval(timer.current)
      tick()
    }
    const stop = () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = undefined
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    start()
    // 非浏览器环境（单元测试里直接调纯函数）没有 document，跳过监听
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      stopped = true
      stop()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [])

  return now
}
