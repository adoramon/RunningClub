const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const avatarFileId = String(event.avatarFileId || '')
  if (!avatarFileId.startsWith('cloud://')) throw new Error('头像文件无效')
  const users = db.collection('users')
  const result = await users.where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || (!user.historicalMemberId && !user.reviewAccess)) throw new Error('请先完成身份验证')
  await users.doc(user._id).update({ data: { avatarFileId, updatedAt: db.serverDate() } })
  return { avatarFileId }
}
