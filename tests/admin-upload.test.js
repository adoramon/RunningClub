const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { resolveSubject, assertCanOperate } = require('../cloudfunctions/ocr_activity_screenshot/submission-subject')
const admin = { _id: 'admin', historicalMemberId: 'legacy-member-023', nickname: '管理员' }
const member = { _id: 'user-b', historicalMemberId: 'legacy-member-002', nickname: '成员' }
function database(data) {
  return { collection(name) {
    let query = {}
    const api = {
      where(value) { query = value; return api },
      limit() { return api },
      async get() { return { data: (data[name] || []).filter(row => Object.entries(query).every(([key, value]) => row[key] === value)) } },
      doc(id) { return { async get() { return { data: (data[name] || []).find(row => row._id === id) } } } }
    }
    return api
  } }
}
async function main() {
  const month = '2026-08'
  const targetMemberId = member.historicalMemberId
  const data = {
    historical_members: [{ _id: targetMemberId, legacyMemberKey: targetMemberId, alias: '艺名' }],
    historical_monthly_records: [{ legacyMemberKey: targetMemberId, month, targetKm: 60 }],
    users: [member], activity_records: [], monthly_settlements: []
  }
  const request = { targetMemberId, action: 'start' }
  await assert.rejects(resolveSubject(database(data), member, request, month), /仅跑团管理员/)
  await assert.rejects(resolveSubject(database(data), { ...admin, reviewAccess: true }, request, month), /仅跑团管理员/)
  await assert.rejects(resolveSubject(database(data), admin, { targetMemberId: 'missing' }, month), /未找到/)
  let result = await resolveSubject(database(data), admin, request, month)
  assert.equal(result.user._id, member._id)
  assert.equal(result.recordId, 'activity-user-b-2026-08')
  assert.equal(result.audit.submittedByUserId, admin._id)
  assert.equal(result.audit.submissionSource, 'admin_proxy')
  data.users = []
  result = await resolveSubject(database(data), admin, request, month)
  assert.equal(result.user._id, '')
  assert.equal(result.recordId, 'activity-legacy-member-002-2026-08')
  data.activity_records = [{ _id: result.recordId, historicalMemberId: targetMemberId, month, reviewStatus: 'pending_member_confirmation', submittedByUserId: admin._id }]
  data.users = [member]
  result = await resolveSubject(database(data), member, {}, month)
  assert.equal(result.recordId, 'activity-legacy-member-002-2026-08', '认领后继续使用代传记录')
  result = await resolveSubject(database(data), admin, request, month)
  assert.doesNotThrow(() => assertCanOperate(result, admin, 'judge'))
  assert.throws(() => assertCanOperate({ ...result, existing: { reviewStatus: 'pending_admin_review' } }, admin, 'start'), /已有待审核/)
  assert.throws(() => assertCanOperate({ ...result, existing: { reviewStatus: 'approved' } }, admin, 'confirm'), /已有待审核/)
  assert.throws(() => assertCanOperate(result, { ...admin, _id: 'other-admin' }, 'start'), /其他人/)
  data.monthly_settlements = [{ historicalMemberId: targetMemberId, month, status: 'leave' }]
  await assert.rejects(resolveSubject(database(data), admin, request, month), /已有跑量或结算/)
  data.monthly_settlements = []
  data.historical_monthly_records[0].equivalentKm = 40
  await assert.rejects(resolveSubject(database(data), admin, request, month), /已有跑量或结算/)
  for (const name of ['submit_activity_screenshot', 'generate_monthly_evaluation']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '../cloudfunctions', name, 'submission-subject.js'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '../cloudfunctions/ocr_activity_screenshot/submission-subject.js'), 'utf8'))
  }
  console.log('管理员代传权限、成员归属、认领衔接与防覆盖测试通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
