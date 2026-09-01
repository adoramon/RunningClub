const assert = require('node:assert/strict')
const { deterministicMonthlySummary } = require('../cloudfunctions/submit_activity_screenshot/monthly-summary')

const ocr = { images: [{ imageIndex: 1, lines: [
  '总览', '2026年8月', '25.6 小时 44 次', '35.29', '步行 (公里)', '192.41', '骑行 (公里)',
  '户外骑行', '5.80 公里 00:28:41', '2026年7月', '47.49', '步行 (公里)', '120.24', '骑行 (公里)'
] }] }

assert.deepEqual(deterministicMonthlySummary(ocr, '2026-08'), [{
  activityType: 'cycling', activityMonth: '2026-08', rawValue: 192.41, rawUnit: 'km', equivalentKm: 64.14,
  evidenceImageIndex: 1, evidenceLineIndexes: [2, 6, 7], evidence: '2026年8月 · 192.41 · 骑行 (公里)'
}])

console.log('月度汇总兜底测试通过')
