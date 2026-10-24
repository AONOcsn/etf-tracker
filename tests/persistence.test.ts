import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { emptyData, normalizeData } from '../src/core/empty.ts'
import { validateBackup } from '../src/core/backup.ts'

test('删除保存失败后，已排队保存仍携带操作前账本', async () => {
  const data = emptyData()
  data.trades.push({ id: 'a', date: '2026-10-01', symbol: 'VOO', side: 'buy', amount: 100, fee: 0, shares: 1 })
  const calls: { data: typeof data; recovery?: { data: typeof data } }[] = []
  let rejectFirst: (error: Error) => void = () => undefined
  const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
  const effects: (() => void)[] = []
  const source = readFileSync(new URL('../src/state/useAppData.ts', import.meta.url), 'utf8')
  const js = stripTypeScriptTypes(source)
    .replace(/^import .*? from '([^']+)'$/gm, (_line, name: string) => {
      if (name === 'react') return "const { useCallback, useEffect, useRef, useState } = require('react')"
      if (name.includes('empty')) return `const { emptyData, normalizeData } = require('${name}')`
      if (name.includes('backup')) return `const { validateBackup } = require('${name}')`
      return `const { listSnapshots, loadData, restoreSnapshot, saveData } = require('${name}')`
    }).replace('export function useAppData', 'exports.useAppData = function useAppData')
  const exported: Record<string, () => {
    update: (mutate: (d: typeof data) => typeof data) => void
    flush: () => Promise<void>
  }> = {}
  runInNewContext(js, { exports: exported, setTimeout, clearTimeout, require: (name: string) => {
    if (name === 'react') return {
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => undefined],
      useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => void) => effects.push(fn)
    }
    if (name.includes('empty')) return { emptyData, normalizeData }
    if (name.includes('backup')) return { validateBackup }
    return {
      loadData: async () => data,
      listSnapshots: async () => [],
      saveData: async (next: typeof data, recovery?: { data: typeof data }) => {
        calls.push({ data: next, recovery })
        if (calls.length === 1) await first
      }
    }
  } })
  const app = exported.useAppData()
  effects.forEach(effect => effect())
  await new Promise(resolve => setTimeout(resolve, 0))
  app.update(current => ({ ...current, trades: [] }))
  const one = app.flush().catch(() => undefined)
  const two = app.flush()
  rejectFirst(new Error('测试保存失败'))
  await Promise.all([one, two])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].recovery?.data.trades.length, 1)
  assert.equal(calls[1].recovery?.data.trades.length, 1)
})
