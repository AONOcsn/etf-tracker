import { normalizeData } from './empty.ts'
import type { AppData, Snapshot } from './types.ts'

/** 导入必须是本应用的完整账本；不能把任意 JSON 静默转换为空账本。 */
export function validateBackup(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('请选择本应用导出的 JSON 备份。')
  const input = raw as Record<string, unknown>
  if (input.version !== 1) throw new Error('备份版本不支持，请使用版本 1 的账本备份。')
  if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) throw new Error('备份缺少设置。')
  const settings = input.settings as Record<string, unknown>
  for (const key of ['baseMonthly', 'extraBudgetTotal', 'startingPeak', 'planDay', 'rebalance']) {
    if (typeof settings[key] !== 'number' || !Number.isFinite(settings[key])) throw new Error(`设置 ${key} 不是有效数字。`)
  }
  for (const key of ['accounts', 'currencies']) {
    if (settings[key] !== undefined && (!Array.isArray(settings[key]) || !(settings[key] as unknown[]).every(v => typeof v === 'string'))) throw new Error(`设置 ${key} 格式不正确。`)
  }
  for (const key of ['lastQuoteAt', 'lastQuoteSource', 'cashCheckedAt']) {
    if (settings[key] !== undefined && typeof settings[key] !== 'string') throw new Error(`设置 ${key} 格式不正确。`)
  }
  if (settings.cashUsd !== undefined && (typeof settings.cashUsd !== 'number' || !Number.isFinite(settings.cashUsd))) throw new Error('现金余额不是有效数字。')
  const tables = {
    etfs: { strings: ['symbol'], numbers: ['targetRatio', 'price', 'cash', 'investRatio'] },
    planMonths: { strings: ['period'], numbers: ['spClose', 'newPeak', 'actualExtraOverride'] },
    trades: { strings: ['id', 'date', 'symbol', 'side'], numbers: ['amount', 'fee', 'shares'] },
    fxRecords: { strings: ['id', 'date', 'fromAccount', 'fromCurrency', 'toAccount', 'toCurrency'], numbers: ['amount', 'received', 'feeAmount'] },
    transfers: { strings: ['id', 'date', 'fromAccount', 'toAccount', 'currency'], numbers: ['amount', 'received', 'feeAmount'] },
    withdrawals: { strings: ['id', 'date', 'fromAccount', 'toAccount', 'currency'], numbers: ['amount', 'received', 'feeAmount'] },
    dividends: { strings: ['id', 'date', 'symbol'], numbers: ['gross', 'tax', 'fee'] },
    batches: { strings: ['id', 'date'], numbers: ['rmbPrincipal', 'hkdBought', 'extraFeeRmb', 'sentHkd', 'hsbcInHkd', 'hsbcOutHkd', 'hkdFee', 'usdReceived'] }
  }
  const requiredNumbers: Record<string, string[]> = {
    etfs: ['price', 'targetRatio'], trades: ['amount', 'fee', 'shares'],
    fxRecords: ['amount', 'received'], transfers: ['amount'], withdrawals: ['amount'],
    dividends: ['gross', 'tax'], batches: ['rmbPrincipal', 'hkdBought']
  }
  for (const [name, fields] of Object.entries(tables)) {
    if (name === 'withdrawals' && input[name] === undefined) continue
    const rows = input[name]
    if (!Array.isArray(rows)) throw new Error(`备份缺少 ${name} 记录。`)
    const ids = new Set<string>()
    for (const [index, row] of rows.entries()) {
      const invalid = () => new Error(`${name} 第 ${index + 1} 条记录格式不正确，未导入任何数据。`)
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid()
      for (const key of fields.strings) if (typeof row[key] !== 'string') throw invalid()
      for (const key of fields.numbers) {
        if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key]))) throw invalid()
      }
      for (const key of requiredNumbers[name] ?? []) if (typeof row[key] !== 'number') throw invalid()
      for (const key of ['note', 'purpose', 'receivedDate', 'observedDate', 'usdDate', 'ref', 'feeCurrency', 'priceDate']) {
        if (row[key] !== undefined && typeof row[key] !== 'string') throw invalid()
      }
      if (row.spManual !== undefined && typeof row.spManual !== 'boolean') throw invalid()
      const id = row.id ?? row.symbol ?? row.period
      if (!id || ids.has(id)) throw invalid()
      ids.add(id)
      if (name === 'trades' && row.side !== 'buy' && row.side !== 'sell') throw invalid()
      if (name === 'etfs' && (typeof row.planned !== 'boolean' || typeof row.price !== 'number' || typeof row.targetRatio !== 'number')) throw invalid()
      if (name === 'planMonths' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period)) throw invalid()
    }
  }
  return normalizeData(input)
}

/** 自动快照和操作前恢复点独立限额，日常保存不会清掉操作前版本。 */
export function retainSnapshots(list: Snapshot[]): Snapshot[] {
  const ordered = [...list].sort((a, b) => a.at.localeCompare(b.at))
  return [
    ...ordered.filter(s => s.label.startsWith('auto-')).slice(-7),
    ...ordered.filter(s => !s.label.startsWith('auto-')).slice(-7)
  ].sort((a, b) => a.at.localeCompare(b.at))
}
