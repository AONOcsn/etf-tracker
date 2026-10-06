/**
 * 应用数据模型。
 *
 * 命名与口径刻意对齐原来的 Excel 表（ETF投资跟踪表.xlsx），
 * 这样对照原表核对数字时不需要再做一次心算翻译：
 * - 金额单位一律 USD，份额保留 6 位小数（与原表 F 列格式一致）
 * - 日期一律 'YYYY-MM-DD' 字符串，避免 Date 对象在时区上漂移
 * - 交易日与「本月」的划分按美股当地日期，不按手机时区
 */

export type Side = 'buy' | 'sell'
/** 买入用途。空白等于「定投」，与原表 P 列留空即算定投一致。 */
export type Purpose = '定投' | '分红再投' | '其他'

/**
 * 账户与币种一律用字符串。
 *
 * 原来是写死的联合类型（'国内银行' | '香港汇丰' | ...），但每个人的券商、
 * 银行、中间行都不一样，写死等于逼用户去改代码。现在默认值放在
 * DEFAULT_ACCOUNTS / DEFAULT_CURRENCIES 里，用户可以在「更多」页增删改名，
 * 列表存在 settings.accounts / settings.currencies。
 */
export type AccountName = string
export type Currency = string

export const DEFAULT_ACCOUNTS: string[] = ['国内银行', '香港汇丰', '嘉信入金中转', '嘉信证券', '其他银行']
export const DEFAULT_CURRENCIES: string[] = ['RMB', 'HKD', 'USD']

export const PURPOSES: Purpose[] = ['定投', '分红再投', '其他']

/** 原表预留的录入上限，超出时给提示（对应「使用说明」第 41 条）。 */
export const CAPACITY = { trades: 600, fx: 240, transfers: 240, dividends: 240, months: 120 } as const

export interface EtfSetting {
  symbol: string
  /** 目标比例，VOO 0.9 / QQQM 0.1。SMH 为历史持仓填 0。 */
  targetRatio: number
  /** 是否纳入新投入的计划分配。SMH 为 false。 */
  planned: boolean
  /** 手填现价，对应原表 D 列。 */
  price: number
  /** 价格日期，对应原表 E 列。 */
  priceDate?: string
  /** 账户现金（可选，仅作备注用）。 */
  cash?: number
}

/** 回撤计划的一行，对应原表「回撤计划」第 9 行起的每一行。 */
export interface PlanMonth {
  /** 'YYYY-MM'，该行的计划月份。 */
  period: string
  /** 观察收盘日，原表 B 列。 */
  observedDate?: string
  /** 标普500收盘，原表 C 列。 */
  spClose?: number
  /**
   * 手填的历史最高收盘，原表 D 列。
   * 只在高于既有高点时生效——高点不随反弹下调。
   */
  newPeak?: number
  /**
   * 实际动用额外预算，原表 O 列（「实际额外（选填）」）。
   * 留空时自动取「额外支出参考」；填 0 是有效值，表示本月确实没动额外预算。
   */
  actualExtraOverride?: number
  /**
   * 用户手工填过本月的指数收盘。
   * 「更新行情」遇到这个标记就跳过该月，不覆盖手工核对过的数据
   * （对应原表「已完成月的收盘观察不要覆盖」的要求）。
   */
  spManual?: boolean
  note?: string
}

export interface Trade {
  id: string
  date: string
  symbol: string
  side: Side
  /** 成交金额，不含手续费。 */
  amount: number
  /** 手续费。 */
  fee: number
  /** 成交份额。 */
  shares: number
  /** 买入用途；卖出时无意义。 */
  purpose?: Purpose
  note?: string
}

/** 换汇记录：一次换币一行。 */
export interface FxRecord {
  id: string
  date: string
  /** 流水／关联编号，可与对应转账共用。 */
  ref?: string
  fromAccount: AccountName
  fromCurrency: Currency
  /** 换汇本金（付币金额），不含另付费用。 */
  amount: number
  toAccount: AccountName
  toCurrency: Currency
  /** 实际收到金额。 */
  received: number
  feeCurrency?: Currency
  /** 另付费用。 */
  feeAmount?: number
  note?: string
}

/** 入金记录：一次转账一行，两端同币种。 */
export interface TransferRecord {
  id: string
  date: string
  ref?: string
  fromAccount: AccountName
  currency: Currency
  /** 汇出本金，不含另付费用。 */
  amount: number
  toAccount: AccountName
  /** 实际到账本金。 */
  received?: number
  receivedDate?: string
  feeCurrency?: Currency
  feeAmount?: number
  note?: string
}

/**
 * 出金记录：每次从账户汇出资金一行。
 *
 * 与「入金」的区别在于方向，字段结构一致，但出金不计入总览的「到账 USD」——
 * 那个指标专指真正进入嘉信渠道的美元。出金只作为外部资金流水留痕。
 */
export interface WithdrawalRecord {
  id: string
  date: string
  ref?: string
  fromAccount: AccountName
  currency: Currency
  /** 汇出本金，不含另付费用。 */
  amount: number
  toAccount: AccountName
  /** 实际到账本金。 */
  received?: number
  receivedDate?: string
  feeCurrency?: Currency
  feeAmount?: number
  note?: string
}

export interface DividendRecord {
  id: string
  date: string
  symbol: string
  /** 税前分红。 */
  gross: number
  /** 预扣税。 */
  tax: number
  /** 其他费用。 */
  fee?: number
  note?: string
}

