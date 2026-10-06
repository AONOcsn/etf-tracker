/**
 * 行情抓取。
 *
 * 只有腾讯这两个端点在浏览器里真的可用：实测 Yahoo Finance 与 FRED 的响应
 * 不带 CORS 头（前端 fetch 读不到响应体），Stooq 返回反爬页面，
 * Eastmoney 有 CORS 但连接不稳定且取不到美股代码。
 *
 * 编码是 GBK 而不是 UTF-8，所以必须用 arrayBuffer 取回再按 GBK 解码；
 * 直接 response.text() 会把中文名称变成乱码。
 */

import type { DailyBar, Quote } from '../core/quotes.ts'
import { lastBar, parseKlinePayload, parseQuoteText, vendorSymbol } from '../core/quotes.ts'

/** 单次请求超时。没有超时的话被阻断的域名会挂几十秒，把整个更新流程卡死。 */
const TIMEOUT_MS = 8000
const RETRY_DELAYS_MS = [0, 600, 1500]

const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='
const KLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** 取回文本并按 GBK 解码。腾讯的行情接口是 GBK，不是 UTF-8。 */
async function getGbkText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  const buffer = await response.arrayBuffer()
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    // 个别环境没有 gbk 解码器，退回 UTF-8 至少不崩
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** 带重试的取文本：被限流或瞬时抖动时退避重试。 */
async function getGbkTextWithRetry(url: string): Promise<string> {
  let lastError: unknown
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay)
    try {
      return await getGbkText(url)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * 批量取实时快照。一次请求带上所有代码，减少往返与失败面。
 */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return []
  const vendor = symbols.map(vendorSymbol).join(',')
  const text = await getGbkTextWithRetry(`${QUOTE_ENDPOINT}${encodeURIComponent(vendor)}`)
  const quotes = parseQuoteText(text)
  if (!quotes.length) {
    throw new Error('行情接口没有返回任何可用数据')
  }
  return quotes
}

/**
 * 取某个代码的日线，返回最近已结束交易日的收盘价与日期。
 *
 * 这一步是给回撤计划用的：它需要「观察日 + 标普500收盘」成对出现，
 * 而快照只给得出一个时间戳，日线才能给出干净的交易日日期。
 */
export async function fetchDailyClose(symbol: string): Promise<DailyBar | undefined> {
  const vendor = vendorSymbol(symbol)
  const url = `${KLINE_ENDPOINT}?param=${encodeURIComponent(`${vendor},day,,,10,qfq`)}`
  const text = await getGbkTextWithRetry(url)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('日线接口返回的内容不是合法 JSON')
  }
  return lastBar(parseKlinePayload(payload, vendor))
}

export interface QuoteUpdate {
  symbol: string
  price: number
  date?: string
  name?: string
}

/**
 * 取一批 ETF 的现价。
 * 单只失败不影响其他——能更新几只就先更新几只，比整批失败有用。
 */
export async function fetchEtfPrices(symbols: string[]): Promise<{ updates: QuoteUpdate[]; errors: string[] }> {
  const updates: QuoteUpdate[] = []
  const errors: string[] = []
  for (const symbol of symbols) {
    try {
      const bars = await fetchDailyClose(symbol)
      if (bars) {
        updates.push({ symbol, price: bars.close, date: bars.date })
        continue
      }
      // 日线拿不到（低成交量标的可能只给最新一根）时退回快照
      const quotes = await fetchQuotes([symbol])
      const q = quotes.find(item => item.symbol === symbol)
      if (q) updates.push({ symbol, price: q.price, date: q.quoteDate, name: q.name })
      else errors.push(`${symbol}：没有取到行情`)
    } catch (error) {
      errors.push(`${symbol}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { updates, errors }
}
