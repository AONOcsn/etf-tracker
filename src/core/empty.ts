import type { AppData, EtfSetting, Settings } from './types.ts'
import { DEFAULT_ACCOUNTS, DEFAULT_CURRENCIES, currentPeriod, periodRange } from './types.ts'

/**
 * 空白账本与默认参数。
 *
 * 默认值取自原表「总览」B4=500、E4=10、「回撤计划」E4=5000、H4=7794.35，
 * 以及新投入 VOO 90% / QQQM 10%、SMH 只记录不投入。
 * 按用户选择，不导入 Excel 里的历史流水：首次打开是一张干净的表。
 */

export const DEFAULT_SETTINGS: Settings = {
  baseMonthly: 500,
  extraBudgetTotal: 5000,
  startingPeak: 7794.35,
  planDay: 10,
  rebalance: 0.1,
  accounts: [...DEFAULT_ACCOUNTS],
  currencies: [...DEFAULT_CURRENCIES]
}

/** 取用户配置的账户清单；没配过就用默认的。 */
export function accountsOf(settings: Settings | undefined): string[] {
  const list = settings?.accounts
  return list && list.length ? list : DEFAULT_ACCOUNTS
}

/** 取用户配置的币种清单；没配过就用默认的。 */
export function currenciesOf(settings: Settings | undefined): string[] {
  const list = settings?.currencies
  return list && list.length ? list : DEFAULT_CURRENCIES
}

export const DEFAULT_ETFS: EtfSetting[] = [
  { symbol: 'VOO', targetRatio: 0.9, planned: true, price: 0 },
  { symbol: 'QQQM', targetRatio: 0.1, planned: true, price: 0 },
  { symbol: 'SMH', targetRatio: 0, planned: false, price: 0 }
]

/** 空白账本。planMonths 预置 120 个月（原表预留范围），但全部留空。 */
export function emptyData(startPeriod?: string): AppData {
  const first = startPeriod ?? currentPeriod()
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    etfs: DEFAULT_ETFS.map(e => ({ ...e })),
    planMonths: periodRange(first, 120).map(period => ({ period })),
    trades: [],
    fxRecords: [],
    transfers: [],
    withdrawals: [],
    dividends: [],
    batches: [],
    snapshots: []
  }
}

/**
 * 读入外部数据（IndexedDB 或导入的 JSON）后的归一化。
 *
 * 目标是「永远不因为数据结构问题白屏」：缺字段补默认值，类型不对就丢弃，
 * 所以这里逐字段校验而不是直接展开对象。
 */
export function normalizeData(raw: unknown): AppData {
  const base = emptyData()
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Partial<AppData>

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(typeof input.settings === 'object' && input.settings ? input.settings : {})
  }
  // 数值型参数若被写成非法值，退回默认，避免整张表算出 NaN。
  settings.baseMonthly = finite(settings.baseMonthly, DEFAULT_SETTINGS.baseMonthly)
  settings.extraBudgetTotal = finite(settings.extraBudgetTotal, DEFAULT_SETTINGS.extraBudgetTotal)
  settings.startingPeak = finite(settings.startingPeak, DEFAULT_SETTINGS.startingPeak)
  settings.planDay = finite(settings.planDay, DEFAULT_SETTINGS.planDay)
  settings.rebalance = finite(settings.rebalance, DEFAULT_SETTINGS.rebalance)
  // 账户与币种清单：去空去重，全空时回落到默认值，避免界面里一个选项都没有
  settings.accounts = normalizeList(settings.accounts, DEFAULT_ACCOUNTS)
  settings.currencies = normalizeList(settings.currencies, DEFAULT_CURRENCIES)

  const etfs = Array.isArray(input.etfs) && input.etfs.length
    ? input.etfs
        .filter(e => e && typeof e.symbol === 'string')
        .map(e => ({
          symbol: e.symbol,
          targetRatio: finite(e.targetRatio, 0),
          planned: Boolean(e.planned),
          price: finite(e.price, 0),
          priceDate: typeof e.priceDate === 'string' ? e.priceDate : undefined,
          cash: e.cash === undefined ? undefined : finite(e.cash, 0)
        }))
    : base.etfs.map(e => ({ ...e }))

  const planMonths = Array.isArray(input.planMonths) && input.planMonths.length
    ? input.planMonths
        .filter(m => m && /^\d{4}-\d{2}$/.test(String(m.period)))
        .map(m => ({
          period: m.period,
          observedDate: str(m.observedDate),
          spClose: opt(m.spClose),
          newPeak: opt(m.newPeak),
          actualExtraOverride: opt(m.actualExtraOverride),
          spManual: m.spManual === true ? true : undefined,
          note: str(m.note)
        }))
    : base.planMonths.map(m => ({ ...m }))

  return {
    version: 1,
    settings,
    etfs,
    planMonths,
    trades: arr(input.trades),
    fxRecords: arr(input.fxRecords),
    transfers: arr(input.transfers),
    withdrawals: arr(input.withdrawals),
    dividends: arr(input.dividends),
    batches: arr(input.batches),
    snapshots: []
  }
}

/** 字符串清单归一化：去首尾空格、丢空值、去重（忽略大小写差异的重复）。 */
export function normalizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.length ? out : [...fallback]
}

function finite(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function opt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(v => v && typeof v === 'object') as T[]) : []
}
