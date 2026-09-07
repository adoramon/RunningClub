// 各云函数独立部署，此文件保持同版；tests/admin-upload.test.js 检查一致性。
const ADMIN_IDS = new Set(['legacy-member-023', 'legacy-member-001'])

async function resolveSubject(db, actor, event, month) {
  const target = String(event.targetMemberId || '')
  if (target && (!ADMIN_IDS.has(actor.historicalMemberId) || actor.reviewAccess)) {
    throw new Error('仅跑团管理员可以代成员上传')
  }
  let user = actor
  let memberName = actor.wechatNickname || actor.nickname || ''
  if (target) {
    const members = await db.collection('historical_members').where({ legacyMemberKey: target }).limit(1).get()
    let member = members.data[0]
    if (!member) {
      try { member = (await db.collection('historical_members').doc(target).get()).data } catch (_) {}
    }
    if (!member) throw new Error('未找到该历史成员')
    const users = await db.collection('users').where({ historicalMemberId: target }).limit(1).get()
    user = users.data[0] || { _id: '', historicalMemberId: target, nickname: member.alias }
    memberName = user.wechatNickname || user.nickname || member.alias
  }
  if (target && ['start', 'recognize'].includes(event.action || '')) {
    const [history, settlements] = await Promise.all([
      db.collection('historical_monthly_records').where({ legacyMemberKey: target, month }).limit(1).get(),
      db.collection('monthly_settlements').where({ historicalMemberId: target, month }).limit(1).get()
    ])
    const row = history.data[0]
    if (!row || typeof row.targetKm !== 'number') throw new Error('该成员上月没有有效承诺跑量')
    if (typeof row.equivalentKm === 'number' || typeof row.fundAmount === 'number' || settlements.data.length) {
      throw new Error('该成员上月已有跑量或结算记录，请先核验')
    }
  }
  const found = await db.collection('activity_records').where({ historicalMemberId: user.historicalMemberId, month }).limit(2).get()
  if (found.data.length > 1) throw new Error('该成员本月存在重复记录，请先核验')
  const existing = found.data[0]
  const recordId = existing ? existing._id : `activity-${user._id || user.historicalMemberId}-${month}`
  const audit = {
    submissionSource: target ? 'admin_proxy' : 'member',
    submittedByUserId: actor._id,
    submittedByMemberId: actor.historicalMemberId,
    submittedByName: actor.wechatNickname || actor.nickname || actor.historicalMemberId
  }
  return { user, recordId, memberName, audit, existing, isProxy: Boolean(target) }
}

function assertCanOperate(subject, actor, action) {
  if (!subject.isProxy || action === 'get') return
  const record = subject.existing
  if (record && ['pending_admin_review', 'approved'].includes(record.reviewStatus)) {
    throw new Error('该成员已有待审核或已通过的提交，请在审核页处理')
  }
  if (record && !['cancelled', 'withdrawn', 'voided', 'recognition_failed', 'failed'].includes(record.reviewStatus) &&
      record.submittedByUserId !== actor._id) {
    throw new Error('该成员已有其他人正在处理的提交，请勿覆盖')
  }
}

module.exports = { resolveSubject, assertCanOperate }
