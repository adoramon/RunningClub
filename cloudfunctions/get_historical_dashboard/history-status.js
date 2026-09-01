const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100
const formatKm = value => isNumber(value) ? String(round(value)) : '—'

function profileHistoryStatus(record) {
  if (record.adminDisposition === 'leave') {
    return { actualText: '—', statusLabel: '提前请假', statusTop: '提前', statusBottom: '请假', statusClass: 'status-leave' }
  }
  if (!isNumber(record.calculatedKm) && !isNumber(record.fundAmount)) {
    return { actualText: '—', statusLabel: '未提交数据', statusTop: '未提交', statusBottom: '数据', statusClass: 'status-missing' }
  }
  if (isNumber(record.fundAmount)) {
    return { actualText: formatKm(record.calculatedKm), statusLabel: '已缴基金', statusTop: '已缴', statusBottom: '基金', statusClass: 'status-fund' }
  }
  if (isNumber(record.calculatedKm) && (!isNumber(record.targetKm) || record.calculatedKm >= record.targetKm)) {
    return { actualText: formatKm(record.calculatedKm), statusLabel: '达成目标', statusTop: '达成', statusBottom: '目标', statusClass: 'status-achieved' }
  }
  return { actualText: formatKm(record.calculatedKm), statusLabel: '已缴基金', statusTop: '已缴', statusBottom: '基金', statusClass: 'status-fund' }
}

module.exports = { profileHistoryStatus }
