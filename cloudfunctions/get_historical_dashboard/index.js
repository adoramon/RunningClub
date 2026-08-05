const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100
const formatKm = value => isNumber(value) ? String(round(value)) : '—'
const formatMoney = value => Number(value || 0).toFixed(2)

function monthOffset(offset) {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function deriveRecords(records) {
  let failureStreak = 0
  return [...records].sort((a, b) => a.month.localeCompare(b.month)).map(record => {
    if (!isNumber(record.targetKm)) {
      failureStreak = 0
      return { ...record, calculatedKm: null, actualSource: 'historical_inactive', failureStreak: 0 }
    }
    if (isNumber(record.equivalentKm)) {
      if (record.equivalentKm >= record.targetKm) failureStreak = 0
      else failureStreak += 1
      return { ...record, calculatedKm: round(record.equivalentKm), actualSource: 'recorded', failureStreak }
    }
    if (isNumber(record.fundAmount)) {
      failureStreak += 1
      const calculatedKm = round(Math.max(0, record.targetKm - record.fundAmount / (3 * failureStreak)))
      return { ...record, calculatedKm, actualSource: 'inferred_from_fund', failureStreak }
    }
    return { ...record, calculatedKm: null, actualSource: 'pending', failureStreak }
  })
}

function actualDescription(record) {
  if (isNumber(record.calculatedKm)) return { actualText: formatKm(record.calculatedKm), actualNote: record.actualSource === 'inferred_from_fund' ? '按公积金倒算' : '实际跑量' }
  if (isNumber(record.fundAmount)) return { actualText: '—', actualNote: `公积金 ${record.fundAmount} 元` }
  if (!isNumber(record.targetKm)) return { actualText: '—', actualNote: '当月未参与统计' }
  return { actualText: '—', actualNote: '未记录实际跑量' }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const userResult = await users.where({ openid: OPENID }).limit(1).get()
  const user = userResult.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')

  const [memberResult, summaryRecordsResult, allMembersResult, ownRecordsResult, linkedUsersResult, ledgerResult] = await Promise.all([
    db.collection('historical_members').doc(user.historicalMemberId).get(),
    db.collection('historical_monthly_records').where({ month: monthOffset(-1) }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId }).orderBy('month', 'desc').limit(100).get(),
    db.collection('users').field({ historicalMemberId: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get(),
    db.collection('fund_ledger').where({ status: 'confirmed' }).limit(100).get()
  ])

  const summaryMonth = monthOffset(-1)
  const currentMonth = monthOffset(0)
  const membersByKey = new Map(allMembersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
  const linkedUsersByMemberId = new Map(linkedUsersResult.data.filter(linkedUser => linkedUser.historicalMemberId).map(linkedUser => [linkedUser.historicalMemberId, linkedUser]))
  const memberIdsNeedingDerivation = new Set(summaryRecordsResult.data.filter(record => isNumber(record.fundAmount)).map(record => record.legacyMemberKey))
  memberIdsNeedingDerivation.add(user.historicalMemberId)
  const histories = new Map([[user.historicalMemberId, ownRecordsResult.data]])
  await Promise.all([...memberIdsNeedingDerivation].filter(memberId => memberId !== user.historicalMemberId).map(async memberId => {
    const result = await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'desc').limit(100).get()
    histories.set(memberId, result.data)
  }))
  const derivedByRecordKey = new Map()
  histories.forEach(history => deriveRecords(history).forEach(record => derivedByRecordKey.set(record.legacyRecordKey, record)))
  const memberRow = rawRecord => {
    const record = derivedByRecordKey.get(rawRecord.legacyRecordKey) || { ...rawRecord, calculatedKm: rawRecord.equivalentKm, actualSource: 'recorded' }
    const member = membersByKey.get(record.legacyMemberKey)
    const linkedUser = linkedUsersByMemberId.get(record.legacyMemberKey)
    const actual = actualDescription(record)
    const targetKm = isNumber(record.targetKm) ? round(record.targetKm) : null
    const actualKm = isNumber(record.calculatedKm) ? round(record.calculatedKm) : null
    return {
      memberId: record.legacyMemberKey,
      alias: member ? member.alias : '未知成员',
      displayName: linkedUser ? (linkedUser.wechatNickname || linkedUser.nickname || member.alias) : member.alias,
      avatarFileId: linkedUser ? (linkedUser.avatarFileId || '') : '',
      registered: Boolean(linkedUser),
      targetKm,
      targetText: formatKm(record.targetKm),
      actualKm,
      actualSource: record.actualSource,
      completionPct: targetKm ? Math.min(100, Math.round((actualKm || 0) / targetKm * 100)) : 0,
      submitted: actualKm !== null,
      ...actual,
      isMe: record.legacyMemberKey === user.historicalMemberId
    }
  }
  const summaryRows = summaryRecordsResult.data.map(memberRow).filter(row => row.targetKm !== null).sort((a, b) => {
    if (a.actualKm === null && b.actualKm !== null) return 1
    if (a.actualKm !== null && b.actualKm === null) return -1
    return (b.actualKm || 0) - (a.actualKm || 0)
  })

  const totalTarget = round(summaryRows.reduce((sum, row) => sum + (row.targetKm || 0), 0))
  const totalActual = round(summaryRows.reduce((sum, row) => sum + (row.actualKm || 0), 0))
  const ranking = summaryRows
  const hasOpeningBalance = ledgerResult.data.some(entry => entry.entryType === 'opening_balance')
  const fundBalance = round(ledgerResult.data.reduce((sum, entry) => sum + (isNumber(entry.amount) ? entry.amount : 0), hasOpeningBalance ? 0 : -257))
  const fundAddedLastMonth = round(ledgerResult.data.filter(entry => entry.month === summaryMonth && entry.entryType === 'member_payment' && isNumber(entry.amount) && entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0))
  const ownHistory = deriveRecords(ownRecordsResult.data)
  const inherited = ownHistory.find(record => record.month === currentMonth && isNumber(record.targetKm)) || ownHistory.find(record => isNumber(record.targetKm)) || null
  const actualHistory = ownHistory.filter(record => isNumber(record.calculatedKm))
  const profile = {
    alias: memberResult.data.alias,
    inheritedTargetKm: inherited ? round(inherited.targetKm) : null,
    inheritedFromMonth: inherited ? inherited.month : null,
    averageActualKm: actualHistory.length ? round(actualHistory.reduce((sum, record) => sum + record.calculatedKm, 0) / actualHistory.length) : null,
    bestActualKm: actualHistory.length ? round(Math.max(...actualHistory.map(record => record.calculatedKm))) : null,
    history: ownHistory.map(record => ({
      month: record.month,
      targetText: formatKm(record.targetKm),
      participationStatus: isNumber(record.targetKm) ? 'active' : 'historical_inactive',
      ...actualDescription(record)
    }))
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
    fundBalance,
    fundBalanceText: formatMoney(fundBalance),
    fundAddedLastMonth,
    fundAddedLastMonthText: formatMoney(fundAddedLastMonth),
    members: summaryRows,
    ranking,
    myLastMonthSubmitted: Boolean(ranking.find(row => row.isMe && row.submitted)),
    profile
  }
}
