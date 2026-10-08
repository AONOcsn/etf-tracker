import { useMemo, useState } from 'react'
import { Card, DateInput, Empty, Field, NumberInput, PageBar, Sheet, TextInput } from '../components/ui.tsx'
import type { AppData, DividendRecord } from '../core/types.ts'
import { num, today, uid } from '../core/types.ts'
import { computeDividends, netDividendsTotal } from '../core/funds.ts'

/**
 * 分红页：等价于原表「分红记录」。
 *
 * 税后分红自动算（税前 − 预扣税 − 其他费用）。
 * 分红再投资时，除了这里记一笔，还要到「交易」页记一笔买入并把用途选为「分红再投」，
 * 否则回撤计划会把再投资误当成定投而多扣预算。
 */
export function DividendsPage({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [editing, setEditing] = useState<DividendRecord | undefined>(undefined)
  const rows = useMemo(() => computeDividends(data.dividends), [data.dividends])
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function blank(): DividendRecord {
    return { id: uid(), date: today(), symbol: data.etfs[0]?.symbol ?? 'VOO', gross: 0, tax: 0 }
  }

  return (
    <>
      {/* 常驻顶部：记录一多就不用滑到列表末尾去找按钮 */}
      <PageBar
        count={`共 ${rows.length} 笔分红 · 税后合计 ${fmt(netDividendsTotal(rows))} USD`}
        actions={
          <button className="primary" onClick={() => setEditing(blank())}>
            ＋ 记一笔分红
          </button>
        }
      />

      <Card title="分红记录" hint={`${rows.length} 笔`}>
        <p className="note" style={{ marginTop: 0 }}>
          每次分红一行。税前、预扣税、其他费用按券商流水填写，税后自动计算。
        </p>
      </Card>

      {rows.length === 0 ? (
        <Empty text="还没有分红记录" />
      ) : (
        <div className="list">
          {[...rows].reverse().map(r => (
            <div className="item" key={r.id}>
              <div className="main">
                <div className="title">{r.symbol || '未选 ETF'}</div>
                <div className="meta">
                  {r.date} · 税前 {fmt(r.gross)} · 预扣税 {fmt(r.tax)}
                  {r.fee ? ` · 其他费用 ${fmt(r.fee)}` : ''}
                </div>
                {r.note && <div className="meta">备注：{r.note}</div>}
              </div>
              <div className="amount">
                <div className={r.net < 0 ? 'neg' : ''}>{fmt(r.net)}</div>
                <button className="edit" onClick={() => setEditing(r)} aria-label="编辑">
                  ✎
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="合计">
        <div className="row">
          <span className="k">税后分红 USD</span>
          <span className="v">{fmt(netDividendsTotal(rows))}</span>
        </div>
      </Card>

      {editing && (
        <Sheet title="分红" onClose={() => setEditing(undefined)}>
          <DividendForm
            record={editing}
            symbols={data.etfs.map(e => e.symbol)}
            onClose={() => setEditing(undefined)}
            onSave={r => {
              update(c => ({
                ...c,
                dividends: c.dividends.some(x => x.id === r.id)
                  ? c.dividends.map(x => (x.id === r.id ? r : x))
                  : [...c.dividends, r]
              }))
              setEditing(undefined)
            }}
            onDelete={() => {
              update(c => ({ ...c, dividends: c.dividends.filter(x => x.id !== editing.id) }))
              setEditing(undefined)
            }}
            isNew={!data.dividends.some(x => x.id === editing.id)}
          />
        </Sheet>
      )}
    </>
  )
}

function DividendForm({
  record,
  symbols,
  onClose,
  onSave,
  onDelete,
  isNew
}: {
  record: DividendRecord
  symbols: string[]
  onClose: () => void
  onSave: (r: DividendRecord) => void
  onDelete: () => void
  isNew: boolean
}) {
  const [form, setForm] = useState<DividendRecord>({ ...record })
  const set = (patch: Partial<DividendRecord>) => setForm(f => ({ ...f, ...patch }))
  const net = num(form.gross, 0) - num(form.tax, 0) - num(form.fee, 0)

  return (
    <>
      <Field label="到账日期">
        <DateInput value={form.date} onChange={v => set({ date: v ?? '' })} />
      </Field>
      <Field label="ETF">
        <select value={form.symbol} onChange={e => set({ symbol: e.target.value })}>
          {symbols.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid3">
        <Field label="税前 USD">
          <NumberInput value={form.gross} onChange={v => set({ gross: v ?? 0 })} />
        </Field>
        <Field label="预扣税 USD">
          <NumberInput value={form.tax} onChange={v => set({ tax: v ?? 0 })} />
        </Field>
        <Field label="其他费用 USD">
          <NumberInput value={form.fee} onChange={v => set({ fee: v })} />
        </Field>
      </div>
      <Field label="备注">
        <TextInput value={form.note} onChange={v => set({ note: v || undefined })} />
      </Field>

      <div className={`banner ${net < 0 ? 'err' : 'ok'}`}>税后分红：{net.toFixed(2)} USD</div>

      <div className="btn-row">
        <button className="primary" onClick={() => onSave(form)}>
          保存
        </button>
        <button onClick={onClose}>取消</button>
        {!isNew && (
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </>
  )
}
