import { useRef, useState } from 'react'
import { Card, Field, NumberInput, Row, TextInput } from '../components/ui.tsx'
import type { AppData, EtfSetting } from '../core/types.ts'
import { validateBackup } from '../core/backup.ts'
import { accountsOf, currenciesOf } from '../core/empty.ts'
import { toCsvWithBom, money, shares as fmtShares } from '../core/csv.ts'
import { InvestmentSettings } from '../components/InvestmentSettings.tsx'
import { Icon } from '../components/Icon.tsx'
import { QUOTE_SYMBOL } from '../core/quotes.ts'

declare const __BUILD_STAMP__: string

/**
 * 「设置」页：设置、行情、备份、问题排查与使用说明。
 *
 * 集中放在这里而不是散进各页，是为了让日常录入的三页保持干净。
 */
export function MorePage({
  data,
  update,
  importData,
  snapshots,
  rollback,
  resetAll,
  refreshQuotes,
  quoting,
  quoteMessage,
  initialSection
}: {
  initialSection?: string
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  importData: (incoming: unknown) => Promise<AppData>
  snapshots: { label: string; at: string }[]
  rollback: (label: string) => Promise<boolean>
  resetAll: () => Promise<void>
  refreshQuotes: () => Promise<void>
  quoting: boolean
  quoteMessage: { kind: 'ok' | 'err'; text: string } | undefined
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmImport, setConfirmImport] = useState<AppData | undefined>(undefined)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState<string>()
  const [newSymbol, setNewSymbol] = useState('')
  const [importMessage, setImportMessage] = useState<string | undefined>(undefined)

  const [section, setSection] = useState(initialSection ?? 'main')

  function patchEtf(symbol: string, patch: Partial<EtfSetting>) {
    update(c => ({ ...c, etfs: c.etfs.map(e => (e.symbol === symbol ? { ...e, ...patch } : e)) }))
  }

  function removeEtf(symbol: string) {
    if (data.trades.some(t => t.symbol === symbol) || data.dividends.some(d => d.symbol === symbol) || (data.etfs.find(e => e.symbol === symbol)?.cash ?? 0) !== 0) {
      setImportMessage(`${symbol} 仍有关联记录或现金，请保留它以免遗漏资产。`)
      return
    }
    update(c => ({ ...c, etfs: c.etfs.filter(e => e.symbol !== symbol) }))
  }

  function addEtf() {
    const symbol = newSymbol.trim().toUpperCase()
    if (!symbol || data.etfs.some(e => e.symbol === symbol)) return
    update(c => ({ ...c, etfs: [...c.etfs, { symbol, targetRatio: 0, planned: false, price: 0 }] }))
    setNewSymbol('')
  }

  /** 导出文本文件。用 Blob + a[download]，iOS Safari 会走「存储到文件」。 */
  function download(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 立刻 revoke 在部分 Safari 版本上会打断下载，延后释放
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const stamp = new Date().toISOString().slice(0, 10)

  function exportJson() {
    // 快照不导出：它是本机备份机制，跟着文件走会把文件体积翻好几倍
    const { snapshots: _ignored, ...rest } = data
    void _ignored
    download(`etf-tracker-${stamp}.json`, JSON.stringify(rest, null, 2), 'application/json')
  }

  function exportCsv(name: string, rows: unknown[], columns: { header: string; value: (row: unknown) => string | number | undefined | null }[]) {
    download(`etf-${name}-${stamp}.csv`, toCsvWithBom(rows, columns), 'text/csv;charset=utf-8')
  }

  async function handleFile(file: File) {
    setImportMessage(undefined)
    try {
      const text = await file.text()
      setConfirmImport(validateBackup(JSON.parse(text)))
    } catch (error) {
      setConfirmImport(undefined)
      setImportMessage(error instanceof SyntaxError ? '这个文件不是合法的 JSON 备份。' : error instanceof Error ? error.message : String(error))
    }
  }

  const sections = [
    { key: 'strategy', title: '投资参数', sub: '月投金额、回撤预算与投入比例' },
    { key: 'symbols', title: '标的管理', sub: '持仓目标、价格与标的清单' },
    { key: 'accounts', title: '账户与币种', sub: '管理资金划转的常用选项' },
    { key: 'data', title: '数据与备份', sub: '导出、恢复点与本机数据' },
    { key: 'help', title: '帮助', sub: '操作说明与计算口径' }
  ]
  if (section === 'main') return <>
    <div className="settings-group">{sections.map(item => <button key={item.key} className="setting-link" onClick={() => setSection(item.key)}><span><strong>{item.title}</strong><small>{item.sub}</small></span><Icon name="chevron" /></button>)}</div>
    <p className="privacy-note">账本保存在这台设备上。换机或清理网站数据前，请先导出 JSON 备份。</p>
    <p className="build-note">版本 {__BUILD_STAMP__}</p>
  </>
  return <>
    <button className="text-button back-button" onClick={() => setSection('main')}>‹ 返回设置</button>
    {section === 'strategy' && <InvestmentSettings data={data} update={update} />}
    {section === 'data' && <>
      <Card title="备份与恢复">
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button onClick={exportJson}>导出 JSON 备份</button>
          <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />

        <div className="section-title">导出 CSV（给 Excel 用）</div>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button
            onClick={() =>
              exportCsv(
                '交易',
                data.trades,
                [
                  { header: '成交日期', value: r => (r as { date: string }).date },
                  { header: 'ETF', value: r => (r as { symbol: string }).symbol },
                  { header: '方向', value: r => ((r as { side: string }).side === 'buy' ? '买入' : '卖出') },
                  { header: '成交金额 USD', value: r => money((r as { amount: number }).amount) },
                  { header: '手续费 USD', value: r => money((r as { fee: number }).fee) },
                  { header: '成交份额', value: r => fmtShares((r as { shares: number }).shares) },
                  { header: '买入用途', value: r => (r as { purpose?: string }).purpose ?? '定投' },
                  { header: '备注', value: r => (r as { note?: string }).note ?? '' }
                ]
              )
            }
          >
            交易
          </button>
          <button
            onClick={() =>
              exportCsv(
                '换汇',
                data.fxRecords,
                [
                  { header: '换汇日期', value: r => (r as { date: string }).date },
                  { header: '流水', value: r => (r as { ref?: string | number }).ref ?? '' },
                  { header: '付币账户', value: r => (r as { fromAccount: string }).fromAccount },
                  { header: '付出币种', value: r => (r as { fromCurrency: string }).fromCurrency },
                  { header: '换汇本金', value: r => money((r as { amount: number }).amount) },
                  { header: '收币账户', value: r => (r as { toAccount: string }).toAccount },
                  { header: '收到币种', value: r => (r as { toCurrency: string }).toCurrency },
                  { header: '实际收到', value: r => money((r as { received: number }).received) },
                  { header: '另付费用', value: r => money((r as { feeAmount?: number }).feeAmount) },
                  { header: '备注', value: r => (r as { note?: string }).note ?? '' }
                ]
              )
            }
          >
            换汇
          </button>
          <button
            onClick={() =>
              exportCsv(
                '入金',
                data.transfers,
                [
                  { header: '汇出日期', value: r => (r as { date: string }).date },
                  { header: '流水', value: r => (r as { ref?: string | number }).ref ?? '' },
                  { header: '汇出账户', value: r => (r as { fromAccount: string }).fromAccount },
                  { header: '币种', value: r => (r as { currency: string }).currency },
                  { header: '汇出本金', value: r => money((r as { amount: number }).amount) },
                  { header: '收款账户', value: r => (r as { toAccount: string }).toAccount },
                  { header: '实际到账', value: r => money((r as { received?: number }).received) },
                  { header: '到账日期', value: r => (r as { receivedDate?: string }).receivedDate ?? '' },
                  { header: '备注', value: r => (r as { note?: string }).note ?? '' }
                ]
              )
            }
          >
            入金
          </button>
          <button
            onClick={() =>
              exportCsv(
                '出金',
                data.withdrawals,
                [
                  { header: '汇出日期', value: r => (r as { date: string }).date },
                  { header: '流水', value: r => (r as { ref?: string | number }).ref ?? '' },
                  { header: '汇出账户', value: r => (r as { fromAccount: string }).fromAccount },
                  { header: '币种', value: r => (r as { currency: string }).currency },
                  { header: '汇出本金', value: r => money((r as { amount: number }).amount) },
                  { header: '收款账户', value: r => (r as { toAccount: string }).toAccount },
                  { header: '实际到账', value: r => money((r as { received?: number }).received) },
                  { header: '到账日期', value: r => (r as { receivedDate?: string }).receivedDate ?? '' },
                  { header: '备注', value: r => (r as { note?: string }).note ?? '' }
                ]
              )
            }
          >
            出金
          </button>
          <button
            onClick={() =>
              exportCsv(
                '分红',
                data.dividends,
                [
                  { header: '到账日期', value: r => (r as { date: string }).date },
                  { header: 'ETF', value: r => (r as { symbol: string }).symbol },
                  { header: '税前分红', value: r => money((r as { gross: number }).gross) },
                  { header: '预扣税', value: r => money((r as { tax: number }).tax) },
                  { header: '其他费用', value: r => money((r as { fee?: number }).fee) },
                  { header: '备注', value: r => (r as { note?: string }).note ?? '' }
                ]
              )
            }
          >
            分红
          </button>
        </div>

        {importMessage && <div className={`banner ${/完成/.test(importMessage) ? 'ok' : 'err'}`} role="status">{importMessage}</div>}
        {confirmImport !== undefined && (
          <div className="banner info">
            即将导入：{confirmImport.trades.length} 笔成交、{confirmImport.fxRecords.length} 笔换汇、{confirmImport.transfers.length} 笔入金、{confirmImport.withdrawals.length} 笔出金、{confirmImport.dividends.length} 笔分红。<br /><strong>将覆盖本机现有账本</strong>，覆盖前会保留独立恢复点。
            <div className="btn-row">
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await importData(confirmImport)
                    setConfirmImport(undefined)
                    setImportMessage('导入完成，原账本已保留为操作前恢复点。')
                  } catch (error) {
                    setImportMessage(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                确认覆盖
              </button>
              <button onClick={() => setConfirmImport(undefined)}>取消</button>
            </div>
          </div>
        )}

        {confirmRollback && <div className="banner info">
          回滚到所选恢复记录？当前账本会先保留为新的恢复点。
          <div className="btn-row"><button className="primary" onClick={async () => {
            try { await rollback(confirmRollback); setConfirmRollback(undefined); setImportMessage('回滚完成，回滚前账本已保留。') }
            catch (error) { setImportMessage(error instanceof Error ? error.message : String(error)) }
          }}>确认回滚</button><button onClick={() => setConfirmRollback(undefined)}>取消</button></div>
        </div>}
        {snapshots.length > 0 && (
          <>
            <div className="section-title">本机恢复记录（{snapshots.length} 份）</div>
            <div className="list">
              {[...snapshots].reverse().map(s => (
                <div className="item" key={s.label}>
                  <div className="main">
                    <div className="title">{s.label.startsWith('auto-') ? '每日快照' : s.label.split('-').slice(0, 2).join(' · ')}</div>
                    <div className="meta">{new Date(s.at).toLocaleString('zh-CN', { hour12: false })}</div>
                  </div>
                  <button
                    className="ghost"
                    style={{ padding: '2px 10px', fontSize: 14 }}
                    onClick={() => setConfirmRollback(s.label)}
                  >
                    回滚
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="note">
          数据只存在这台设备的浏览器里，<strong>不会随 GitHub 仓库同步</strong>。换手机或清理浏览器数据之前，务必先导出 JSON 备份。
        </p>
      </Card>

      <Card title="关于">
        <Row label="构建版本" value={<span className="mono">{__BUILD_STAMP__}</span>} />
        <Row
          label="数据条数"
          value={`交易 ${data.trades.length} · 换汇 ${data.fxRecords.length} · 入金 ${data.transfers.length} · 出金 ${data.withdrawals.length} · 分红 ${data.dividends.length}`}
        />
        <p className="note">
          如果手机上看起来还是旧版本，用 Safari（不是主屏幕图标）打开站点停留几秒，让它完成更新后再重新打开。
          设置页这里的「构建版本」时间戳没变，就说明仍在用缓存的旧版本。
        </p>
        <div className="btn-row">
          <button
            className="danger"
            onClick={() => {
              setConfirmReset(true)
            }}
          >
            清空本机数据
          </button>
        </div>
        {confirmReset && (
          <div className="banner err">
            会清空当前账本，操作前会保留一份恢复点。建议先导出 JSON 到「文件」保存。
            <div className="btn-row">
              <button
                className="primary"
                onClick={async () => {
                  try { await resetAll(); setConfirmReset(false) }
                  catch (error) { setImportMessage(error instanceof Error ? error.message : String(error)) }
                }}
              >
                确认清空
              </button>
              <button onClick={() => setConfirmReset(false)}>取消</button>
            </div>
          </div>
        )}
      </Card>
    </>}
    {section === 'symbols' && <>
      <Card title="ETF 清单" hint="持仓目标与价格">
        {data.etfs.map(etf => (
          <div key={etf.symbol} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}>
            <div className="row" style={{ border: 'none' }}>
              <span className="k" style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
                {etf.symbol}
              </span>
              <button className="ghost" style={{ padding: '0 8px', fontSize: 14 }} onClick={() => removeEtf(etf.symbol)}>
                移除
              </button>
            </div>
            <div className="grid3">
              <Field label="持仓目标 %">
                <NumberInput value={etf.targetRatio * 100} onChange={v => patchEtf(etf.symbol, { targetRatio: Math.min(100, Math.max(0, v ?? 0)) / 100 })} />
              </Field>
              <Field label="现价 USD">
                <NumberInput value={etf.price || undefined} onChange={v => patchEtf(etf.symbol, { price: v ?? 0 })} />
              </Field>
              <Field label="价格日期">
                <input
                  type="date"
                  value={etf.priceDate ?? ''}
                  onChange={e => patchEtf(etf.symbol, { priceDate: e.target.value || undefined })}
                />
              </Field>
            </div>
              </div>
        ))}
        <div className="grid2" style={{ marginTop: 10 }}>
          <Field label="新增 ETF 代码">
            <TextInput value={newSymbol} onChange={setNewSymbol} placeholder="如 ARKK" />
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={addEtf} style={{ width: '100%' }}>
              添加
            </button>
          </div>
        </div>
        <p className="note">持仓目标占比用于核对资产配置。本月新投入的分配在「投资参数」中单独设置，不会自动下单。</p>
      </Card>

      <Card title="行情" hint={data.settings.lastQuoteAt ? `上次 ${data.settings.lastQuoteAt.slice(0, 16).replace('T', ' ')}` : '未更新'}>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="primary" onClick={() => void refreshQuotes()} disabled={quoting}>
            {quoting ? (
              <>
                <span className="spin" /> 正在更新
              </>
            ) : (
              '更新行情'
            )}
          </button>
        </div>
        {quoteMessage && <div className={`banner ${quoteMessage.kind}`}>{quoteMessage.text}</div>}
        <p className="note">
          数据源是腾讯的公开行情接口（实时快照 + 日线）。它会更新各 ETF 的现价与价格日期，并把最近已结束交易日的标普500收盘填进回撤计划的本月。
          请求只发送要查的代码（{Object.keys(QUOTE_SYMBOL).join('、')}），<strong>不会上传任何持仓、金额或账户信息</strong>。
          不点这个按钮就完全不联网。
        </p>
      </Card>

    </>}
    {section === 'accounts' && <>
      <Card title="账户清单" hint="资金表单的常用选项">
        <ListEditor
          items={accountsOf(data.settings)}
          placeholder="如：招商银行 / 盈透证券"
          onChange={list => update(c => ({ ...c, settings: { ...c.settings, accounts: list } }))}
        />
        <p className="note">
          改名不会自动更新已有记录——历史记录里用的还是旧名称（下拉里会标注「已不在清单」）。要一并改的话，
          在记录页编辑那几笔，重新选择账户即可。
        </p>
      </Card>

      <Card title="币种清单" hint="资金表单的常用选项">
        <ListEditor
          items={currenciesOf(data.settings)}
          placeholder="如：RMB / HKD / USD / JPY"
          onChange={list => update(c => ({ ...c, settings: { ...c.settings, currencies: list } }))}
        />
        <p className="note">建议用常见的三字母代码，方便和银行流水对照。</p>
      </Card>

    </>}
    {section === 'help' && <>
      <Card title="使用说明">
        <details className="doc">
          <summary>每月操作顺序</summary>
          <p>
            ① 交易前在「计划」页填最近已结束美股交易日的收盘日与标普500收盘，核对历史最高收盘；
            ② 按计算结果安排换汇、转账，通过「记一笔」逐笔记录；
            ③ 成交后从计划直接记买入，填写实际金额、手续费、份额；
            ④ 在「总览」更新现价与核对现金，有分红则通过「记一笔」另记。
            每月计划日遇休市顺延，不自动下单。
          </p>
        </details>
        <details className="doc">
          <summary>回撤档位与 5000 美元预算</summary>
          <p>
            回撤 = max(0, 1 − 观察收盘 ÷ 历史最高收盘)。回撤低于 10% 总额 {data.settings.baseMonthly}；
            10% 至不足 20% 为 {data.settings.baseMonthly + 250}；20% 及以上为 {data.settings.baseMonthly + 500}。
            额外预算分别消耗 0／250／500。余款不足则只加余款；用完后恢复基础额，不随反弹或新高自动补充或重置。
          </p>
        </details>
        <details className="doc">
          <summary>金额与费用口径</summary>
          <p>
            所有本金均不含另付费用。费用已经体现在汇出与到账差额或换汇实收中时，不要再重复登记。
            「另付费用」默认从该行的付币／汇出账户扣除，用币种字段区分。
            不同币种不能直接相加。
          </p>
        </details>
        <details className="doc">
          <summary>转账与换汇分开；允许部分入金</summary>
          <p>
            每次换汇和每次转账分别记一行，允许只转出部分金额。兼容两条路径：① 香港汇丰 HKD → 嘉信入金中转 USD（换汇），
            再中转 USD → 嘉信证券 USD（入金）；② 港元先转到中转（入金），再中转 HKD → 嘉信证券 USD（换汇）。
            按实际流水选对应步骤，不要把同一笔到账重复记录。
          </p>
        </details>
        <details className="doc">
          <summary>卖出与成本口径</summary>
          <p>
            按实际日期从早到晚填写，同一天按实际成交顺序。持仓成本采用移动加权平均法：卖出按此前平均成本扣减，
            差额计入已实现盈亏。它用于投资分析；报税或核对券商成本时使用正式资料。
          </p>
        </details>
        <details className="doc">
          <summary>历史高点与信息来源</summary>
          <p>
            起始历史高收盘填在「设置 → 投资参数」里。每月可填截至观察日更新的历史最高收盘，该值只增不减。
            当月收盘创新高也会自动更新；两次观察之间有新高但后来回落时，需要手工补填「新历史高收盘」。
            用 Yahoo ^GSPC Close 或同口径来源，不要用盘中高点、52 周高点或账户盈亏。
          </p>
        </details>

      </Card>

    </>}
  </>

}

/**
 * 可增删改的字符串清单编辑器，用于账户与币种。
 *
 * 直接在行内改名，而不是只能删了重加：账户名往往用很久，
 * 改一个字就要重建整条记录太烦。
 */
function ListEditor({
  items,
  placeholder,
  onChange
}: {
  items: string[]
  placeholder?: string
  onChange: (items: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const name = draft.trim()
    if (!name) return
    // 同名（忽略大小写）不重复添加
    if (items.some(i => i.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...items, name])
    setDraft('')
  }

  function rename(index: number, name: string) {
    const next = [...items]
    next[index] = name
    onChange(next)
  }

  function remove(index: number) {
    // 至少保留一项，否则资金页的下拉会空掉
    if (items.length <= 1) return
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <>
      <div className="list">
        {items.map((item, index) => (
          <div key={`${item}-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              defaultValue={item}
              onBlur={e => {
                // 空名字无意义，回落成原值需要外部支持，这里直接阻止清空
                rename(index, e.target.value.trim() || item)
              }}
            />
            <button
              className="ghost"
              style={{ padding: '0 12px', flex: '0 0 auto' }}
              onClick={() => remove(index)}
              disabled={items.length <= 1}
              aria-label="移除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <Field label="新增一项">
          <TextInput value={draft} onChange={setDraft} placeholder={placeholder} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={add} style={{ width: '100%' }}>
            添加
          </button>
        </div>
      </div>
    </>
  )
}
