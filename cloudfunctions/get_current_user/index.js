const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const existing = await users.where({ openid: OPENID }).limit(1).get()
  let user = existing.data[0]

  if (!user) {
    const now = db.serverDate()
    const created = await users.add({
      data: { openid: OPENID, nickname: '', avatarFileId: '', createdAt: now, updatedAt: now }
    })
    user = { _id: created._id, openid: OPENID, nickname: '', avatarFileId: '' }
  }

  const memberships = await db.collection('club_members').where({ userId: user._id, status: 'active' }).get()
  return {
    user: { _id: user._id, nickname: user.nickname, avatarFileId: user.avatarFileId, historicalMemberId: user.historicalMemberId || null, reviewAccess: Boolean(user.reviewAccess) },
    memberships: memberships.data
  }
}
