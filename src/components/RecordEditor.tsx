import { useState } from 'react'
import { Field, NumberInput, DateInput, TextInput, Sheet, Row } from './ui.tsx'
import type { AppData } from '../core/types.ts'
import { KIND_LABEL, isDuplicate, validateRecord } from '../core/ledger.ts'
import type { RecordForm, RecordKind } from '../core/ledger.ts'
import { accountsOf, currenciesOf } from '../core/empty.ts'

export function RecordEditor({ data, kind, initial, referenceAmount, draftSaving, draftError, onDraft, onSave, onClose, onDiscard }: {
  data: AppData; kind: RecordKind; initial: RecordForm; referenceAmount?: number
  draftSaving: boolean; draftError?: string
  onDraft: (form: RecordForm) => void
  onSave: (form: RecordForm) => Promise<void>
  onClose: () => void; onDiscard: () => Promise<void>
}) {
  const [form, setForm] = useState({ ...initial })
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const trade = kind === 'buy' || kind === 'sell'
  const funds = kind === 'fx' || kind === 'transfer' || kind === 'withdrawal'
  const validation = validateRecord(data, kind, form)
  const duplicate = isDuplicate(data, kind, form)
  const set = (patch: Partial<RecordForm>) => {
    if (submitting) return
    const next = { ...form, ...patch }
    setForm(next)
    setDuplicateConfirmed(false)
    setError(undefined)
    onDraft(next)
  }
  const account = (label: string, key: 'fromAccount' | 'toAccount') => <Field label={label}><Choices value={form[key]} values={accountsOf(data.settings)} onChange={v => set({ [key]: v })} /></Field>
  const currency = (label: string, key: 'currency' | 'fromCurrency' | 'toCurrency' | 'feeCurrency', optional = false) => <Field label={label}><Choices value={form[key]} values={currenciesOf(data.settings)} optional={optional} onChange={v => set({ [key]: v || undefined })} /></Field>
  const symbol = <Field label="标的代码"><TextInput value={form.symbol} onChange={v => set({ symbol: v.toUpperCase().trim() })} placeholder="例如 VOO" /><div className="symbol-options">{data.etfs.map(e => <button type="button" key={e.symbol} className={form.symbol === e.symbol ? 'selected' : ''} onClick={() => set({ symbol: e.symbol })}>{e.symbol}</button>)}</div></Field>

  async function save() {
    if (validation || submitting) return
    if (duplicate && !duplicateConfirmed) { setDuplicateConfirmed(true); return }
    setSubmitting(true)
    try { await onSave(form) } catch (e) { setError(e instanceof Error ? e.message : String(e)); setSubmitting(false) }
  }

  return <Sheet title={`记录${KIND_LABEL[kind]}`} onClose={() => { if (!submitting) onClose() }}>
    <fieldset className="record-fields" disabled={submitting}>
    <p className={`draft-status ${draftError ? 'neg' : ''}`} role="status">{draftError ? `草稿尚未保存：${draftError}` : draftSaving ? '草稿保存中…' : '未完成内容会保留为草稿'}</p>
    {referenceAmount !== undefined && <div className="banner info">计划参考 {referenceAmount.toFixed(2)} USD，请按券商实际成交填写金额和份额。</div>}
    <Field label={kind === 'dividend' ? '分红到账日期' : trade ? '成交日期' : '汇出日期'}><DateInput value={form.date} onChange={v => set({ date: v ?? '' })} /></Field>
    {(trade || kind === 'dividend') && symbol}
    {trade && <>
      <div className="grid2"><Field label="成交金额 USD" sub="不含手续费"><NumberInput value={form.amount} onChange={v => set({ amount: v })} placeholder="0.00" /></Field><Field label="成交份额"><NumberInput value={form.shares} onChange={v => set({ shares: v })} placeholder="0.000000" /></Field></div>
      {form.amount !== undefined && form.shares !== undefined && form.shares > 0 && <Row label="核对成交单价" value={`${(form.amount / form.shares).toFixed(4)} USD`} />}
      {kind === 'buy' && <Field label="买入用途"><select value={form.purpose ?? '定投'} onChange={e => set({ purpose: e.target.value as RecordForm['purpose'] })}><option>定投</option><option>分红再投</option><option>其他</option></select></Field>}
    </>}
    {kind === 'dividend' && <>
      <Field label="税前分红 USD"><NumberInput value={form.gross} onChange={v => set({ gross: v })} placeholder="0.00" /></Field>
      <div className="grid2"><Field label="预扣税 USD"><NumberInput value={form.tax} onChange={v => set({ tax: v })} /></Field><Field label="其他费用 USD"><NumberInput value={form.fee} onChange={v => set({ fee: v })} /></Field></div>
      <Row label="税后到账 USD" value={((form.gross ?? 0) - (form.tax ?? 0) - (form.fee ?? 0)).toFixed(2)} />
    </>}
    {funds && <>
      <div className="grid2">{account('汇出账户', 'fromAccount')}{account('收款账户', 'toAccount')}</div>
      {kind === 'fx' ? <div className="grid2">{currency('付币', 'fromCurrency')}{currency('收币', 'toCurrency')}</div> : currency('币种', 'currency')}
      <Field label={`汇出本金 ${kind === 'fx' ? form.fromCurrency ?? '' : form.currency ?? ''}`} sub="不含另付费用"><NumberInput value={form.amount} onChange={v => set({ amount: v })} placeholder="0.00" /></Field>
      <Field label={`实际收到 ${kind === 'fx' ? form.toCurrency ?? '' : form.currency ?? ''}`} sub={kind !== 'fx' ? '在途时，金额和到账日期一起留空。' : undefined}><NumberInput value={form.received} onChange={v => set({ received: v })} placeholder={kind === 'fx' ? '0.00' : '在途可留空'} /></Field>
      {kind !== 'fx' && <Field label="到账日期"><DateInput value={form.receivedDate} onChange={v => set({ receivedDate: v })} /></Field>}
      {kind === 'fx' && !!form.amount && !!form.received && <Row label="换汇参考" value={`1 ${form.toCurrency} = ${(form.amount / form.received).toFixed(4)} ${form.fromCurrency}`} />}
    </>}
    <details className="form-details" open={!!(form.feeAmount || (trade && form.fee) || form.note || form.ref)}><summary>{trade ? '手续费与备注' : '更多信息'}</summary>
      {trade && <Field label="手续费 USD"><NumberInput value={form.fee} onChange={v => set({ fee: v })} /></Field>}
      {funds && <><Field label="流水或关联编号"><TextInput value={form.ref} onChange={v => set({ ref: v || undefined })} /></Field><div className="grid2">{currency('另付费币种', 'feeCurrency', true)}<Field label="另付费用"><NumberInput value={form.feeAmount} onChange={v => set({ feeAmount: v })} /></Field></div></>}
      <Field label="备注"><TextInput value={form.note} onChange={v => set({ note: v || undefined })} placeholder="选填，可用于搜索" /></Field>
    </details>
    {validation && <p className="note">{validation}。内容仍可作为草稿保留。</p>}
    {duplicateConfirmed && <div className="banner info">已有日期、标的、方向、金额及份额相同的成交。请确认这是另一笔实际成交，再次点击保存。</div>}
    {error && <div className="banner err" role="alert">{error}</div>}
    {discarding ? <div className="banner info">放弃这份未完成草稿？正式账目不会改变。<div className="btn-row"><button className="danger" onClick={() => void onDiscard().catch(e => setError(String(e)))}>确认放弃</button><button onClick={() => setDiscarding(false)}>继续填写</button></div></div> : <button className="text-button danger" disabled={submitting} onClick={() => setDiscarding(true)}>放弃草稿</button>}
    <div className="btn-row form-actions"><button onClick={onClose} disabled={submitting}>取消并保留</button><button className="primary" disabled={!!validation || submitting} onClick={() => void save()}>{submitting ? '正在保存…' : duplicateConfirmed ? '确认另一笔并保存' : '保存记录'}</button></div>
    </fieldset>
  </Sheet>
}

function Choices({ value, values, onChange, optional = false, id }: { id?: string; value?: string; values: string[]; onChange: (value: string) => void; optional?: boolean }) {
  const options = value && !values.includes(value) ? [value, ...values] : values
  return <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">{optional ? '无' : '请选择'}</option>{options.map(v => <option key={v} value={v}>{v}</option>)}</select>
}
