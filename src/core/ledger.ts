import type { AppData, Trade, DividendRecord, FxRecord, TransferRecord, WithdrawalRecord } from './types.ts'
import { today, uid } from './types.ts'
import { accountsOf, currenciesOf } from './empty.ts'
import { computeHoldings } from './holdings.ts'
import { computeBatches, fxStatus, transferStatus, withdrawalStatus } from './funds.ts'

export type RecordKind = 'buy' | 'sell' | 'dividend' | 'fx' | 'transfer' | 'withdrawal'
export type RecordForm = { id: string; date: string } & Partial<Omit<Trade & DividendRecord & FxRecord & TransferRecord & WithdrawalRecord, 'id' | 'date'>>
export type RecordRequest = { kind: RecordKind; id?: string; symbol?: string; date?: string; referenceAmount?: number }
export const KIND_LABEL: Record<RecordKind | 'batch', string> = { buy: '买入', sell: '卖出', dividend: '分红', fx: '换汇', transfer: '入金', withdrawal: '出金', batch: '旧批次' }
export const recordTable = (kind: RecordKind) => ({ buy: 'trades', sell: 'trades', dividend: 'dividends', fx: 'fxRecords', transfer: 'transfers', withdrawal: 'withdrawals' } as const)[kind]

export function createRecord(data: AppData, kind: RecordKind): RecordForm {
  const accounts = accountsOf(data.settings)
  const currencies = currenciesOf(data.settings)
  const last = data[recordTable(kind)].slice(-1)[0] as RecordForm | undefined
  const base: RecordForm = { id: uid(), date: today() }
  if (kind === 'buy' || kind === 'sell') return { ...base, symbol: data.etfs[0]?.symbol ?? 'VOO', side: kind, fee: 0, purpose: '定投' }
  if (kind === 'dividend') return { ...base, symbol: data.etfs[0]?.symbol ?? 'VOO', tax: 0, fee: 0 }
  const fromAccount = last?.fromAccount ?? accounts[kind === 'withdrawal' ? 3 : 1] ?? accounts[0]
  const toAccount = last?.toAccount ?? accounts[kind === 'withdrawal' ? 0 : 3] ?? accounts.slice(-1)[0]
  return kind === 'fx'
    ? { ...base, fromAccount: last?.fromAccount ?? accounts[0], toAccount: last?.toAccount ?? accounts[1], fromCurrency: last?.fromCurrency ?? currencies[0], toCurrency: last?.toCurrency ?? currencies[1] }
    : { ...base, fromAccount, toAccount, currency: last?.currency ?? 'USD' }
}

export function validDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value
}

export function validateRecord(data: AppData, kind: RecordKind, form: RecordForm): string | undefined {
  if (!validDate(form.date)) return '请填写有效日期'
  const positive = (n: number | undefined) => n !== undefined && Number.isFinite(n) && n > 0
  for (const key of ['fee', 'feeAmount', 'tax', 'received'] as const) {
    if (form[key] !== undefined && (!Number.isFinite(form[key]) || form[key]! < 0)) return '费用、税款和到账金额不能为负或无效数字'
  }
  if (kind === 'buy' || kind === 'sell') {
    if (!form.symbol?.trim() || !positive(form.amount) || !positive(form.shares)) return '请补齐标的、成交金额和份额'
    const trade = { ...form, symbol: form.symbol.trim().toUpperCase(), side: kind, fee: form.fee ?? 0 } as Trade
    const next = data.trades.some(t => t.id === form.id) ? data.trades.map(t => t.id === form.id ? trade : t) : [...data.trades, trade]
    const after = computeHoldings(next)
    const status = after.trades.find(t => t.id === form.id)?.status
    if (status !== '已记录') return status ?? '成交信息不完整'
    const priorValid = new Set(computeHoldings(data.trades).trades.filter(t => t.status === '已记录').map(t => t.id))
    if (after.trades.some(t => t.id !== form.id && priorValid.has(t.id) && t.status !== '已记录')) return '本次修改会影响后续成交，请先核对相关卖出记录'
    return undefined
  }
  if (kind === 'dividend') {
    if (!form.symbol?.trim() || !positive(form.gross)) return '请补齐标的和税前分红'
    if ((form.tax ?? 0) + (form.fee ?? 0) > form.gross!) return '预扣税与费用不能超过税前分红'
    return undefined
  }
  if (!positive(form.amount) || !form.fromAccount || !form.toAccount) return '请补齐金额、汇出账户和收款账户'
  if ((form.feeAmount ?? 0) > 0 && !form.feeCurrency) return '请填写另付费用的币种'
  if (kind === 'fx') {
    if (!form.fromCurrency || !form.toCurrency || form.fromCurrency === form.toCurrency || !positive(form.received)) return '请补齐不同的付币、收币与实际收到金额'
  } else {
    if (!form.currency || form.fromAccount === form.toAccount) return '请选择币种和不同的汇出、收款账户'
    if (form.received !== undefined || form.receivedDate) {
      if (form.received === undefined || !validDate(form.receivedDate) || form.receivedDate! < form.date) return '到账金额和有效到账日期需一起填写，且不能早于汇出日期'
    }
  }
  return undefined
}

