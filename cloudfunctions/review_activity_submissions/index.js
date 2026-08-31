const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])
const isNumber = value => typeof value === 'number' && Number.isFinite(value)

function round(value) { return Math.round(Number(value || 0) * 100) / 100 }
async function attachTemporaryAvatarUrls(items) {
  const fileIds = [...new Set(items.map(item => item.avatarFileId).filter(Boolean))]
  if (!fileIds.length) return items
  try {
    const result = await cloud.getTempFileURL({ fileList: fileIds })
    const urlsByFileId = new Map((result.fileList || [])
      .filter(item => Number(item.status) === 0 && item.tempFileURL)
      .map(item => [item.fileID || item.fileId, item.tempFileURL]))
    return items.map(item => ({ ...item, avatarUrl: urlsByFileId.get(item.avatarFileId) || '' }))
  } catch (error) {
    console.warn('审核头像临时链接生成失败', error)
    return items.map(item => ({ ...item, avatarUrl: '' }))
  }
}
async function attachTemporaryEvidenceUrls(items) {
  const fileIds = [...new Set(items.flatMap(item => item.evidenceFileIds || []).filter(Boolean))]
  if (!fileIds.length) return items.map(item => ({ ...item, evidenceFiles: [] }))
  try {
    const result = await cloud.getTempFileURL({ fileList: fileIds })
    const urlsByFileId = new Map((result.fileList || [])
      .filter(item => Number(item.status) === 0 && item.tempFileURL)
      .map(item => [item.fileID || item.fileId, item.tempFileURL]))
    return items.map(item => ({
      ...item,
      evidenceFiles: (item.evidenceFileIds || []).map((fileId, index) => ({
        fileId, index: index + 1, tempUrl: urlsByFileId.get(fileId) || ''
      }))
    }))
  } catch (error) {
    console.warn('审核截图临时链接生成失败', error)
    return items.map(item => ({ ...item, evidenceFiles: [] }))
  }
}
async function attachReviewFileUrls(items) {
  return attachTemporaryEvidenceUrls(await attachTemporaryAvatarUrls(items))
}
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

function summaryMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousFailureStreak(records, month) {
  let streak = 0
  records.filter(record => record.month < month).sort((a, b) => a.month.localeCompare(b.month)).forEach(record => {
    if (!isNumber(record.targetKm)) { streak = 0; return }
    if (isNumber(record.equivalentKm)) { streak = record.equivalentKm >= record.targetKm ? 0 : streak + 1; return }
    if (isNumber(record.fundAmount)) streak += 1
  })
  return streak
}

function hasActiveSubmission(record) {
  return record && !['cancelled', 'withdrawn', 'voided', 'recognition_failed', 'failed'].includes(record.reviewStatus)
}

