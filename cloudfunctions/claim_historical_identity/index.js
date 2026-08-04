const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const normalizeAlias = value => String(value || '').trim()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const alias = normalizeAlias(event.alias)
  if (!alias || alias.length > 12) throw new Error('请输入历史台账中的艺名')
  const users = db.collection('users')
  const userResult = await users.where({ openid: OPENID }).limit(1).get()
  if (!userResult.data[0]) throw new Error('用户身份初始化失败，请重新打开小程序')
  const user = userResult.data[0]
  const members = db.collection('historical_members')

  if (user.historicalMemberId) {
    const current = await members.doc(user.historicalMemberId).get()
    if (current.data.normalizedAlias !== alias) throw new Error('当前微信号已绑定其他艺名')
    return { userId: user._id, alias: current.data.alias, historicalMemberId: current.data._id, alreadyClaimed: true }
  }

  const match = await members.where({ normalizedAlias: alias }).limit(1).get()
  if (!match.data[0]) throw new Error('艺名不在历史成员名单中')
  const member = match.data[0]
  const claimed = await members.where({ _id: member._id, claimStatus: 'unclaimed' }).update({ data: { claimStatus: 'claimed', claimedUserId: user._id, claimedAt: db.serverDate() } })
  if (!claimed.stats.updated) throw new Error('该艺名已被其他微信号绑定')

  await users.doc(user._id).update({ data: { historicalMemberId: member._id, nickname: member.alias, updatedAt: db.serverDate() } })
  return { userId: user._id, alias: member.alias, historicalMemberId: member._id, alreadyClaimed: false }
}
