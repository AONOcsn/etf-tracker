import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Purpose, Side } from '../core/types.ts'
import { numericToText, parseNumericInput, sanitizeNumericInput } from '../core/numeric.ts'

/**
 * 通用展示组件。
 *
 * 刻意不用表格：手机上横向滚动的宽表格很难用，所以一律用「卡片 + 键值行」，
 * 每张记录卡片点开进入编辑表单。原来 Excel 里的列名在这里变成行标签。
 */

export function Card({ title, hint, children, footer }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card">
      {title !== undefined && (
        <h2>
          <span>{title}</span>
          {hint !== undefined && <span className="hint">{hint}</span>}
        </h2>
      )}
      {children}
      {footer}
    </section>
  )
}

export function Row({ label, value, big, tone }: { label: ReactNode; value: ReactNode; big?: boolean; tone?: 'pos' | 'neg' }) {
  return (
    <div className={big ? 'row big' : 'row'}>
      <span className="k">{label}</span>
      <span className={tone ? `v ${tone}` : 'v'}>{value}</span>
    </div>
  )
}

export function Field({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  )
}

/**
 * 数字输入：用文本框 + 小数键盘，而不是 `type="number"`。
 *
 * 两个必须避开的坑：
 * 1. `type="number"` 受 step 约束（默认 step=1），浏览器会把 0.01 这类值判为
 *    非法输入，某些情况下直接吞掉或拒绝提交。
 * 2. 受控值只存 number 时，`0.` / `1.` 这类中间态会被转成 NaN 再被清空，
 *    用户感觉「刚敲进去就被擦掉了」。
 *
 * 所以这里把「正在输入的原文」存在本地 state，只在能解析成数字时向上报。
 * 取值规则见 core/numeric.ts（那边有单测罩着）。
 */
export function NumberInput({
  value,
  onChange,
  placeholder
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  placeholder?: string
}) {
  const [text, setText] = useState(() => numericToText(value))
  // 自己发出的值不必再回流覆盖，否则会把用户敲到一半的文本抹掉
  const echo = useRef<number | undefined>(value)

  useEffect(() => {
    // 只有外部真的改了值（如「更新行情」回填）才覆盖输入框
    if (value !== echo.current) {
      echo.current = value
      setText(numericToText(value))
    }
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      onBlur={() => {
        // 失焦时把 "1." 收敛成 "1"，避免留下不能提交的半截数字
        const { value: parsed } = parseNumericInput(text)
        setText(numericToText(parsed))
        echo.current = parsed
        onChange(parsed)
      }}
      onChange={e => {
        const cleaned = sanitizeNumericInput(e.target.value)
        if (cleaned === undefined) return
        setText(cleaned)
        const { ready, value: parsed } = parseNumericInput(cleaned)
        if (!ready) return
        echo.current = parsed
        onChange(parsed)
      }}
    />
  )
}

export function TextInput({ value, onChange, placeholder }: { value: string | undefined; onChange: (value: string) => void; placeholder?: string }) {
  return <input type="text" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

export function DateInput({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  return <input type="date" value={value ?? ''} onChange={e => onChange(e.target.value || undefined)} />
}

export function Select<T extends string>({
  value,
  options,
  onChange
}: {
  value: T | undefined
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value as T)}>
      {options.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/**
 * 状态徽标。
 * 「已记录」「已计算」「已完整划转」这类正常状态用绿底；
 * 待补、在途这类中间态用灰／黄；需要核对的错误用红。
 */
export function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null
  const kind = statusKind(status)
  return <span className={`badge${kind === 'ok' ? '' : ` ${kind}`}`}>{status}</span>
}

function statusKind(status: string): 'ok' | 'warn' | 'bad' | 'plain' {
  if (/核对|请检查|超|负/.test(status)) return 'bad'
  if (/待补|在途|尚未|差额|尚未记录/.test(status)) return 'warn'
  if (/已记录|已计算|已完整划转|已按计划/.test(status)) return 'ok'
  return 'plain'
}

/** 底部弹出的编辑面板。 */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function ConfirmBar({ message, onConfirm, onCancel, confirmText }: { message: ReactNode; onConfirm: () => void; onCancel: () => void; confirmText?: string }) {
  return (
    <div className="banner info">
      {message}
      <div className="btn-row">
        <button className="primary" onClick={onConfirm}>
          {confirmText ?? '确认'}
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="center">{text}</div>
}

/**
 * 记录页顶部的常驻操作栏。
 *
 * 记录多了之后，把「记一笔」放在列表末尾要滑很久才能点到，所以固定在顶部。
 * 用 sticky（样式见 styles.css 的 .page-bar）而不是 fixed，避免遮挡内容。
 *
 * @param count   记录条数文案，放在按钮上方一行
 * @param actions 操作按钮，通常是「＋ 记一笔 XXX」
 * @param below   操作栏内、按钮下方的附加内容（资金页的三个子标签）
 */
export function PageBar({
  count,
  actions,
  below
}: {
  count?: ReactNode
  actions: ReactNode
  below?: ReactNode
}) {
  return (
    <div className="page-bar">
      {count !== undefined && <div className="count">{count}</div>}
      <div className="actions">{actions}</div>
      {below}
    </div>
  )
}

export const SIDE_OPTIONS: readonly Side[] = ['buy', 'sell']
export const PURPOSE_OPTIONS: readonly Purpose[] = ['定投', '分红再投', '其他']

export function sideText(side: Side | undefined): string {
  return side === 'buy' ? '买入' : side === 'sell' ? '卖出' : '—'
}
