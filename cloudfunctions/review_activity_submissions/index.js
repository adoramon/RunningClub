const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])

function round(value) { return Math.round(Number(value || 0) * 100) / 100 }
function normalizedUnit(unit) {
  const value = String(unit || '').trim().toLowerCase()
  if (['km', '公里', '千米'].includes(value)) return 'km'
  if (['m', '米', 'metre', 'meter', 'metres', 'meters'].includes(value)) return 'm'
  if (['次', '个', 'count', 'counts'].includes(value)) return 'count'
  return value
}
function distanceToKm(value, unit) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  const normalized = normalizedUnit(unit)
  if (normalized === 'km') return numeric
  if (normalized === 'm') return numeric / 1000
  return null
}
function isValidActivityUnit(type, unit) {
  const normalized = normalizedUnit(unit)
  if (['running', 'cycling', 'swimming'].includes(type)) return ['km', 'm'].includes(normalized)
  if (type === 'jump_rope') return normalized === 'count'
  if (type === 'elevation') return normalized === 'm'
  return false
}
function activityEquivalentKm(type, value, unit) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || !isValidActivityUnit(type, unit)) return null
  if (type === 'running') return round(distanceToKm(numeric, unit))
  if (type === 'cycling') return round(distanceToKm(numeric, unit) / 3)
  if (type === 'swimming') return round(distanceToKm(numeric, unit) * 5)
  if (type === 'jump_rope') return round(numeric / 100)
  if (type === 'elevation') return round(numeric * 0.02)
  return null
}

async function currentAdmin() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !ADMIN_MEMBER_IDS.has(user.historicalMemberId)) throw new Error('仅高翔或元可审核跑量')
  return user
}

function publicReview(record, usersById, membersById) {
  const user = usersById.get(record.userId) || {}
  const member = membersById.get(record.historicalMemberId) || {}
  const reviewed = Array.isArray(record.memberReviewedActivities) && record.memberReviewedActivities.length
    ? record.memberReviewedActivities : ((record.recognition && record.recognition.activities) || [])
  return {
    submissionId: record._id,
    month: record.month,
    memberName: user.wechatNickname || user.nickname || member.alias || '未知成员',
    memberAlias: member.alias || '',
    avatarFileId: user.avatarFileId || '',
    evidenceFileIds: record.evidenceFileIds || [],
    confirmedEquivalentKm: record.memberConfirmedEquivalentKm,
    activities: reviewed.map((item, index) => ({
      activityIndex: Number.isInteger(item.activityIndex) ? item.activityIndex : index,
      activityType: item.activityType, rawValue: item.rawValue, rawUnit: item.rawUnit,
      equivalentKm: item.equivalentKm, included: item.included !== false,
      evidenceImageIndex: item.evidenceImageIndex || 1, evidence: item.evidence || ''
    }))
  }
}

function baseActivitiesFor(record) {
  const activities = Array.isArray(record.memberReviewedActivities) && record.memberReviewedActivities.length
    ? record.memberReviewedActivities : ((record.recognition && record.recognition.activities) || [])
  return activities.map((item, index) => ({ ...item, activityIndex: Number.isInteger(item.activityIndex) ? item.activityIndex : index }))
}

function reviewedActivitiesFor(record, requestedActivities) {
  const base = baseActivitiesFor(record)
  const requestedByIndex = new Map((Array.isArray(requestedActivities) ? requestedActivities : []).map(item => [Number(item.activityIndex), item]))
  return base.map(item => {
    const requested = requestedByIndex.get(item.activityIndex) || {}
    const included = requested.included !== false
    const rawValue = requested.rawValue === undefined ? item.rawValue : Number(requested.rawValue)
    const rawUnit = item.rawUnit
    if (!Number.isFinite(rawValue) || rawValue < 0) throw new Error('请填写有效的运动数值')
    if (included && !isValidActivityUnit(item.activityType, rawUnit)) throw new Error('该运动项目的单位不符合换算规则，请取消计入或作废处理')
    const equivalentKm = included ? activityEquivalentKm(item.activityType, rawValue, rawUnit) : 0
    if (included && equivalentKm === null) throw new Error('无法按规则换算该运动数据')
    return {
      activityIndex: item.activityIndex, activityType: item.activityType, rawValue: round(rawValue), rawUnit,
      equivalentKm: round(equivalentKm), included, evidenceImageIndex: item.evidenceImageIndex || 1, evidence: item.evidence || ''
    }
  })
}

exports.main = async (event = {}) => {
  const admin = await currentAdmin()
  const action = String(event.action || 'list')
  const records = db.collection('activity_records')

  if (action === 'list') {
    const pending = await records.where({ reviewStatus: 'pending_admin_review' }).limit(100).get()
    const [usersResult, membersResult] = await Promise.all([
      db.collection('users').field({ _id: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get(),
      db.collection('historical_members').limit(100).get()
    ])
    const usersById = new Map(usersResult.data.map(user => [user._id, user]))
    const membersById = new Map(membersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
    return { reviews: pending.data.map(record => publicReview(record, usersById, membersById)) }
  }

  if (action === 'approve') {
    const submissionId = String(event.submissionId || '')
    if (!submissionId) throw new Error('缺少审核记录')
    const current = (await records.doc(submissionId).get()).data
    if (!current) throw new Error('未找到审核记录')
    if (current.reviewStatus === 'approved') return { approved: true, alreadyApproved: true }
    if (current.reviewStatus !== 'pending_admin_review') throw new Error('该记录当前不可审核')
    const approverAlias = admin.historicalMemberId === 'legacy-member-023' ? '高翔' : '元'
    const reviewedActivities = reviewedActivitiesFor(current, event.reviewedActivities)
    const approvedEquivalentKm = round(reviewedActivities.reduce((sum, item) => sum + (item.included ? item.equivalentKm : 0), 0))
    await records.doc(submissionId).update({ data: {
      reviewStatus: 'approved', recognitionStatus: 'approved', adminReviewedAt: db.serverDate(),
      adminReviewedByUserId: admin._id, adminReviewedByAlias: approverAlias,
      adminReviewedActivities: reviewedActivities, adminApprovedEquivalentKm: approvedEquivalentKm,
      updatedAt: db.serverDate()
    } })
    return { approved: true, alreadyApproved: false, approvedEquivalentKm }
  }

  if (action === 'void') {
    const submissionId = String(event.submissionId || '')
    const voidReason = String(event.voidReason || '').trim().slice(0, 160)
    if (!submissionId) throw new Error('缺少审核记录')
    if (!voidReason) throw new Error('请填写作废原因，便于成员重新提交')
    const current = (await records.doc(submissionId).get()).data
    if (!current) throw new Error('未找到审核记录')
    if (current.reviewStatus !== 'pending_admin_review') throw new Error('该记录当前不可作废')
    const voidedByAlias = admin.historicalMemberId === 'legacy-member-023' ? '高翔' : '元'
    await records.doc(submissionId).update({ data: {
      reviewStatus: 'voided', recognitionStatus: 'voided', adminVoidedAt: db.serverDate(),
      adminVoidedByUserId: admin._id, adminVoidedByAlias: voidedByAlias, adminVoidReason: voidReason,
      updatedAt: db.serverDate()
    } })
    return { voided: true }
  }

  throw new Error('不支持的审核操作')
}