/**
 * 原入金记录（原表隐藏工作表）。
 * 这是旧的人民币→港元→美元的整批成本台账，保留作只读参考与备份，
 * 不参与总览统计——新流程已由「换汇记录 + 入金记录」按段覆盖。
 */
export interface BatchRecord {
  id: string
  date: string
  /** 购汇本金 RMB。 */
  rmbPrincipal: number
  /** 购得港元 HKD。 */
  hkdBought: number
  /** 额外费用 RMB。 */
  extraFeeRmb?: number
  /** 国内汇出 HKD。 */
  sentHkd?: number
  /** 汇丰到账 HKD。 */
  hsbcInHkd?: number
  /** 汇丰汇出 HKD。 */
  hsbcOutHkd?: number
  /** 另扣费用 HKD。 */
  hkdFee?: number
  /** 嘉信到账 USD。 */
  usdReceived?: number
  usdDate?: string
  note?: string
}

export interface Settings {
  /** 基础月投 USD，原表「总览」B4。 */
  baseMonthly: number
  /** 额外预算总额 USD，原表「回撤计划」E4。 */
  extraBudgetTotal: number
  /** 起始历史最高收盘，原表「回撤计划」H4。 */
  startingPeak: number
  /** 每月计划日，原表「总览」E4。 */
  planDay: number
  /** 目标调仓比例，0.1 表示 VOO 90% / QQQM 10%。 */
  rebalance: number
  /** 可选账户清单，用户可增删。留空时回落到 DEFAULT_ACCOUNTS。 */
  accounts?: string[]
  /** 可选币种清单，用户可增删。留空时回落到 DEFAULT_CURRENCIES。 */
  currencies?: string[]
  lastQuoteAt?: string
  lastQuoteSource?: string
}

export interface Snapshot {
  at: string
  label: string
  data: AppData
}

export interface AppData {
  version: 1
  settings: Settings
  etfs: EtfSetting[]
  planMonths: PlanMonth[]
  trades: Trade[]
  fxRecords: FxRecord[]
  transfers: TransferRecord[]
  withdrawals: WithdrawalRecord[]
  dividends: DividendRecord[]
  /**
   * 原表隐藏的「原入金记录」残留数据。
   * 界面上已不再提供入口，但这个字段保留着：老备份里可能存着整批成本台账，
   * 顺着 normalize 一路留下去，用户导入旧备份时不会丢数据。
   */
  batches: BatchRecord[]
  /** 自动／手动快照，只在 IndexedDB 中出现，导出 JSON 时不带走。 */
  snapshots?: Snapshot[]
}

// ---------------------------------------------------------------------------
// 日期工具：全部使用 'YYYY-MM-DD' 字符串，避免时区漂移
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** 把 'YYYY-MM-DD' 解析为当地日期的年月日；非法输入返回 null。 */
export function parseDay(day: string | undefined | null): { y: number; m: number; d: number } | null {
  if (!day) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}

export function isDay(day: string | undefined | null): boolean {
  return parseDay(day) !== null
}

/** 'YYYY-MM-DD' 的字典序就等于时间序，比较可以直接用字符串。 */
export function dayToOrdinal(day: string): number {
  const p = parseDay(day)
  if (!p) return NaN
  return p.y * 10000 + p.m * 100 + p.d
}

/** 取日期所在月份，'2026-10-05' → '2026-10'。 */
export function monthOf(day: string | undefined | null): string | null {
  const p = parseDay(day)
  return p ? `${p.y}-${pad(p.m)}` : null
}

/** 按年月生成下一个月的 period 字符串。 */
export function nextPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return period
  let y = Number(m[1])
  let mo = Number(m[2]) + 1
  if (mo > 12) {
    mo = 1
    y += 1
  }
  return `${y}-${pad(mo)}`
}

/** 该月有多少天。 */
export function daysInMonth(period: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return 30
  return new Date(Number(m[1]), Number(m[2]), 0).getDate()
}

/**
 * 该月的计划日期：第 planDay 天，遇该月天数不足则取当月最后一天。
 * 原表的「遇休市顺延」是人工判断，网页端不猜交易日，只给日期。
 */
export function plannedDate(period: string, planDay: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return `${period}-01`
  const max = daysInMonth(period)
  const day = Math.min(Math.max(1, Math.round(planDay) || 1), max)
  return `${m[1]}-${m[2]}-${pad(day)}`
}

/** 今天（当地时区）的 'YYYY-MM-DD'。 */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 当前月份 'YYYY-MM'。 */
export function currentPeriod(now = new Date()): string {
  return today(now).slice(0, 7)
}

/** 生成从 startPeriod 起 count 个月的 period 列表。 */
export function periodRange(startPeriod: string, count: number): string[] {
  const out: string[] = []
  let p = startPeriod
  for (let i = 0; i < count; i += 1) {
    out.push(p)
    p = nextPeriod(p)
  }
  return out
}

// ---------------------------------------------------------------------------

/**
 * 生成唯一 id。
 * crypto.randomUUID 只在安全上下文（https / localhost）可用，
 * 直接双击打开 file:// 时会缺失，因此保留降级分支。
 */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* 落到下面的降级分支 */
    }
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 金额统一的显示精度：2 位。 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 份额统一的存储精度：6 位，与原表 F 列格式一致。 */
export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6
}

/** 有限数字判定，输入框读到的 NaN 一律当 0。 */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 可选数字：空字符串／undefined 返回 undefined，其余转数字。 */
export function optNum(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
