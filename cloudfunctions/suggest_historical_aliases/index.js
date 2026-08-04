const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function lcsLength(left, right) {
  const rows = Array(right.length + 1).fill(0)
  for (const a of left) {
    let previous = 0
    for (let index = 1; index <= right.length; index += 1) {
      const stored = rows[index]
      rows[index] = a === right[index - 1] ? previous + 1 : Math.max(rows[index], rows[index - 1])
      previous = stored
    }
  }
  return rows[right.length]
}

exports.main = async event => {
  const nickname = String(event.nickname || '').trim()
  if (!nickname) throw new Error('请先填写微信昵称')
  const { data } = await db.collection('historical_members').field({ alias: true, normalizedAlias: true, claimStatus: true }).get()
  return data
    .filter(item => item.claimStatus === 'unclaimed')
    .map(item => ({ alias: item.alias, score: lcsLength(nickname, item.normalizedAlias) / Math.max(nickname.length, item.normalizedAlias.length) }))
    .filter(item => item.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias, 'zh-CN'))
    .slice(0, 3)
}
