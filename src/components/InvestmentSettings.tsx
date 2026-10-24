import { useState } from 'react'
import type { AppData } from '../core/types.ts'
import { Card, Checkbox, Field, NumberInput } from './ui.tsx'

export function InvestmentSettings({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const [base, setBase] = useState<number | undefined>(data.settings.baseMonthly)
  const [budget, setBudget] = useState<number | undefined>(data.settings.extraBudgetTotal)
  const [peak, setPeak] = useState<number | undefined>(data.settings.startingPeak)
  const [day, setDay] = useState<number | undefined>(data.settings.planDay)
  const [etfs, setEtfs] = useState(data.etfs.map(e => ({ symbol: e.symbol, planned: e.planned, percent: (e.investRatio ?? e.targetRatio) * 100 })))
  const [message, setMessage] = useState('')
  const total = etfs.filter(e => e.planned).reduce((n, e) => n + e.percent, 0)
  const valid = base !== undefined && Number.isFinite(base) && base > 0 && budget !== undefined && Number.isFinite(budget) && budget >= 0 && peak !== undefined && Number.isFinite(peak) && peak > 0 && day !== undefined && Number.isInteger(day) && day >= 1 && day <= 31 && etfs.some(e => e.planned) && etfs.every(e => e.percent >= 0 && e.percent <= 100) && Math.abs(total - 100) < 0.0001
  return <>
    <Card title="定投参数"><Field label="基础月投 USD"><NumberInput value={base} onChange={setBase} /></Field><Field label="额外预算 USD"><NumberInput value={budget} onChange={setBudget} /></Field><Field label="起始历史最高收盘"><NumberInput value={peak} onChange={setPeak} /></Field><Field label="每月计划日" sub="1～31，月份天数不足时使用月底。"><NumberInput value={day} onChange={setDay} /></Field></Card>
    <Card title="本月投入比例" hint={`合计 ${total.toFixed(2)}%`}>
      {etfs.map((e, i) => <div className="allocation-row" key={e.symbol}><Checkbox label={e.symbol} checked={e.planned} onChange={planned => setEtfs(list => list.map((v, j) => i === j ? { ...v, planned } : v))} /><Field label={`${e.symbol} 投入 %`}><NumberInput value={e.percent} onChange={v => setEtfs(list => list.map((entry, j) => i === j ? { ...entry, percent: v ?? 0 } : entry))} /></Field></div>)}
      <p className="note">仅勾选的标的参与定投，比例合计需为 100%。持仓目标占比在「标的管理」中单独设置。</p>
    </Card>
    {!valid && <div className="banner info">请检查金额、计划日与投入比例，选中标的合计需为 100%。</div>}
    <p className="note">更改参数会重新计算计划，不改变实际成交记录。</p>
    <button className="primary full-width" disabled={!valid} onClick={() => {
      update(c => ({ ...c, settings: { ...c.settings, baseMonthly: base!, extraBudgetTotal: budget!, startingPeak: peak!, planDay: day!, rebalance: (etfs.find(e => e.symbol === 'QQQM' && e.planned)?.percent ?? 0) / 100 }, etfs: c.etfs.map(e => { const hit = etfs.find(v => v.symbol === e.symbol); return hit ? { ...e, planned: hit.planned, investRatio: hit.percent / 100 } : e }) }))
      setMessage('投资参数已更新')
    }}>保存投资参数</button>
    {message && <div className="banner ok" role="status">{message}</div>}
  </>
}
