import { useCallback, useEffect, useState } from 'react'
import { useAppData } from './state/useAppData.ts'
import { OverviewPage } from './pages/Overview.tsx'
import { PlanPage } from './pages/Plan.tsx'
import { TradesPage } from './pages/Trades.tsx'
import { RecordsPage } from './pages/Records.tsx'
import { DividendsPage } from './pages/Dividends.tsx'
import { MorePage } from './pages/More.tsx'
import { fetchEtfPrices, fetchDailyClose } from './net/quotes.ts'
import { currentPeriod } from './core/types.ts'

const TABS = [
  { key: 'overview', label: '总览', icon: '◈' },
  { key: 'plan', label: '计划', icon: '◷' },
  { key: 'trades', label: '交易', icon: '⇄' },
  { key: 'records', label: '资金', icon: '¥' },
  { key: 'dividends', label: '分红', icon: '◍' },
  { key: 'more', label: '更多', icon: '⋯' }
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const app = useAppData()
  const [tab, setTab] = useState<TabKey>('overview')
  const [quoting, setQuoting] = useState(false)
  const [quoteMessage, setQuoteMessage] = useState<{ kind: 'ok' | 'err'; text: string } | undefined>(undefined)

  // 离开页面前把防抖窗口里的改动落盘，避免切走时丢掉最后几秒的输入
  useEffect(() => {
    const handler = () => {
      void app.flush()
    }
    window.addEventListener('pagehide', handler)
    document.addEventListener('visibilitychange', handler)
    return () => {
      window.removeEventListener('pagehide', handler)
      document.removeEventListener('visibilitychange', handler)
    }
  }, [app])

  /**
   * 更新行情。
   *
   * 两路数据：ETF 现价用日线（同时给出交易日日期），标普500 收盘写回本月回撤计划。
   * 单只失败不影响其它——能更新几只就先更新几只。
   */
  const refreshQuotes = useCallback(async () => {
    setQuoting(true)
    setQuoteMessage(undefined)
    try {
      const symbols = app.data.etfs.map(e => e.symbol)
      const { updates, errors } = await fetchEtfPrices(symbols)

      // 标普500 收盘单独取：它填进回撤计划，不进 ETF 清单
      let spx: { price: number; date?: string } | undefined
      let spxError: string | undefined
      try {
        const spBar = await fetchDailyClose('^GSPC')
        if (spBar) spx = { price: spBar.close, date: spBar.date }
        else spxError = '标普500 日线没有返回数据'
      } catch (error) {
        spxError = error instanceof Error ? error.message : String(error)
      }

      const at = new Date().toISOString()
      const period = currentPeriod()

      app.update(current => {
        const etfs = current.etfs.map(etf => {
          const hit = updates.find(u => u.symbol === etf.symbol)
          return hit ? { ...etf, price: hit.price, priceDate: hit.date ?? etf.priceDate } : etf
        })

        // 只写入本月，不凭空造出新月份；
        // 用户手工核对过的月份（spManual）不覆盖——对应原表「已完成月的收盘观察不要覆盖」。
        const planMonths = spx
          ? current.planMonths.some(m => m.period === period)
            ? current.planMonths.map(m =>
                m.period === period && !m.spManual
                  ? { ...m, spClose: spx.price, observedDate: spx.date }
                  : m
              )
            : [...current.planMonths, { period, spClose: spx.price, observedDate: spx.date }]
          : current.planMonths

        return {
          ...current,
          etfs,
          planMonths,
          settings: {
            ...current.settings,
            lastQuoteAt: at,
            lastQuoteSource: 'qt.gtimg.cn'
          }
        }
      })

      const parts: string[] = []
      if (updates.length) {
        parts.push(`已更新 ${updates.map(u => `${u.symbol} ${u.price}`).join('、')}`)
      }
      if (spx) parts.push(`标普500 收盘 ${spx.price}（${spx.date ?? '日期未知'}）`)
      const problems = [...errors, ...(spxError ? [`标普500：${spxError}`] : [])]

      if (parts.length === 0) {
        setQuoteMessage({ kind: 'err', text: `行情更新失败：${problems.join('；') || '未取到任何数据'}` })
      } else {
        setQuoteMessage({
          kind: problems.length ? 'err' : 'ok',
          text: `${parts.join('；')}${problems.length ? `\n未成功：${problems.join('；')}` : ''}`
        })
      }
    } catch (error) {
      setQuoteMessage({ kind: 'err', text: `行情更新失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setQuoting(false)
    }
  }, [app])

  if (app.loading) {
    return <div className="center">正在读取本机数据…</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>ETF 投资跟踪</h1>
          <div className="sub">
            {app.savedAt
              ? `已保存 ${app.savedAt.slice(11, 19)}`
              : '数据只存在这台设备上'}
          </div>
        </div>
      </header>

      {tab === 'overview' && (
        <OverviewPage data={app.data} update={app.update} onGoToPlan={() => setTab('plan')} />
      )}
      {tab === 'plan' && <PlanPage data={app.data} update={app.update} />}
      {tab === 'trades' && <TradesPage data={app.data} update={app.update} />}
      {tab === 'records' && <RecordsPage data={app.data} update={app.update} />}
      {tab === 'dividends' && <DividendsPage data={app.data} update={app.update} />}
      {tab === 'more' && (
        <MorePage
          data={app.data}
          update={app.update}
          importData={app.importData}
          snapshots={app.snapshots}
          rollback={app.rollback}
          resetAll={app.resetAll}
          refreshQuotes={refreshQuotes}
          quoting={quoting}
          quoteMessage={quoteMessage}
        />
      )}

      <nav className="tabbar">
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            <span className="ico">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
