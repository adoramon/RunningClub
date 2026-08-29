const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])

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
    activities: reviewed.filter(item => item.included !== false).map(item => ({
      activityType: item.activityType, rawValue: item.rawValue, rawUnit: item.rawUnit,
      equivalentKm: item.equivalentKm, evidenceImageIndex: item.evidenceImageIndex || 1, evidence: item.evidence || ''
    }))
  }
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
    await records.doc(submissionId).update({ data: {
      reviewStatus: 'approved', recognitionStatus: 'approved', adminReviewedAt: db.serverDate(),
      adminReviewedByUserId: admin._id, adminReviewedByAlias: approverAlias, updatedAt: db.serverDate()
    } })
    return { approved: true, alreadyApproved: false }
  }

  throw new Error('不支持的审核操作')
}
