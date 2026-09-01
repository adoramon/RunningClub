const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100

function approvedActivityKm(record) {
  if (!record || record.reviewStatus !== 'approved') return null
  const value = record.adminApprovedEquivalentKm === undefined ? record.memberConfirmedEquivalentKm : record.adminApprovedEquivalentKm
  return isNumber(value) ? round(value) : null
}

function overlayApprovedActivities(rawRecords, activityRecords = []) {
  const recordsByMonth = new Map(rawRecords.map(record => [record.month, { ...record }]))
  activityRecords.forEach(activity => {
    const equivalentKm = approvedActivityKm(activity)
    if (!activity.month || !isNumber(equivalentKm)) return
    const current = recordsByMonth.get(activity.month) || { month: activity.month, legacyMemberKey: activity.historicalMemberId }
    recordsByMonth.set(activity.month, { ...current, equivalentKm, approvedActivityId: activity._id })
  })
  return [...recordsByMonth.values()]
}

function approvedActivitiesRevision(records = []) {
  return records.map(record => [
    record._id || '', record.historicalMemberId || '', record.month || '', approvedActivityKm(record)
  ].join(':')).sort().join('|')
}

module.exports = { approvedActivityKm, overlayApprovedActivities, approvedActivitiesRevision }
