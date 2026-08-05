const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100
const formatKm = value => isNumber(value) ? String(round(value)) : '—'

function monthOffset(offset) {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function actualDescription(record) {
  if (isNumber(record.equivalentKm)) return { actualText: formatKm(record.equivalentKm), actualNote: '实际跑量' }
  if (isNumber(record.fundAmount)) return { actualText: '—', actualNote: `公积金 ${record.fundAmount} 元` }
  return { actualText: '—', actualNote: '未记录实际跑量' }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const userResult = await users.where({ openid: OPENID }).limit(1).get()
  const user = userResult.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')

  const [memberResult, summaryRecordsResult, allMembersResult, ownRecordsResult] = await Promise.all([
    db.collection('historical_members').doc(user.historicalMemberId).get(),
    db.collection('historical_monthly_records').where({ month: monthOffset(-1) }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId }).orderBy('month', 'desc').limit(100).get()
  ])

  const summaryMonth = monthOffset(-1)
  const currentMonth = monthOffset(0)
  const membersByKey = new Map(allMembersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
  const summaryRows = summaryRecordsResult.data.map(record => {
    const member = membersByKey.get(record.legacyMemberKey)
    const actual = actualDescription(record)
    return {
      memberId: record.legacyMemberKey,
      alias: member ? member.alias : '未知成员',
      targetKm: isNumber(record.targetKm) ? round(record.targetKm) : null,
      targetText: formatKm(record.targetKm),
      actualKm: isNumber(record.equivalentKm) ? round(record.equivalentKm) : null,
      ...actual,
      isMe: record.legacyMemberKey === user.historicalMemberId
    }
  }).filter(row => row.targetKm !== null).sort((a, b) => {
    if (a.actualKm === null && b.actualKm !== null) return 1
    if (a.actualKm !== null && b.actualKm === null) return -1
    return (b.actualKm || 0) - (a.actualKm || 0)
  })

  const totalTarget = round(summaryRows.reduce((sum, row) => sum + (row.targetKm || 0), 0))
  const totalActual = round(summaryRows.reduce((sum, row) => sum + (row.actualKm || 0), 0))
  const ownHistory = ownRecordsResult.data.filter(record => isNumber(record.targetKm) || isNumber(record.equivalentKm) || isNumber(record.fundAmount))
  const inherited = ownHistory.find(record => record.month === currentMonth && isNumber(record.targetKm)) || ownHistory.find(record => isNumber(record.targetKm)) || null
  const actualHistory = ownHistory.filter(record => isNumber(record.equivalentKm))
  const profile = {
    alias: memberResult.data.alias,
    inheritedTargetKm: inherited ? round(inherited.targetKm) : null,
    inheritedFromMonth: inherited ? inherited.month : null,
    averageActualKm: actualHistory.length ? round(actualHistory.reduce((sum, record) => sum + record.equivalentKm, 0) / actualHistory.length) : null,
    bestActualKm: actualHistory.length ? round(Math.max(...actualHistory.map(record => record.equivalentKm))) : null,
    history: ownHistory.map(record => ({ month: record.month, targetText: formatKm(record.targetKm), ...actualDescription(record) }))
  }

  return {
    summaryMonth,
    currentMonth,
    totalMembers: summaryRows.length,
    targetMemberCount: summaryRows.filter(row => row.targetKm !== null).length,
    actualMemberCount: summaryRows.filter(row => row.actualKm !== null).length,
    totalTarget,
    totalTargetText: formatKm(totalTarget),
    totalActual,
    totalActualText: formatKm(totalActual),
    completionPct: totalTarget ? Math.round(totalActual / totalTarget * 100) : 0,
    members: summaryRows,
    profile
  }
}
