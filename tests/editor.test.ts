import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformWithOxc } from 'vite'
import * as ledger from '../src/core/ledger.ts'
import * as empty from '../src/core/empty.ts'

type Node = { type: string; props: Record<string, unknown> }
function find(node: unknown, match: (n: Node) => boolean): Node | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) { for (const item of node) { const hit = find(item, match); if (hit) return hit } return undefined }
  const n = node as Node
  return match(n) ? n : find(n.props?.children, match)
}

test('延迟保存期间整个表单禁止编辑，也不再写入新草稿', async () => {
  const source = readFileSync(new URL('../src/components/RecordEditor.tsx', import.meta.url), 'utf8')
  const transformed = await transformWithOxc(source, 'RecordEditor.tsx')
  const code = transformed.code.replace(/import \{([^}]+)\} from ["']([^"']+)["'];?/g, (_m, names: string, path: string) => `const {${names.replace(/\bas\b/g, ':')}} = require('${path}');`)
    .replace('export function RecordEditor', 'exports.RecordEditor = function RecordEditor')
  const state: unknown[] = []
  let cursor = 0
  let resolveSave: () => void = () => undefined
  const delayed = new Promise<void>(resolve => { resolveSave = resolve })
  const drafts: unknown[] = []
  const exported: Record<string, (props: unknown) => Node> = {}
  runInNewContext(code, { exports: exported, require: (name: string) => {
    if (name === 'react') return { useState: (initial: unknown) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (next: unknown) => { state[i] = next }] } }
    if (name === 'react/jsx-runtime') return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) }
    if (name.includes('ledger')) return ledger
    if (name.includes('empty')) return empty
    return { Field: 'Field', NumberInput: 'NumberInput', DateInput: 'DateInput', TextInput: 'TextInput', Sheet: 'Sheet', Row: 'Row' }
  } })
  const props = { data: empty.emptyData(), kind: 'buy', initial: { id: 'a', date: '2026-10-01', symbol: 'VOO', amount: 100, shares: 1, fee: 0 }, draftSaving: false,
    onDraft: (form: unknown) => drafts.push(form), onSave: () => delayed, onClose: () => undefined, onDiscard: async () => undefined }
  const render = () => { cursor = 0; return exported.RecordEditor(props) }
  const first = render()
  const save = find(first, n => n.type === 'button' && n.props.children === '保存记录')!
  ;(save.props.onClick as () => void)()
  const saving = render()
  assert.equal(find(saving, n => n.type === 'fieldset')?.props.disabled, true)
  const amount = find(saving, n => n.type === 'NumberInput' && n.props.value === 100)!
  ;(amount.props.onChange as (value: number) => void)(200)
  assert.equal(drafts.length, 0)
  resolveSave()
  await delayed
})
