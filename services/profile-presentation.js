const numeric = value => typeof value === 'number' && Number.isFinite(value)
function numberText(value) {
  if (!numeric(value)) return '—'
  return String(Math.round(value * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function buildPresentation(profile) {
  const years = (profile.historyYears || []).map((year, index) => ({
    ...year, expanded: index === 0,
    totalText: numberText(year.months.filter(item => !item.placeholder).reduce((sum, item) => {
      const value = numeric(item.actualKm) ? item.actualKm : Number(String(item.actualText || '').replace(/,/g, ''))
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0))
  }))
  const records = years.flatMap(year => year.months).filter(item => !item.placeholder)
  const points = (profile.recentTrend || []).map(item => {
    const record = records.find(row => row.month === item.month)
    const targetKm = numeric(item.targetKm) ? item.targetKm : record && numeric(record.targetKm) ? record.targetKm : null
    const hasActual = typeof item.hasActual === 'boolean' ? item.hasActual : numeric(item.actualKm)
    return { ...item, actualKm: numeric(item.actualKm) ? item.actualKm : 0, targetKm, hasActual,
      actualText: hasActual ? numberText(item.actualKm) : '—', targetText: numberText(targetKm),
      statusLabel: item.statusLabel || (record && record.statusLabel) || '历史记录',
      statusClass: item.statusClass || (record && record.statusClass) || 'status-achieved' }
  })
  const month = profile.summaryMonth || (points.length ? points[points.length - 1].month : '')
  const latest = points.find(item => item.month === month) || { month, actualText: '—', targetText: '—', hasActual: false, statusLabel: '未提交数据' }
  const pct = latest.hasActual && numeric(latest.targetKm) && latest.targetKm > 0 ? Math.round(latest.actualKm / latest.targetKm * 100) : null
  return { historyYears: years, trendPoints: points,
    latest: { ...latest, pctText: pct === null ? '—' : String(pct), ringStyle: `background:conic-gradient(#A6E8BC ${Math.min(100, pct || 0)}%,rgba(255,255,255,.14) 0);` },
    totalKmText: numberText(profile.totalActualKm),
    evaluationMonth: profile.monthlyEvaluation ? (profile.monthlyEvaluation.month || month) : '',
    selectedTrend: points.length ? points[points.length - 1] : null }
}
module.exports = { buildPresentation, numberText }
