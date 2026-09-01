const assert = require('node:assert/strict')
const { profileHistoryStatus } = require('../cloudfunctions/get_historical_dashboard/history-status')

assert.deepEqual(profileHistoryStatus({ targetKm: 60, calculatedKm: null, fundAmount: null }), {
  actualText: '—', statusLabel: '未提交数据', statusTop: '未提交', statusBottom: '数据', statusClass: 'status-missing'
})
assert.deepEqual(profileHistoryStatus({ targetKm: 60, calculatedKm: null, fundAmount: null, adminDisposition: 'leave' }), {
  actualText: '—', statusLabel: '提前请假', statusTop: '提前', statusBottom: '请假', statusClass: 'status-leave'
})
assert.equal(profileHistoryStatus({ targetKm: 60, calculatedKm: 60 }).statusClass, 'status-achieved')
assert.equal(profileHistoryStatus({ targetKm: 60, calculatedKm: 30, fundAmount: 90 }).statusClass, 'status-fund')

console.log('历史月份状态测试通过')
