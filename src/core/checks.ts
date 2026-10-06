import type { AppData } from './types.ts'
import type { HoldingsResult } from './holdings.ts'
import type { FxComputed, TransferComputed, BatchComputed, DividendComputed, WithdrawalComputed } from './funds.ts'
import { CAPACITY } from './types.ts'

/**
 * 把四张记录表里所有「没通过检查」的行汇成一个列表。
 *
 * 原表是靠单元格红黄底逐格提示的，手机屏幕上翻四张表找问题很累，
 * 所以这里给「更多」页做一个总入口：一条问题一行，点进去就能改。
 */

export type IssueSeverity = 'warn' | 'info'

export interface Issue {
  id: string
  /** 出问题的区域，同时用于跳转。 */
  area: '交易' | '换汇' | '入金' | '出金' | '分红' | '原入金' | '计划'
  /** 出问题那一行的定位文本（日期／代码）。 */
  where: string
  message: string
  severity: IssueSeverity
}

export function collectIssues(params: {
  holdings: HoldingsResult
  fx: FxComputed[]
  transfers: TransferComputed[]
  withdrawals?: WithdrawalComputed[]
  batches: BatchComputed[]
  dividends: DividendComputed[]
  /** 回撤计划的逐月状态，用于提示未补行情。 */
  planStatuses?: { period: string; status?: string }[]
}): Issue[] {
  const { holdings, fx, transfers, withdrawals, batches, dividends, planStatuses } = params
  const issues: Issue[] = []

  for (const t of holdings.trades) {
    if (t.status !== '已记录') {
      issues.push({
        id: `trade-${t.id}`,
        area: '交易',
        where: `${t.date || '无日期'} ${t.symbol || '未选ETF'}`,
        message: t.status,
        // 卖出超过持仓、输入非法都可能导致金额记错，标成 warn 更醒目
        severity: t.status === '卖出超过持仓' || t.status === '请检查输入' ? 'warn' : 'info'
      })
    }
  }

  for (const r of fx) {
    if (r.status && r.status !== '已记录') {
      issues.push({
        id: `fx-${r.id}`,
        area: '换汇',
        where: `${r.date || '无日期'} ${r.fromCurrency || '?'}→${r.toCurrency || '?'}`,
        message: r.status,
        severity: r.status === '请检查币种／金额／费用' ? 'warn' : 'info'
      })
    }
  }

  for (const r of transfers) {
    if (r.status && r.status !== '已记录') {
      issues.push({
        id: `transfer-${r.id}`,
        area: '入金',
        where: `${r.date || '无日期'} ${r.currency || '?'}`,
        message: r.status,
        // 「在途／待补到账」是正常中间态，不算问题
        severity: r.status === '在途／待补到账' ? 'info' : 'warn'
      })
    }
  }

  for (const r of withdrawals ?? []) {
    if (r.status && r.status !== '已记录') {
      issues.push({
        id: `withdrawal-${r.id}`,
        area: '出金',
        where: `${r.date || '无日期'} ${r.currency || '?'}`,
        message: r.status,
        // 「在途／待补到账」是正常中间态，不算问题
        severity: r.status === '在途／待补到账' ? 'info' : 'warn'
      })
    }
  }

  for (const r of batches) {
    if (r.status && r.status !== '已完整划转') {
      issues.push({
        id: `batch-${r.id}`,
        area: '原入金',
        where: `${r.date || '无日期'}`,
        message: r.status,
        severity: r.status === '金额关系待检查' ? 'warn' : 'info'
      })
    }
  }

  for (const r of dividends) {
    const touched = Boolean(r.date) || r.gross !== 0
    if (touched && r.net < 0) {
      issues.push({
        id: `dividend-${r.id}`,
        area: '分红',
        where: `${r.date || '无日期'} ${r.symbol || ''}`,
        message: '税后分红为负，请核对税前／预扣税',
        severity: 'warn'
      })
    }
  }

  for (const p of planStatuses ?? []) {
    const status = p.status ?? ''
    if (status.startsWith('实际加投超剩余预算') || status.startsWith('核对观察日')) {
      issues.push({
        id: `plan-${p.period}`,
        area: '计划',
        where: p.period,
        message: status,
        severity: 'warn'
      })
    }
  }

  return issues
}

/** 容量检查：接近原表预留上限时提醒（对应「使用说明」第 41 条）。 */
export function capacityWarnings(data: AppData): string[] {
  const out: string[] = []
  const check = (label: string, count: number, limit: number) => {
    if (count >= limit) out.push(`${label}已用满 ${limit} 条，需要扩展预留范围`)
    else if (count >= limit * 0.9) out.push(`${label}已用 ${count}／${limit} 条，接近上限`)
  }
  check('交易记录', data.trades.length, CAPACITY.trades)
  check('换汇记录', data.fxRecords.length, CAPACITY.fx)
  check('入金记录', data.transfers.length, CAPACITY.transfers)
  check('出金记录', data.withdrawals.length, CAPACITY.transfers)
  check('分红记录', data.dividends.length, CAPACITY.dividends)
  return out
}