async function findMissingSubmissions() {
  const month = summaryMonth()
  const [recordsResult, settlementsResult, activitiesResult, membersResult, usersResult] = await Promise.all([
    db.collection('historical_monthly_records').where({ month }).limit(100).get(),
    db.collection('monthly_settlements').where({ month }).limit(100).get(),
    db.collection('activity_records').where({ month }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('users').field({ historicalMemberId: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get()
  ])
  const settledMemberIds = new Set(settlementsResult.data.map(record => record.historicalMemberId).filter(Boolean))
  const activeSubmissionMemberIds = new Set(activitiesResult.data.filter(hasActiveSubmission).map(record => record.historicalMemberId).filter(Boolean))
  const membersById = new Map(membersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
  const usersByMemberId = new Map(usersResult.data.filter(user => user.historicalMemberId).map(user => [user.historicalMemberId, user]))
  const candidates = recordsResult.data.filter(record => isNumber(record.targetKm) && !isNumber(record.equivalentKm) && !isNumber(record.fundAmount) && !settledMemberIds.has(record.legacyMemberKey) && !activeSubmissionMemberIds.has(record.legacyMemberKey))
  return Promise.all(candidates.map(async record => {
    const memberId = record.legacyMemberKey
    const history = await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'asc').limit(100).get()
    const priorStreak = previousFailureStreak(history.data, month)
    const failureStreak = priorStreak + 1
    const targetKm = round(record.targetKm)
    const fundDue = round(targetKm * 3 * failureStreak)
    const member = membersById.get(memberId) || {}
    const user = usersByMemberId.get(memberId)
    return {
      memberId, month, targetKm, targetText: String(targetKm), shortfallKm: targetKm,
      failureStreak, fundRatePerKm: 3 * failureStreak, fundDue, fundDueText: fundDue.toFixed(2),
      alias: member.alias || '未知成员', displayName: user ? (user.wechatNickname || user.nickname || member.alias) : (member.alias || '未知成员'),
      avatarFileId: user ? (user.avatarFileId || '') : '', registered: Boolean(user)
    }
  }))
}

function approvedEquivalentKm(record) {
  if (!record || record.reviewStatus !== 'approved') return null
  if (isNumber(record.adminApprovedEquivalentKm)) return round(record.adminApprovedEquivalentKm)
  return isNumber(record.memberConfirmedEquivalentKm) ? round(record.memberConfirmedEquivalentKm) : null
}

async function findPendingFundPayments() {
  const month = summaryMonth()
  const [recordsResult, settlementsResult, activitiesResult, membersResult, usersResult] = await Promise.all([
    db.collection('historical_monthly_records').where({ month }).limit(100).get(),
    db.collection('monthly_settlements').where({ month }).limit(100).get(),
    db.collection('activity_records').where({ month }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('users').field({ historicalMemberId: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get()
  ])
  const settledMemberIds = new Set(settlementsResult.data.map(record => record.historicalMemberId).filter(Boolean))
  const activityByMemberId = new Map(activitiesResult.data.filter(record => isNumber(approvedEquivalentKm(record))).map(record => [record.historicalMemberId, record]))
  const membersById = new Map(membersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
  const usersByMemberId = new Map(usersResult.data.filter(user => user.historicalMemberId).map(user => [user.historicalMemberId, user]))
  const candidates = recordsResult.data.map(record => {
    const activity = activityByMemberId.get(record.legacyMemberKey)
    const actualKm = activity ? approvedEquivalentKm(activity) : (isNumber(record.equivalentKm) ? round(record.equivalentKm) : null)
    return { ...record, actualKm }
  }).filter(record => isNumber(record.targetKm) && isNumber(record.actualKm) && record.actualKm < record.targetKm && !isNumber(record.fundAmount) && !settledMemberIds.has(record.legacyMemberKey))
  return Promise.all(candidates.map(async record => {
    const memberId = record.legacyMemberKey
    const history = await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'asc').limit(100).get()
    const failureStreak = previousFailureStreak(history.data, month) + 1
    const targetKm = round(record.targetKm)
    const actualKm = round(record.actualKm)
    const shortfallKm = round(targetKm - actualKm)
    const fundRatePerKm = 3 * failureStreak
    const fundDue = round(shortfallKm * fundRatePerKm)
    const member = membersById.get(memberId) || {}
    const user = usersByMemberId.get(memberId)
    return {
      memberId, month, targetKm, targetText: String(targetKm), actualKm, actualText: String(actualKm), shortfallKm,
      failureStreak, fundRatePerKm, fundDue, fundDueText: fundDue.toFixed(2),
      alias: member.alias || '未知成员', displayName: user ? (user.wechatNickname || user.nickname || member.alias) : (member.alias || '未知成员'),
      avatarFileId: user ? (user.avatarFileId || '') : '', registered: Boolean(user)
    }
  }))
}

async function confirmFundPayment({ admin, candidate, note }) {
  const settlementId = `settlement-${candidate.month}-${candidate.memberId}`
  const operatorAlias = admin.historicalMemberId === 'legacy-member-023' ? '高翔' : '元'
  await db.runTransaction(async transaction => {
    const settlementRef = transaction.collection('monthly_settlements').doc(settlementId)
    try {
      const existing = await settlementRef.get()
      if (existing && existing.data) throw new Error('该成员的上月记录已被处理')
    } catch (error) {
      if (error && error.errCode !== -1 && error.errMsg !== 'document not found') throw error
    }
    await settlementRef.set({ data: {
      historicalMemberId: candidate.memberId, month: candidate.month, targetKm: candidate.targetKm,
      equivalentKm: candidate.actualKm, shortfallKm: candidate.shortfallKm, isCompleted: false,
      failureStreak: candidate.failureStreak, fundRatePerKm: candidate.fundRatePerKm, fundDue: candidate.fundDue,
      status: 'fund_paid', reviewedByUserId: admin._id, reviewedByAlias: operatorAlias, reviewedAt: db.serverDate(), createdAt: db.serverDate()
    } })
    await transaction.collection('fund_ledger').doc(`member-payment-${candidate.month}-${candidate.memberId}`).set({ data: {
      month: candidate.month, entryType: 'member_payment', amount: candidate.fundDue, status: 'confirmed',
      historicalMemberId: candidate.memberId, settlementId, confirmedByUserId: admin._id, confirmedByAlias: operatorAlias,
      note, occurredAt: db.serverDate(), createdAt: db.serverDate()
    } })
  })
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
    memberId: record.historicalMemberId,
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
    const [pending, usersResult, membersResult, missingSubmissions, pendingFundPayments] = await Promise.all([
      records.where({ reviewStatus: 'pending_admin_review' }).limit(100).get(),
      db.collection('users').field({ _id: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get(),
      db.collection('historical_members').limit(100).get(),
      findMissingSubmissions(),
      findPendingFundPayments()
    ])
    const usersById = new Map(usersResult.data.map(user => [user._id, user]))
    const membersById = new Map(membersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
    const [reviews, missing, fundPayments] = await Promise.all([
      attachReviewFileUrls(pending.data.map(record => publicReview(record, usersById, membersById))),
      attachTemporaryAvatarUrls(missingSubmissions),
      attachTemporaryAvatarUrls(pendingFundPayments)
    ])
    return { reviews, missingSubmissions: missing, pendingFundPayments: fundPayments }
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

  if (action === 'resolve_missing') {
    const memberId = String(event.memberId || '')
    const resolution = String(event.resolution || '')
    if (!memberId || !['leave', 'fund_paid'].includes(resolution)) throw new Error('缺少有效的未提交处理方式')
    const candidate = (await findMissingSubmissions()).find(item => item.memberId === memberId)
    if (!candidate) throw new Error('该成员当前不在上月未提交名单中，可能已提交或已被处理')
    const operatorAlias = admin.historicalMemberId === 'legacy-member-023' ? '高翔' : '元'
    await db.runTransaction(async transaction => {
      const settlementRef = transaction.collection('monthly_settlements').doc(`settlement-${candidate.month}-${memberId}`)
      try {
        const existing = await settlementRef.get()
        if (existing && existing.data) throw new Error('该成员的上月未提交记录已被处理')
      } catch (error) {
        if (error && error.errCode !== -1 && error.errMsg !== 'document not found') throw error
      }
      const common = {
        historicalMemberId: memberId, month: candidate.month, targetKm: candidate.targetKm,
        equivalentKm: resolution === 'fund_paid' ? 0 : null, shortfallKm: resolution === 'fund_paid' ? candidate.shortfallKm : null,
        isCompleted: false, failureStreak: resolution === 'fund_paid' ? candidate.failureStreak : candidate.failureStreak - 1,
        fundRatePerKm: resolution === 'fund_paid' ? candidate.fundRatePerKm : 0,
        fundDue: resolution === 'fund_paid' ? candidate.fundDue : 0,
        status: resolution, reviewedByUserId: admin._id, reviewedByAlias: operatorAlias, reviewedAt: db.serverDate(), createdAt: db.serverDate()
      }
      await settlementRef.set({ data: common })
      if (resolution === 'fund_paid') {
        await transaction.collection('fund_ledger').doc(`member-payment-${candidate.month}-${memberId}`).set({ data: {
          month: candidate.month, entryType: 'member_payment', amount: candidate.fundDue, status: 'confirmed',
          historicalMemberId: memberId, settlementId: `settlement-${candidate.month}-${memberId}`, confirmedByUserId: admin._id, confirmedByAlias: operatorAlias,
          note: `确认 ${candidate.alias} 缴纳上月未提交跑量公积金`, occurredAt: db.serverDate(), createdAt: db.serverDate()
        } })
      }
    })
    return { resolved: true, resolution, fundDue: resolution === 'fund_paid' ? candidate.fundDue : 0 }
  }

  if (action === 'confirm_fund_payment') {
    const memberId = String(event.memberId || '')
    if (!memberId) throw new Error('缺少成员标识')
    const candidate = (await findPendingFundPayments()).find(item => item.memberId === memberId)
    if (!candidate) throw new Error('该成员当前没有待确认的上月公积金')
    await confirmFundPayment({ admin, candidate, note: `确认 ${candidate.alias} 缴纳上月跑量未达标公积金` })
    return { confirmed: true, fundDue: candidate.fundDue }
  }

  throw new Error('不支持的审核操作')
}
