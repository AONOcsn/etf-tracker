import type { BatchRecord, DividendRecord, FxRecord, TransferRecord, WithdrawalRecord } from './types.ts'
import { isDay, num, round2 } from './types.ts'

/**
 * 换汇、入金、分红、原入金批次的派生字段与检查状态。
 *
 * 对应原表：
 * - 「换汇记录」K/L/M 列（汇率、计入嘉信入金 USD、检查状态）
 * - 「入金记录」K/L 列（到账差额、检查状态）
 * - 「分红记录」F 列（税后分红）
 * - 「原入金记录」L–S 列（四段汇率与余额、检查状态）
 */

const ACCOUNT_ZHANGXIN = new Set(['嘉信证券', '嘉信入金中转'])

// ---------------------------------------------------------------------------
// 换汇记录
// ---------------------------------------------------------------------------

export interface FxComputed extends FxRecord {
  /** 付币／收币汇率 = 换汇本金 ÷ 实际收到金额，原表 K 列。 */
  rate?: number
  /** 计入嘉信入金 USD，原表 L 列。 */
  creditedUsd: number
  status: string
}

/**
 * 汇率只在付币金额、收币金额都有效时才计算。
 * 原表用「付币 ÷ 收币」，所以人民币→港元得到 0.86 左右的数值，
 * 含义是 1 港元付掉多少人民币。
 */
export function fxRate(amount: number | undefined, received: number | undefined): number | undefined {
  if (!isPositive(amount) || !isPositive(received)) return undefined
  return num(amount, 0) / num(received, 0)
}

/**
 * 计入嘉信入金 USD。
 *
 * 原表 L 列公式：日期有效 且 收币账户是嘉信证券/嘉信入金中转 且 付币账户不是嘉信证券
 * 且 收币币种为 USD 且 收到金额 > 0 时，取实际收到金额，否则 0。
 * 「付币账户不是嘉信证券」这条防的是嘉信内部划转被重复计入。
 */
export function creditedUsd(r: Pick<FxRecord, 'date' | 'toAccount' | 'fromAccount' | 'toCurrency' | 'received'>): number {
  if (!isDay(r.date)) return 0
  if (!ACCOUNT_ZHANGXIN.has(r.toAccount)) return 0
  if (r.fromAccount === '嘉信证券') return 0
  if (r.toCurrency !== 'USD') return 0
  const received = num(r.received, 0)
  return received > 0 ? received : 0
}

/** 换汇检查状态，对应原表 M 列。 */
export function fxStatus(r: FxRecord): string {
  const touched = isDay(r.date) || num(r.amount, 0) !== 0 || num(r.received, 0) !== 0
  if (!touched) return ''
  if (!isDay(r.date) || !r.fromAccount || !r.fromCurrency || !isPositive(r.amount) || !r.toAccount || !r.toCurrency || !isPositive(r.received)) {
    return '待补换汇信息'
  }
  const fee = num(r.feeAmount, 0)
  if (num(r.amount, 0) <= 0 || num(r.received, 0) <= 0 || fee < 0 || r.fromCurrency === r.toCurrency || (fee > 0 && !r.feeCurrency)) {
    return '请检查币种／金额／费用'
  }
  return '已记录'
}

export function computeFx(records: FxRecord[]): FxComputed[] {
  return records.map(r => ({
    ...r,
    rate: fxRate(r.amount, r.received),
    creditedUsd: creditedUsd(r),
    status: fxStatus(r)
  }))
}

// ---------------------------------------------------------------------------
// 入金记录
// ---------------------------------------------------------------------------

export interface TransferComputed extends TransferRecord {
  /** 到账差额 = 汇出本金 − 实际到账，原表 K 列。 */
  difference?: number
  status: string
}

/** 到账差额，原表 K 列。 */
export function transferDifference(amount: number | undefined, received: number | undefined): number | undefined {
  if (amount === undefined || received === undefined) return undefined
  if (!Number.isFinite(num(amount, NaN)) || !Number.isFinite(num(received, NaN))) return undefined
  return num(amount, 0) - num(received, 0)
}

/**
 * 入金检查状态，对应原表 L 列。
 * 顺序：待补信息 → 本金／费用／账户异常 → 在途待补到账 → 到账信息异常 → 已记录。
 */
export function transferStatus(r: TransferRecord): string {
  const touched = isDay(r.date) || num(r.amount, 0) !== 0
  if (!touched) return ''
  if (!isDay(r.date) || !r.fromAccount || !r.currency || !isPositive(r.amount) || !r.toAccount) {
    return '待补汇出信息'
  }
  const fee = num(r.feeAmount, 0)
  if (num(r.amount, 0) <= 0 || fee < 0 || (fee > 0 && !r.feeCurrency) || r.fromAccount === r.toAccount) {
    return '请检查本金／费用／账户'
  }
  if (r.received === undefined || !isDay(r.receivedDate)) return '在途／待补到账'
  const received = num(r.received, 0)
  if (received < 0 || Boolean(r.receivedDate && r.date && r.receivedDate < r.date)) return '请检查到账信息'
  return '已记录'
}

