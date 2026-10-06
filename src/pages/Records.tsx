import { useMemo, useState } from 'react'
import { Card, DateInput, Empty, Field, NumberInput, Row, Sheet, StatusBadge, TextInput } from '../components/ui.tsx'
import type { AppData, FxRecord, TransferRecord, WithdrawalRecord } from '../core/types.ts'
import { num, today, uid } from '../core/types.ts'
import { accountsOf, currenciesOf } from '../core/empty.ts'
import { computeFx, computeTransfers, computeWithdrawals, receivedUsdTotal, totalsByCurrency } from '../core/funds.ts'

type Tab = '换汇' | '入金' | '出金'
const TABS: Tab[] = ['换汇', '入金', '出金']

/**
 * 资金页：换汇、入金、出金三张表。
 *
 * 出金是对外汇出资金，只作资金流水留痕，**不计入总览的「到账 USD」**——
 * 那个指标专指真正进入嘉信渠道的美元，出金是资金离场。
 *
 * 账户与币种的选择项来自 settings.accounts / settings.currencies，
 * 可在「更多」页增删改名，不再是写死的清单。
 */
export function RecordsPage({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [tab, setTab] = useState<Tab>('换汇')
  const [editingFx, setEditingFx] = useState<FxRecord | undefined>(undefined)
  const [editingTransfer, setEditingTransfer] = useState<TransferRecord | undefined>(undefined)
  const [editingWithdrawal, setEditingWithdrawal] = useState<WithdrawalRecord | undefined>(undefined)

  const fx = useMemo(() => computeFx(data.fxRecords), [data.fxRecords])
  const transfers = useMemo(() => computeTransfers(data.transfers), [data.transfers])
  const withdrawals = useMemo(() => computeWithdrawals(data.withdrawals), [data.withdrawals])

  const accounts = useMemo(() => accountsOf(data.settings), [data.settings])
  const currencies = useMemo(() => currenciesOf(data.settings), [data.settings])

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const rate = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(4))

  const emptyFx = (): FxRecord => ({
    id: uid(),
    date: today(),
    fromAccount: accounts[0] ?? '',
    fromCurrency: currencies[0] ?? 'RMB',
    amount: 0,
    toAccount: accounts[1] ?? accounts[0] ?? '',
    toCurrency: currencies[1] ?? currencies[0] ?? 'HKD',
    received: 0
  })

  const emptyTransfer = (): TransferRecord => ({
    id: uid(),
    date: today(),
    fromAccount: accounts[1] ?? accounts[0] ?? '',
    currency: currencies[2] ?? currencies[0] ?? 'USD',
    amount: 0,
    toAccount: accounts[3] ?? accounts[0] ?? ''
  })

  const emptyWithdrawal = (): WithdrawalRecord => ({
    id: uid(),
    date: today(),
    fromAccount: accounts[3] ?? accounts[0] ?? '',
    currency: currencies[2] ?? currencies[0] ?? 'USD',
    amount: 0,
    toAccount: accounts[0] ?? ''
  })

  const shared = { accounts, currencies }
  // 出金：对外汇出，按日期倒序展示
  const withdrawalRows = [...withdrawals].reverse()
  // 入金按币种累加，给「汇总」卡片用
  const transferTotals = useMemo(() => totalsByCurrency(transfers), [transfers])

  return (
    <>
      <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
        {TABS.map(t => (
          <button key={t} className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === '换汇' && (
        <>
          <Card title="换汇记录" hint={`${fx.length} 笔`}>
            <p className="note" style={{ marginTop: 0 }}>
              每次换币一行，可多次转账并保留港元。向嘉信渠道换到的美元会自动计入总览的「到账 USD」。
            </p>
          </Card>
          {fx.length === 0 ? (
            <Empty text="还没有换汇记录" />
          ) : (
            <div className="list">
              {[...fx].reverse().map(r => (
                <div className="item" key={r.id}>
                  <div className="main">
                    <div className="title">
                      {r.fromCurrency} → {r.toCurrency}
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="meta">
                      {r.date} · {r.fromAccount} → {r.toAccount}
                      {r.ref ? ` · 流水 ${r.ref}` : ''}
                    </div>
                    <div className="meta">
                      本金 {fmt(r.amount)} {r.fromCurrency} · 实收 {fmt(r.received)} {r.toCurrency} · 汇率{' '}
                      {rate(r.rate)}
                      {r.feeAmount ? ` · 另付 ${fmt(r.feeAmount)} ${r.feeCurrency ?? ''}` : ''}
                    </div>
                    {r.creditedUsd > 0 && <div className="meta">计入嘉信入金 USD {fmt(r.creditedUsd)}</div>}
                    {r.note && <div className="meta">备注：{r.note}</div>}
                  </div>
                  <button className="edit" onClick={() => setEditingFx(r)} aria-label="编辑">
                    ✎
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="btn-row">
            <button className="primary" onClick={() => setEditingFx(emptyFx())}>
              ＋ 记一笔换汇
            </button>
          </div>
        </>
      )}

      {tab === '入金' && (
        <>
          <Card title="入金记录" hint={`${transfers.length} 笔`}>
            <p className="note" style={{ marginTop: 0 }}>
              每次转入一行，两端为同一币种；涉及自动换汇时请另填「换汇」页。允许只转出部分金额。
            </p>
          </Card>
          {transfers.length === 0 ? (
            <Empty text="还没有入金记录" />
          ) : (
            <div className="list">
              {[...transfers].reverse().map(r => (
                <div className="item" key={r.id}>
                  <div className="main">
                    <div className="title">
                      {r.currency} 转入
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="meta">
                      {r.date} · {r.fromAccount} → {r.toAccount}
                      {r.ref ? ` · 流水 ${r.ref}` : ''}
                    </div>
                    <div className="meta">
                      汇出 {fmt(r.amount)} · 到账 {r.received !== undefined ? fmt(r.received) : '待补'}
                      {r.receivedDate ? `（${r.receivedDate}）` : ''}
                      {r.difference !== undefined ? ` · 差额 ${fmt(r.difference)}` : ''}
                    </div>
                    {r.feeAmount ? (
                      <div className="meta">
                        另付 {fmt(r.feeAmount)} {r.feeCurrency ?? ''}
                      </div>
                    ) : null}
                    {r.note && <div className="meta">备注：{r.note}</div>}
                  </div>
                  <button className="edit" onClick={() => setEditingTransfer(r)} aria-label="编辑">
                    ✎
                  </button>
                </div>
              ))}
            </div>
          )}
          <Card title="汇总" hint="按币种累加">
            {transferTotals.length === 0 ? (
              <p className="note" style={{ marginTop: 0 }}>
                还没有可累加的入金。填了金额之后，这里按币种分别累计。
              </p>
            ) : (
              transferTotals.map(t => (
                <Row
                  key={t.currency}
                  label={`累计入金 ${t.currency}`}
                  value={fmt(t.total)}
                  big={transferTotals.length === 1}
                />
              ))
            )}
            <Row label="计入嘉信入金 USD" value={fmt(receivedUsdTotal(fx, transfers))} />
            <p className="note">
              「累计入金」按币种分别累加每笔的汇出本金（<strong>不含另付费用</strong>）——不同币种不能直接加总，
              所以分开列。另付费用单独记在每一笔上，要统计费用把各笔的「另付」相加即可。
              「计入嘉信入金 USD」只算真正进嘉信证券账户的美元到账：换汇里收币为 USD、收币账户是嘉信证券／嘉信入金中转的
              实际到账，加上入金里到账账户为嘉信证券的 USD 转账。中转步骤不重复加总，出金也不算在内。
            </p>
          </Card>
          <div className="btn-row">
            <button className="primary" onClick={() => setEditingTransfer(emptyTransfer())}>
              ＋ 记一笔入金
            </button>
          </div>
        </>
      )}

      {tab === '出金' && (
        <>
          <Card title="出金记录" hint={`${withdrawals.length} 笔`}>
            <p className="note" style={{ marginTop: 0 }}>
              资金从账户对外汇出时记一笔。出金只作资金流水留痕，
              <strong>不计入总览的「到账 USD」</strong>，也不影响持仓成本与已实现盈亏。
            </p>
          </Card>
          {withdrawals.length === 0 ? (
            <Empty text="还没有出金记录" />
          ) : (
            <div className="list">
              {withdrawalRows.map(r => (
                <div className="item" key={r.id}>
                  <div className="main">
                    <div className="title">
                      {r.currency} 转出
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="meta">
                      {r.date} · {r.fromAccount} → {r.toAccount}
                      {r.ref ? ` · 流水 ${r.ref}` : ''}
                    </div>
                    <div className="meta">
                      汇出 {fmt(r.amount)} · 到账 {r.received !== undefined ? fmt(r.received) : '待补'}
                      {r.receivedDate ? `（${r.receivedDate}）` : ''}
                      {r.difference !== undefined ? ` · 差额 ${fmt(r.difference)}` : ''}
                    </div>
                    {r.feeAmount ? (
                      <div className="meta">
                        另付 {fmt(r.feeAmount)} {r.feeCurrency ?? ''}
                      </div>
                    ) : null}
                    {r.note && <div className="meta">备注：{r.note}</div>}
                  </div>
                  <button className="edit" onClick={() => setEditingWithdrawal(r)} aria-label="编辑">
                    ✎
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="btn-row">
            <button className="primary" onClick={() => setEditingWithdrawal(emptyWithdrawal())}>
              ＋ 记一笔出金
            </button>
          </div>
        </>
      )}

      {editingFx && (
        <FxSheet
          record={editingFx}
          {...shared}
          isNew={!data.fxRecords.some(x => x.id === editingFx.id)}
          onClose={() => setEditingFx(undefined)}
          onSave={r => {
            update(c => ({
              ...c,
              fxRecords: c.fxRecords.some(x => x.id === r.id)
                ? c.fxRecords.map(x => (x.id === r.id ? r : x))
                : [...c.fxRecords, r]
            }))
            setEditingFx(undefined)
          }}
          onDelete={() => {
            update(c => ({ ...c, fxRecords: c.fxRecords.filter(x => x.id !== editingFx.id) }))
            setEditingFx(undefined)
          }}
        />
      )}

      {editingTransfer && (
        <TransferSheet
          record={editingTransfer}
          {...shared}
          isNew={!data.transfers.some(x => x.id === editingTransfer.id)}
          onClose={() => setEditingTransfer(undefined)}
          onSave={r => {
            update(c => ({
              ...c,
              transfers: c.transfers.some(x => x.id === r.id)
                ? c.transfers.map(x => (x.id === r.id ? r : x))
                : [...c.transfers, r]
            }))
            setEditingTransfer(undefined)
          }}
          onDelete={() => {
            update(c => ({ ...c, transfers: c.transfers.filter(x => x.id !== editingTransfer.id) }))
            setEditingTransfer(undefined)
          }}
        />
      )}

      {editingWithdrawal && (
        <TransferSheet
          mode="withdrawal"
          record={editingWithdrawal}
          {...shared}
          isNew={!data.withdrawals.some(x => x.id === editingWithdrawal.id)}
          onClose={() => setEditingWithdrawal(undefined)}
          onSave={r => {
            update(c => ({
              ...c,
              withdrawals: c.withdrawals.some(x => x.id === r.id)
                ? c.withdrawals.map(x => (x.id === r.id ? r : x))
                : [...c.withdrawals, r]
            }))
            setEditingWithdrawal(undefined)
          }}
          onDelete={() => {
            update(c => ({ ...c, withdrawals: c.withdrawals.filter(x => x.id !== editingWithdrawal.id) }))
            setEditingWithdrawal(undefined)
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// 账户 / 币种下拉
// ---------------------------------------------------------------------------

function AccountSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {options.map(a => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
      {/* 历史记录里的账户名可能已被改名或删除，保留原值避免静默改写数据 */}
      {value && !options.includes(value) && <option value={value}>{value}（已不在清单）</option>}
    </select>
  )
}

function CurrencySelect({
  value,
  options,
  onChange,
  allowEmpty
}: {
  value: string | undefined
  options: string[]
  onChange: (v: string | undefined) => void
  allowEmpty?: boolean
}) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}>
      {allowEmpty && <option value="">（未填）</option>}
      {options.map(c => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {value && !options.includes(value) && <option value={value}>{value}（已不在清单）</option>}
    </select>
  )
}

// ---------------------------------------------------------------------------
// 编辑面板
// ---------------------------------------------------------------------------

function FxSheet({
  record,
  accounts,
  currencies,
  onClose,
  onSave,
  onDelete,
  isNew
}: {
  record: FxRecord
  accounts: string[]
  currencies: string[]
  onClose: () => void
  onSave: (r: FxRecord) => void
  onDelete: () => void
  isNew: boolean
}) {
  const [form, setForm] = useState<FxRecord>({ ...record })
  const set = (patch: Partial<FxRecord>) => setForm(f => ({ ...f, ...patch }))

  return (
    <Sheet title={isNew ? '记一笔换汇' : '编辑换汇'} onClose={onClose}>
      <div className="grid2">
        <Field label="换汇日期">
          <DateInput value={form.date} onChange={v => set({ date: v ?? '' })} />
        </Field>
        <Field label="流水／关联编号">
          <TextInput value={form.ref} onChange={v => set({ ref: v || undefined })} placeholder="选填" />
        </Field>
      </div>

      <div className="grid2">
        <Field label="付币账户">
          <AccountSelect value={form.fromAccount} options={accounts} onChange={v => set({ fromAccount: v })} />
        </Field>
        <Field label="付出币种">
          <CurrencySelect
            value={form.fromCurrency}
            options={currencies}
            onChange={v => set({ fromCurrency: v ?? '' })}
          />
        </Field>
      </div>

      <Field label="换汇本金（不含另付费用）">
        <NumberInput value={form.amount} onChange={v => set({ amount: v ?? 0 })} />
      </Field>

      <div className="grid2">
        <Field label="收币账户">
          <AccountSelect value={form.toAccount} options={accounts} onChange={v => set({ toAccount: v })} />
        </Field>
        <Field label="收到币种">
          <CurrencySelect value={form.toCurrency} options={currencies} onChange={v => set({ toCurrency: v ?? '' })} />
        </Field>
      </div>

      <Field label="实际收到金额">
        <NumberInput value={form.received} onChange={v => set({ received: v ?? 0 })} />
      </Field>

      <div className="grid2">
        <Field label="另付费币种">
          <CurrencySelect value={form.feeCurrency} options={currencies} onChange={v => set({ feeCurrency: v })} allowEmpty />
        </Field>
        <Field label="另付费用">
          <NumberInput value={form.feeAmount} onChange={v => set({ feeAmount: v })} />
        </Field>
      </div>

      <Field label="备注">
        <TextInput value={form.note} onChange={v => set({ note: v || undefined })} />
      </Field>

      <div className="btn-row">
        <button
          className="primary"
          onClick={() => onSave({ ...form, amount: num(form.amount, 0), received: num(form.received, 0) })}
        >
          保存
        </button>
        <button onClick={onClose}>取消</button>
        {!isNew && (
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </Sheet>
  )
}

/**
 * 入金与出金共用同一个表单：字段结构完全一致，只有措辞与归属的数组不同。
 * `mode` 决定标题、按钮文案和写入哪张表（由调用方的 onSave 负责）。
 */
function TransferSheet({
  mode = 'transfer',
  record,
  accounts,
  currencies,
  onClose,
  onSave,
  onDelete,
  isNew
}: {
  mode?: 'transfer' | 'withdrawal'
  record: TransferRecord | WithdrawalRecord
  accounts: string[]
  currencies: string[]
  onClose: () => void
  onSave: (r: TransferRecord & WithdrawalRecord) => void
  onDelete: () => void
  isNew: boolean
}) {
  const [form, setForm] = useState<TransferRecord | WithdrawalRecord>({ ...record })
  const set = (patch: Partial<TransferRecord>) => setForm(f => ({ ...f, ...patch }) as TransferRecord)
  const out = mode === 'withdrawal'
  const label = out ? '出金' : '入金'

  return (
    <Sheet title={isNew ? `记一笔${label}` : `编辑${label}`} onClose={onClose}>
      <div className="grid2">
        <Field label="汇出日期">
          <DateInput value={form.date} onChange={v => set({ date: v ?? '' })} />
        </Field>
        <Field label="流水／关联编号">
          <TextInput value={form.ref} onChange={v => set({ ref: v || undefined })} placeholder="选填" />
        </Field>
      </div>

      <div className="grid2">
        <Field label="汇出账户">
          <AccountSelect value={form.fromAccount} options={accounts} onChange={v => set({ fromAccount: v })} />
        </Field>
        <Field label="币种">
          <CurrencySelect value={form.currency} options={currencies} onChange={v => set({ currency: v ?? '' })} />
        </Field>
      </div>

      <Field label="汇出本金（不含另付费用）">
        <NumberInput value={form.amount} onChange={v => set({ amount: v ?? 0 })} />
      </Field>

      <Field label={out ? '收款账户／去向' : '收款账户'} sub={out ? '可以填银行名、也可以写「外部账户」。' : undefined}>
        <AccountSelect value={form.toAccount} options={accounts} onChange={v => set({ toAccount: v })} />
      </Field>

      <div className="grid2">
        <Field label="实际到账本金" sub="未到账就留空，状态会显示「在途」。">
          <NumberInput value={form.received} onChange={v => set({ received: v })} />
        </Field>
        <Field label="到账日期">
          <DateInput value={form.receivedDate} onChange={v => set({ receivedDate: v })} />
        </Field>
      </div>

      <div className="grid2">
        <Field label="另付费币种">
          <CurrencySelect value={form.feeCurrency} options={currencies} onChange={v => set({ feeCurrency: v })} allowEmpty />
        </Field>
        <Field label="另付费用">
          <NumberInput value={form.feeAmount} onChange={v => set({ feeAmount: v })} />
        </Field>
      </div>

      <Field label="备注">
        <TextInput value={form.note} onChange={v => set({ note: v || undefined })} />
      </Field>

      <div className="btn-row">
        <button
          className="primary"
          onClick={() => onSave({ ...form, amount: num(form.amount, 0) } as TransferRecord & WithdrawalRecord)}
        >
          保存
        </button>
        <button onClick={onClose}>取消</button>
        {!isNew && (
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </Sheet>
  )
}