export function saveRecord(data: AppData, kind: RecordKind, form: RecordForm): AppData {
  const error = validateRecord(data, kind, form)
  if (error) throw new Error(error)
  const table = recordTable(kind)
  const row = { ...form, ...(form.symbol ? { symbol: form.symbol.trim().toUpperCase() } : {}),
    ...(kind === 'buy' || kind === 'sell' ? { side: kind, fee: form.fee ?? 0 } : {}),
    ...(kind === 'dividend' ? { tax: form.tax ?? 0 } : {}) }
  return { ...data, [table]: data[table].some(r => r.id === row.id) ? data[table].map(r => r.id === row.id ? row : r) : [...data[table], row] }
}

export function isDuplicate(data: AppData, kind: RecordKind, form: RecordForm): boolean {
  if (kind !== 'buy' && kind !== 'sell') return false
  return data.trades.some(t => t.id !== form.id && t.date === form.date && t.side === kind && t.symbol.toUpperCase() === form.symbol?.trim().toUpperCase() && t.amount === form.amount && t.shares === form.shares)
}

export interface LedgerRow {
  kind: RecordKind | 'batch'; id: string; date: string; title: string
  amount: number; currency: string; symbol?: string; accounts: string[]
  note?: string; description: string; status?: string; form: RecordForm
  effect?: { sharesDelta: number; costDelta: number; realized: number }
}

export function ledgerRows(data: AppData): LedgerRow[] {
  const rows: LedgerRow[] = computeHoldings(data.trades).trades.map(t => ({
    kind: t.side, id: t.id, date: t.date, title: `${t.symbol} ${KIND_LABEL[t.side]}`,
    amount: t.amount, currency: 'USD', symbol: t.symbol, accounts: [], note: t.note,
    description: `${t.shares} 份`, status: t.status, form: data.trades.find(row => row.id === t.id)!,
    effect: { sharesDelta: t.sharesDelta, costDelta: t.costDelta, realized: t.realized }
  }))
  for (const t of data.dividends) rows.push({ kind: 'dividend', id: t.id, date: t.date, title: `${t.symbol} 分红`, amount: t.gross - t.tax - (t.fee ?? 0), currency: 'USD', symbol: t.symbol, accounts: [], note: t.note, description: '税后到账', status: validateRecord(data, 'dividend', t), form: t })
  for (const kind of ['fx', 'transfer', 'withdrawal'] as const) {
    for (const t of data[recordTable(kind)]) {
      const r = t as RecordForm
      rows.push({ kind, id: r.id, date: r.date, title: KIND_LABEL[kind], amount: r.amount ?? 0, currency: kind === 'fx' ? r.fromCurrency ?? '' : r.currency ?? '', accounts: [r.fromAccount ?? '', r.toAccount ?? ''], note: r.note,
        description: `${r.fromAccount} → ${r.toAccount}${kind === 'fx' ? ` · 收到 ${r.received ?? '—'} ${r.toCurrency}` : ''}`,
        status: kind === 'fx' ? fxStatus(r as FxRecord) : kind === 'transfer' ? transferStatus(r as TransferRecord) : withdrawalStatus(r as WithdrawalRecord), form: r })
    }
  }
  for (const b of computeBatches(data.batches)) rows.push({ kind: 'batch', id: b.id, date: b.date, title: '旧批次记录', amount: b.rmbPrincipal, currency: 'RMB', accounts: [], note: b.note, description: '历史资金资料', status: b.status, form: b })
  // 稳定排序保留同日成交原有顺序；不重排底层交易。
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

export function filterLedger(rows: LedgerRow[], filters: { type?: string; month?: string; symbol?: string; account?: string; query?: string }): LedgerRow[] {
  const query = filters.query?.trim().toLowerCase()
  return rows.filter(r => (!filters.type || filters.type === 'all' || (filters.type === 'trades' ? r.kind === 'buy' || r.kind === 'sell' : filters.type === 'funds' ? ['fx', 'transfer', 'withdrawal', 'batch'].includes(r.kind) : r.kind === filters.type)) &&
    (!filters.month || r.date.startsWith(filters.month)) && (!filters.symbol || r.symbol === filters.symbol) && (!filters.account || r.accounts.includes(filters.account)) &&
    (!query || [r.title, r.description, r.note, r.id, r.date, ...r.accounts].join(' ').toLowerCase().includes(query)))
}
