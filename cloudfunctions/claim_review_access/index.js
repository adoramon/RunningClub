const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const normalize = value => String(value || '').trim()

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const code = normalize(event.accessCode)
  const wechatNickname = normalize(event.wechatNickname)
  const configuredCode = String(process.env.RUNNING_CLUB_REVIEW_ACCESS_CODE || '')
  if (!configuredCode) throw new Error('审核体验入口尚未配置，请联系管理员')
  if (!wechatNickname || wechatNickname.length > 20) throw new Error('请授权有效的微信昵称')
  const users = db.collection('users')
  const result = await users.where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user) throw new Error('用户身份初始化失败，请重新打开小程序')
  if (user.historicalMemberId) throw new Error('正式跑团成员无需使用审核体验入口')
  if (user.reviewAccess) return { userId: user._id, reviewAccess: true, alreadyGranted: true }
  if (code !== configuredCode) {
    await users.doc(user._id).update({ data: { reviewAccessFailedAt: db.serverDate(), reviewAccessFailureCount: Number(user.reviewAccessFailureCount || 0) + 1, updatedAt: db.serverDate() } })
    throw new Error('审核码无效')
  }
  await users.doc(user._id).update({ data: { reviewAccess: true, reviewWechatNickname: wechatNickname, reviewAccessGrantedAt: db.serverDate(), updatedAt: db.serverDate() } })
  return { userId: user._id, reviewAccess: true, alreadyGranted: false }
}