export function computeTransfers(records: TransferRecord[]): TransferComputed[] {
  return records.map(r => ({
    ...r,
    difference: transferDifference(r.amount, r.received),
    status: transferStatus(r)
  }))
}

/**
 * 向嘉信渠道实际到账的美元累计（原表「总览」E16 的口径）。
 *
 * 两家来源相加：
 * 1. 换汇记录里「计入嘉信入金 USD」的合计
 * 2. 入金记录里币种为 USD、收款账户为嘉信证券的实际到账
 *
 * 关键的防重复：中转步骤（收款账户为「嘉信入金中转」）**不计入第二类**，
 * 否则同一笔钱会在换汇和入金两张表里各算一次。
 *
 * 出金**不参与**这个口径：它是资金离场，不是入金。
 */
export function receivedUsdTotal(fx: FxComputed[], transfers: TransferComputed[]): number {
  const fromFx = fx.reduce((s, r) => s + r.creditedUsd, 0)
  const fromTransfers = transfers
    .filter(t => t.toAccount === '嘉信证券' && t.currency === 'USD')
    .reduce((s, t) => s + (t.received !== undefined ? num(t.received, 0) : 0), 0)
  return fromFx + fromTransfers
}

// ---------------------------------------------------------------------------
// 出金记录
// ---------------------------------------------------------------------------

export interface WithdrawalComputed extends WithdrawalRecord {
  /** 到账差额 = 汇出本金 − 实际到账。 */
  difference?: number
  status: string
}

/**
 * 出金检查状态。
 *
 * 与入金同构，但措辞改成「出金」，并且在收款账户与汇出账户相同时提示核对——
 * 出金一定是往账户外走，两端相同几乎肯定是填错了。
 */
export function withdrawalStatus(r: WithdrawalRecord): string {
  const touched = isDay(r.date) || num(r.amount, 0) !== 0
  if (!touched) return ''
  if (!isDay(r.date) || !r.fromAccount || !r.currency || !isPositive(r.amount) || !r.toAccount) {
    return '待补出金信息'
  }
  const fee = num(r.feeAmount, 0)
  if (num(r.amount, 0) <= 0 || fee < 0 || (fee > 0 && !r.feeCurrency) || r.fromAccount === r.toAccount) {
    return '请检查本金／费用／账户'
  }
  if (r.received === undefined || !isDay(r.receivedDate)) return '在途／待补到账'
  const received = num(r.received, 0)
  if (received < 0 || Boolean(r.receivedDate && r.date && r.receivedDate < r.date)) return '请检查到账信息'
  return '已记录'
}

export function computeWithdrawals(records: WithdrawalRecord[]): WithdrawalComputed[] {
  return records.map(r => ({
    ...r,
    difference: transferDifference(r.amount, r.received),
    status: withdrawalStatus(r)
  }))
}

// ---------------------------------------------------------------------------
// 分红记录
// ---------------------------------------------------------------------------

export interface DividendComputed extends DividendRecord {
  /** 税后分红 = 税前 − 预扣税 − 其他费用，原表 F 列。 */
  net: number
}

export function computeDividends(records: DividendRecord[]): DividendComputed[] {
  return records.map(r => ({
    ...r,
    net: round2(num(r.gross, 0) - num(r.tax, 0) - num(r.fee, 0))
  }))
}

export function netDividendsTotal(records: DividendComputed[]): number {
  return records.reduce((s, r) => s + r.net, 0)
}

// ---------------------------------------------------------------------------
// 原入金记录（批次）
// ---------------------------------------------------------------------------

export interface BatchComputed extends BatchRecord {
  /** 购汇 RMB／HKD，原表 L 列。 */
  rmbPerHkd?: number
  /** 首段扣减 HKD，原表 M 列。 */
  firstLegDeduction?: number
  /** 国内余款 HKD，原表 N 列。 */
  domesticLeftover?: number
  /** 汇丰余款 HKD，原表 O 列。 */
  hsbcLeftover?: number
  /** 汇出 HKD／USD，原表 P 列。 */
  hkdPerUsd?: number
  /** 整批成本 RMB（仅「已完整划转」时成立），原表 Q 列。 */
  batchCost?: number
  /** 成本 RMB／USD，原表 R 列。 */
  rmbPerUsd?: number
  /**
   * 状态，原表 S 列。
   * 未触及的空白行为 undefined；computeBatches 会补上这个字段。
   */
  status?: string
}

