const assert = require('node:assert/strict')
const { overlayApprovedActivities, approvedActivitiesRevision } = require('../cloudfunctions/get_historical_dashboard/lifetime')

const historical = [
  { month: '2026-07', legacyMemberKey: 'member-1', targetKm: 60, equivalentKm: 70 },
  { month: '2026-08', legacyMemberKey: 'member-1', targetKm: 60, equivalentKm: null }
]
const approved = [{
  _id: 'activity-1', historicalMemberId: 'member-1', month: '2026-08', reviewStatus: 'approved',
  memberConfirmedEquivalentKm: 63, adminApprovedEquivalentKm: 64.14
}]
const pending = [{
  _id: 'activity-2', historicalMemberId: 'member-1', month: '2026-07', reviewStatus: 'pending_admin_review',
  memberConfirmedEquivalentKm: 99
}]

const merged = overlayApprovedActivities(historical, [...approved, ...pending]).sort((a, b) => a.month.localeCompare(b.month))
assert.equal(merged[0].equivalentKm, 70)
assert.equal(merged[1].equivalentKm, 64.14)
assert.equal(approvedActivitiesRevision(approved), 'activity-1:member-1:2026-08:64.14')
assert.notEqual(approvedActivitiesRevision(approved), approvedActivitiesRevision([{ ...approved[0], adminApprovedEquivalentKm: 65 }]))

console.log('累计跑量合并测试通过')
