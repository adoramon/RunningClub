const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeNickname(value) {
  const nickname = String(value || '').trim()
  if (!nickname || nickname.length > 12) throw new Error('跑团昵称需为 1–12 个字符')
  return nickname
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const nickname = normalizeNickname(event.nickname)
  const users = db.collection('users')
  const existing = await users.where({ openid: OPENID }).limit(1).get()
  const now = db.serverDate()

  if (existing.data[0]) {
    await users.doc(existing.data[0]._id).update({ data: { nickname, updatedAt: now } })
    return { _id: existing.data[0]._id, nickname }
  }

  const created = await users.add({ data: { openid: OPENID, nickname, avatarFileId: '', createdAt: now, updatedAt: now } })
  return { _id: created._id, nickname }
}
