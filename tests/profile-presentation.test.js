const assert = require('node:assert/strict')
const { buildPresentation, numberText } = require('../services/profile-presentation')
const result = buildPresentation({
  summaryMonth: '2026-08', totalActualKm: 12345.67,
  historyYears: [
    { year: 2026, months: [{ month: '2026-08', actualKm: null, actualText: '—', targetKm: 60 }, { month: '2026-07', actualKm: 90, actualText: '90' }, { month: '2026-09', placeholder: true }] },
    { year: 2025, months: [{ month: '2025-12', actualKm: 1200, actualText: '1200' }] }
  ],
  recentTrend: [{ month: '2026-07', actualKm: 90, hasActual: true, targetKm: 60 }, { month: '2026-08', actualKm: 0, hasActual: false, targetKm: 60, statusLabel: '提前请假' }],
  monthlyEvaluation: { content: '评价' }
})
assert.equal(result.historyYears[0].expanded, true)
assert.equal(result.historyYears[1].expanded, false)
assert.equal(result.historyYears[0].totalText, '90')
assert.equal(result.historyYears[1].totalText, '1,200')
assert.equal(result.latest.actualText, '—')
assert.equal(result.latest.pctText, '—')
assert.equal(result.latest.statusLabel, '提前请假')
assert.equal(result.evaluationMonth, '2026-08')
assert.equal(result.totalKmText, '12,345.67')
assert.equal(numberText(null), '—')
assert.equal(buildPresentation({}).latest.pctText, '—')
const over = buildPresentation({ recentTrend: [{ month: '2026-08', actualKm: 90, hasActual: true, targetKm: 60 }] })
assert.equal(over.latest.pctText, '150')
assert.ok(over.latest.ringStyle.includes('100%'))
const zero = buildPresentation({ recentTrend: [{ month: '2026-08', actualKm: 0, hasActual: true, targetKm: 60 }] })
assert.equal(zero.latest.actualText, '0')
assert.equal(zero.latest.pctText, '0')
console.log('个人战报月份、空值、累计、折叠和完成率测试通过')
