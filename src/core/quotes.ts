/**
 * 腾讯行情报文解析（纯函数，无网络、无 DOM，可直接单测）。
 *
 * 为什么是腾讯：
 * 实测 Yahoo Finance 与 FRED 的响应**不带 CORS 头**，浏览器的 fetch 根本读不到；
 * Stooq 返回反爬页面；Eastmoney 有 CORS 但连接不稳定且取不到美股代码。
 * 只有腾讯这两个端点有 `Access-Control-Allow-Origin: *`、稳定、且覆盖
 * VOO / QQQM / SMH 与标普 500 指数。
 *
 * 编码是 GBK，不是 UTF-8，所以调用方要先按字节取回再解码（见 net/quotes.ts）。
 */

export const QUOTE_SYMBOL: Record<string, string> = {
  VOO: 'usVOO',
  QQQM: 'usQQQM',
  SMH: 'usSMH',
  '^GSPC': 'usINX'
}

export interface Quote {
  /** 应用内的代码，如 VOO / ^GSPC。 */
  symbol: string
  /** 腾讯返回的代码，如 VOO.AM。 */
  vendorSymbol: string
  name: string
  /** 现价。 */
  price: number
  /** 昨收。 */
  previousClose: number
  /** 今开。 */
  open: number
  /** 行情时间（'YYYY-MM-DD HH:mm:ss'，取前 10 位即为交易日）。 */
  quoteTime?: string
  /** 行情日期，quoteTime 的前 10 位。 */
  quoteDate?: string
}

/** 把应用代码换成腾讯代码。未知代码按「美股小写」约定拼 us 前缀。 */
export function vendorSymbol(symbol: string): string {
  return QUOTE_SYMBOL[symbol] ?? `us${symbol.replace(/^\^/, '').toUpperCase()}`
}

/**
 * 解析 `qt.gtimg.cn/q=usVOO,usINX` 的响应。
 *
 * 实测报文形如：
 *   v_usVOO="200~标普500 ETF-Vanguard~VOO.AM~712.32~707.54~707.44~6172916~...~~2026-10-05 16:00:00~..."
 * 字段位置：0 状态、1 名称、2 代码、3 现价、4 昨收、5 今开、30 行情时间。
 *
 * 一次请求可以带多个代码，所以必须支持多条 `v_xxx="..."`。
 */
export function parseQuoteText(text: string): Quote[] {
  const out: Quote[] = []
  const re = /v_([A-Za-z0-9_.]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const vendor = m[1]
    const body = m[2]
    if (!body || body === 'pv_none_match') continue
    const f = body.split('~')
    if (f.length < 6) continue
    const price = toNumber(f[3])
    if (price === undefined) continue
    const quoteTime = f[30]?.trim() || undefined
    out.push({
      symbol: appSymbol(vendor),
      vendorSymbol: f[2] || vendor,
      name: f[1] || vendor,
      price,
      previousClose: toNumber(f[4]) ?? 0,
      open: toNumber(f[5]) ?? 0,
      quoteTime,
      quoteDate: quoteTime ? quoteTime.slice(0, 10) : undefined
    })
  }
  return out
}

/** 反查应用代码：腾讯代码 → 应用代码。找不到就原样返回。 */
export function appSymbol(vendor: string): string {
  for (const [app, v] of Object.entries(QUOTE_SYMBOL)) {
    if (v.toLowerCase() === vendor.toLowerCase()) return app
  }
  return vendor
}

/**
 * 解析日线接口的响应。
 *
 * 实测报文形如：
 *   {"code":0,"data":{"usINX":{"day":[["2026-09-22","7770.81","7764.64",...], ...]}}}
 * 每根 K 线：0 日期、1 开、2 收、3 高、4 低、5 成交量。
 * 与实时快照不同，这里是标准 JSON，所以可以 JSON.parse。
 */
export function parseKlinePayload(payload: unknown, vendor: string): DailyBar[] {
  const data = (payload as { data?: Record<string, { day?: unknown[] }> } | null)?.data
  if (!data) return []
  const node = data[vendor] ?? data[vendor.toLowerCase()]
  const rows = node?.day
  if (!Array.isArray(rows)) return []
  const bars: DailyBar[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue
    const date = String(row[0] ?? '')
    const close = toNumber(row[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === undefined) continue
    bars.push({
      date,
      open: toNumber(row[1]) ?? close,
      close,
      high: toNumber(row[3]) ?? close,
      low: toNumber(row[4]) ?? close
    })
  }
  // 按日期升序返回，最后一根就是最近已结束的交易日。
  return bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export interface DailyBar {
  date: string
  open: number
  close: number
  high: number
  low: number
}

/** 取最后一根日线（最近已结束交易日）。 */
export function lastBar(bars: DailyBar[]): DailyBar | undefined {
  return bars.length ? bars[bars.length - 1] : undefined
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