/**
 * 批次状态，对应原表 S 列分支顺序：
 *   待补分段记录 → 金额关系待检查 → 尚有港元余额 → 已完整划转
 *
 * 入参放宽到「只给派生字段」的形态，这样它既是 computeBatches 的内部步骤，
 * 也能被单测直接调用，不需要先构造一个完整对象。
 */
export function batchStatus(b: Pick<BatchComputed, 'date' | 'rmbPrincipal' | 'hkdBought' | 'sentHkd' | 'hsbcInHkd' | 'hsbcOutHkd' | 'usdReceived' | 'usdDate' | 'extraFeeRmb' | 'hkdFee' | 'firstLegDeduction' | 'domesticLeftover' | 'hsbcLeftover'>): string | undefined {
  // 完全空白的一行不提示状态，避免整表铺满「待补分段记录」
  const touched =
    isDay(b.date) ||
    num(b.rmbPrincipal, 0) !== 0 ||
    num(b.hkdBought, 0) !== 0 ||
    num(b.usdReceived, 0) !== 0
  if (!touched) return undefined

  // 第一段（国内购汇）没填完 → 待补
  if (!isDay(b.date) || !isPositive(b.rmbPrincipal) || !isPositive(b.hkdBought)) return '待补分段记录'

  // 后续四段必须全部填齐才算走完流程。
  // 这里不能只检查「有没有填过若干项」：只填了国内汇出 HKD、却没有任何到账记录时，
  // 派生出的余款刚好都是 0，会被误判成「已完整划转」并算出一个假的整批成本。
  const laterFilled =
    isPositive(b.sentHkd) &&
    isPositive(b.hsbcInHkd) &&
    isPositive(b.hsbcOutHkd) &&
    isPositive(b.usdReceived) &&
    isDay(b.usdDate)
  if (!laterFilled) return '待补分段记录'

  if (
    num(b.extraFeeRmb, 0) < 0 ||
    num(b.hkdFee, 0) < 0 ||
    num(b.firstLegDeduction, 0) < -0.01 ||
    num(b.domesticLeftover, 0) < -0.01 ||
    num(b.hsbcLeftover, 0) < -0.01
  ) {
    return '金额关系待检查'
  }

  if (Math.abs(num(b.domesticLeftover, 0)) > 0.01 || Math.abs(num(b.hsbcLeftover, 0)) > 0.01) {
    return '尚有港元余额'
  }
  return '已完整划转'
}

export function computeBatches(records: BatchRecord[]): BatchComputed[] {
  return records.map(raw => {
    const partial: BatchComputed = { ...raw }

    // 汇率保持全精度，不能取到分：0.864023... 截成 0.86 会让人以为换汇亏了一截。
    partial.rmbPerHkd = money(raw.rmbPrincipal, raw.hkdBought)
    partial.hkdPerUsd = money(raw.hsbcOutHkd, raw.usdReceived)

    // 四段余额是「港元金额」，取到分：原表 N/O 列的 0.01 容差判断和界面显示都按 2 位小数，
    // 不取整会让 5786.19 − 4000 变成 1786.1899999999996。
    partial.firstLegDeduction = difference(raw.sentHkd, raw.hsbcInHkd)
    partial.domesticLeftover = difference(raw.hkdBought, raw.sentHkd)
    // 汇丰余款要先扣掉汇款时另外扣的港元费用
    partial.hsbcLeftover = difference(raw.hsbcInHkd, raw.hsbcOutHkd, num(raw.hkdFee, 0))

    // 整批成本只在完整划转后才成立——这正是原表「不计算整批成本」的用意
    partial.status = batchStatus(partial)
    partial.batchCost = partial.status === '已完整划转'
      ? round2(num(raw.rmbPrincipal, 0) + num(raw.extraFeeRmb, 0))
      : undefined
    partial.rmbPerUsd = partial.batchCost === undefined
      ? undefined
      : money(partial.batchCost, raw.usdReceived)

    return partial
  })
}

// ---------------------------------------------------------------------------

function isPositive(v: unknown): boolean {
  return num(v, 0) > 0
}

/**
 * 两个数相除；分母无效或缺失时返回 undefined（表示这一段还没填）。
 * 不取整，保留全精度。
 */
function money(numerator: unknown, denominator: unknown): number | undefined {
  if (!isPositive(denominator)) return undefined
  if (numerator === undefined || numerator === null || numerator === '') return undefined
  const n = Number(numerator)
  if (!Number.isFinite(n)) return undefined
  return n / num(denominator, 1)
}

/**
 * 首个值减去其余所有值。任一输入缺失就返回 undefined，
 * 而不是把缺失当 0 算出一个看似合理的数字。
 */
function difference(...values: (number | undefined)[]): number | undefined {
  if (values.some(v => v === undefined)) return undefined
  const [first = 0, ...rest] = values as number[]
  return round2(rest.reduce((s, v) => s - num(v, 0), num(first, 0)))
}
