import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appSymbol, lastBar, parseKlinePayload, parseQuoteText, vendorSymbol } from '../src/core/quotes.ts'

/**
 * 下面两个 fixture 是从腾讯端点**实际抓回来**的真实报文片段
 * （GBK 解码后的文本），不是手写的理想数据——
 * 这样字段位置一旦变动，测试会直接失败，而不是悄悄算错价格。
 */

const REAL_QUOTE_TEXT = [
  'v_usVOO="200~标普500 ETF-Vanguard~VOO.AM~712.32~707.54~707.44~6172916~0~0~712.20~320~0~0~0~0~0~0~0~0~712.32~280~0~0~0~0~0~0~0~0~~2026-10-05 16:00:00~2.32~0.33~713.86~707.42~712.32/6172916/4385235684~6172916~0~0~0~0~0~0~0~0~";',
  'v_usQQQM="200~纳斯达克100指数ETF-Invesco~QQQM.OQ~311.40~308.69~308.58~2319901~0~0~311.40~100~0~0~0~0~0~0~0~0~311.78~200~0~0~0~0~0~0~0~0~~~2026-10-05 16:00:00~2.71~0.88~";',
  'v_usINX="200~标普500~.INX~7773.95~7722.72~7730.86~3473000943~0~0~7744.65~0~0~0~0~0~0~0~0~0~7808.91~0~0~0~0~0~0~0~0~0~~2026-10-05 17:15:59~51.23~0.66~";'
].join('\n')

const REAL_KLINE = {
  code: 0,
  data: {
    usINX: {
      day: [
        ['2026-09-22', '7770.81', '7764.64', '7782.19', '7756.26', '3164537854.00'],
        ['2026-09-23', '7761.94', '7706.03', '7761.94', '7694.89', '2977393567.00'],
        ['2026-10-02', '7722.72', '7722.72', '7783.42', '7697.95', '0.00'],
        ['2026-10-05', '7730.86', '7773.95', '7808.91', '7730.86', '0.00']
      ]
    }
  }
}

test('解析实时快照：一次请求多个代码', () => {
  const quotes = parseQuoteText(REAL_QUOTE_TEXT)
  assert.equal(quotes.length, 3)

  const voo = quotes.find(q => q.symbol === 'VOO')
  assert.ok(voo)
  assert.equal(voo!.price, 712.32)
  assert.equal(voo!.previousClose, 707.54)
  assert.equal(voo!.open, 707.44)
  assert.equal(voo!.vendorSymbol, 'VOO.AM')
  assert.equal(voo!.name, '标普500 ETF-Vanguard')
  assert.equal(voo!.quoteDate, '2026-10-05')

  const qqqm = quotes.find(q => q.symbol === 'QQQM')
  assert.ok(qqqm)
  assert.equal(qqqm!.price, 311.4)

  // 指数在应用内的代码是 ^GSPC，显示的代码是 .INX
  const spx = quotes.find(q => q.symbol === '^GSPC')
  assert.ok(spx)
  assert.equal(spx!.price, 7773.95)
  assert.equal(spx!.vendorSymbol, '.INX')
})

test('解析实时快照：跳过无效与空响应', () => {
  assert.deepEqual(parseQuoteText(''), [])
  assert.deepEqual(parseQuoteText('v_pv_none_match="1";'), [])
  assert.deepEqual(parseQuoteText('这不是行情报文'), [])
  // 字段不足时跳过，不抛错
  assert.deepEqual(parseQuoteText('v_usVOO="200~名称~VOO.AM~1.0";'), [])
})

test('解析日线：按日期升序，最后一根是最近已结束交易日', () => {
  const bars = parseKlinePayload(REAL_KLINE, 'usINX')
  assert.equal(bars.length, 4)
  assert.equal(bars[0].date, '2026-09-22')
  const last = lastBar(bars)
  assert.ok(last)
  assert.equal(last!.date, '2026-10-05')
  assert.equal(last!.close, 7773.95)
  assert.equal(last!.high, 7808.91)
  assert.equal(last!.low, 7730.86)
})

test('解析日线：容错处理', () => {
  assert.deepEqual(parseKlinePayload(null, 'usINX'), [])
  assert.deepEqual(parseKlinePayload({}, 'usINX'), [])
  assert.deepEqual(parseKlinePayload({ data: {} }, 'usINX'), [])
  assert.deepEqual(parseKlinePayload({ data: { usINX: { day: 'bad' } } }, 'usINX'), [])
  // 无效日期与缺列的行被跳过
  const bars = parseKlinePayload({ data: { usINX: { day: [['bad-date', '1', '2'], ['2026-01-01']] } } }, 'usINX')
  assert.deepEqual(bars, [])
})

test('代码映射与应用代码反查', () => {
  assert.equal(vendorSymbol('VOO'), 'usVOO')
  assert.equal(vendorSymbol('QQQM'), 'usQQQM')
  assert.equal(vendorSymbol('SMH'), 'usSMH')
  assert.equal(vendorSymbol('^GSPC'), 'usINX')
  // 未登记的代码按美股约定拼前缀
  assert.equal(vendorSymbol('ARKK'), 'usARKK')

  assert.equal(appSymbol('usVOO'), 'VOO')
  assert.equal(appSymbol('usINX'), '^GSPC')
  assert.equal(appSymbol('unknown'), 'unknown')
})

test('价格字段有逗号或异常值时不会算成 NaN', () => {
  const quotes = parseQuoteText('v_usVOO="200~名称~VOO.AM~~707.54~707.44~1~";')
  // 现价为空 → 整条跳过，而不是返回 NaN 污染总览
  assert.deepEqual(quotes, [])
})
