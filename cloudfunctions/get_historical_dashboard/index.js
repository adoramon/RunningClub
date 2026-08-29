const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
let lifetimeCache = { expiresAt: 0, value: null }
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])

const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100
const formatKm = value => isNumber(value) ? String(round(value)) : '—'
const formatMoney = value => Number(value || 0).toFixed(2)
const formatTotalKm = value => Number(round(value)).toLocaleString('en-US', { maximumFractionDigits: 2 })
const formatRatio = value => value >= 10 ? value.toFixed(1) : value.toFixed(2)

// 云存储默认按文件创建者保护访问权限。不能把 cloud:// 文件 ID 直接交给其他成员的
// 小程序客户端展示；由可信云函数换取临时链接，头像才会对跑团成员正常可见。
async function attachTemporaryAvatarUrls(items) {
  const fileIds = [...new Set(items.map(item => item.avatarFileId).filter(Boolean))]
  if (!fileIds.length) return items
  try {
    const result = await cloud.getTempFileURL({ fileList: fileIds })
    const urlsByFileId = new Map((result.fileList || [])
      .filter(item => item.status === 0 && item.tempFileURL)
      .map(item => [item.fileID, item.tempFileURL]))
    return items.map(item => ({ ...item, avatarUrl: urlsByFileId.get(item.avatarFileId) || '' }))
  } catch (error) {
    console.warn('头像临时链接生成失败', error)
    return items.map(item => ({ ...item, avatarUrl: '' }))
  }
}

function completionTone(percent) {
  if (percent > 120) return { toneClass: 'tone-deep-green', ringColor: '#166C43' }
  if (percent >= 100) return { toneClass: 'tone-light-green', ringColor: '#65A36F' }
  if (percent >= 80) return { toneClass: 'tone-deep-yellow', ringColor: '#D9A933' }
  if (percent >= 50) return { toneClass: 'tone-light-yellow', ringColor: '#E7C668' }
  if (percent >= 10) return { toneClass: 'tone-red', ringColor: '#D85C4F' }
  return { toneClass: 'tone-deep-red', ringColor: '#A63A34' }
}

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
      return { ...record, calculatedKm: isNumber(record.equivalentKm) ? round(record.equivalentKm) : null, actualSource: isNumber(record.equivalentKm) ? 'recorded_without_target' : 'historical_inactive', failureStreak: 0 }
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
  if (record.adminDisposition === 'leave') return { actualText: '—', actualNote: '提前请假', actualNoteClass: 'status-muted' }
  if (isNumber(record.calculatedKm)) {
    if (!isNumber(record.targetKm)) return { actualText: formatKm(record.calculatedKm), actualNote: '未纳入团队统计', actualNoteClass: 'status-muted' }
    if (record.calculatedKm >= record.targetKm) return { actualText: formatKm(record.calculatedKm), actualNote: '已达成目标', actualNoteClass: 'status-completed' }
    if (isNumber(record.fundAmount)) return { actualText: formatKm(record.calculatedKm), actualNote: '已缴纳公积金', actualNoteClass: 'status-paid' }
    return { actualText: formatKm(record.calculatedKm), actualNote: '请尽快缴纳公积金', actualNoteClass: 'status-action' }
  }
  if (isNumber(record.fundAmount)) return { actualText: '—', actualNote: '已缴纳公积金', actualNoteClass: 'status-paid' }
  if (!isNumber(record.targetKm)) return { actualText: '—', actualNote: '当月未参与统计', actualNoteClass: 'status-muted' }
  return { actualText: '—', actualNote: '请尽快提交跑量数据', actualNoteClass: 'status-action' }
}

function hasParticipationData(record) {
  return isNumber(record.targetKm) || isNumber(record.equivalentKm) || isNumber(record.fundAmount)
}

function profileHistoryStatus(record) {
  if (!isNumber(record.calculatedKm) && !isNumber(record.fundAmount)) return { actualText: '—', statusLabel: '提前请假', statusTop: '提前', statusBottom: '请假', statusClass: 'status-leave' }
  if (isNumber(record.fundAmount)) return { actualText: formatKm(record.calculatedKm), statusLabel: '已缴基金', statusTop: '已缴', statusBottom: '基金', statusClass: 'status-fund' }
  if (isNumber(record.calculatedKm) && (!isNumber(record.targetKm) || record.calculatedKm >= record.targetKm)) return { actualText: formatKm(record.calculatedKm), statusLabel: '达成目标', statusTop: '达成', statusBottom: '目标', statusClass: 'status-achieved' }
  return { actualText: formatKm(record.calculatedKm), statusLabel: '已缴基金', statusTop: '已缴', statusBottom: '基金', statusClass: 'status-fund' }
}

function calendarRingMeta(record, statusClass) {
  const actualKm = isNumber(record.calculatedKm) ? record.calculatedKm : 0
  const completionPct = isNumber(record.targetKm) && record.targetKm > 0 ? Math.round(actualKm / record.targetKm * 100) : 0
  const ringColor = statusClass === 'status-achieved' ? '#3E9962' : statusClass === 'status-fund' ? '#D3A12A' : '#D67A3B'
  return {
    completionPct,
    ringTextClass: completionPct >= 100 ? 'ring-text-wide' : '',
    ringStyle: `background:conic-gradient(${ringColor} ${Math.min(100, completionPct)}%,rgba(255,255,255,.7) 0);`
  }
}

function buildHistoryYears(history) {
  if (!history.length) return []
  const recordsByMonth = new Map(history.map(record => [record.month, record]))
  const firstYear = Number(history[0].month.slice(0, 4))
  const lastYear = Number(history[history.length - 1].month.slice(0, 4))
  const years = []
  for (let year = lastYear; year >= firstYear; year -= 1) {
    const months = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1
      const month = `${year}-${String(monthNumber).padStart(2, '0')}`
      const record = recordsByMonth.get(month)
      return record
        ? { ...record, monthNumber, monthShort: `${String(year).slice(2)}/${String(monthNumber).padStart(2, '0')}` }
        : { month, monthNumber, monthShort: `${String(year).slice(2)}/${String(monthNumber).padStart(2, '0')}`, placeholder: true }
    })
    years.push({ year, months })
  }
  return years
}

function buildRecentTrend(joinedHistory) {
  const recordsByMonth = new Map(joinedHistory.map(record => [record.month, record]))
  return Array.from({ length: 24 }, (_, index) => {
    const month = monthOffset(index - 24)
    const record = recordsByMonth.get(month)
    return {
      month,
      label: `${month.slice(2, 4)}/${month.slice(5, 7)}`,
      actualKm: record && isNumber(record.calculatedKm) ? round(record.calculatedKm) : 0
    }
  })
}

function buildMemberProfile(member, linkedUser, rawRecords) {
  const currentMonth = monthOffset(0)
  const chronologicalHistory = deriveRecords(rawRecords).filter(record => record.month < currentMonth)
  const firstParticipationIndex = chronologicalHistory.findIndex(hasParticipationData)
  const joinedHistory = firstParticipationIndex >= 0 ? chronologicalHistory.slice(firstParticipationIndex) : []
  const actualHistory = joinedHistory.filter(record => isNumber(record.calculatedKm))
  const latestTarget = [...joinedHistory].reverse().find(record => isNumber(record.targetKm)) || null
  const profileChronologicalHistory = joinedHistory.map(record => {
    const status = profileHistoryStatus(record)
    return {
      month: record.month,
      targetText: formatKm(record.targetKm),
      participationStatus: isNumber(record.targetKm) ? 'active' : 'historical_inactive',
      ...status,
      ...calendarRingMeta(record, status.statusClass)
    }
  })
  const history = [...profileChronologicalHistory].reverse()
  return {
    memberId: member.legacyMemberKey || member._id,
    alias: member.alias,
    displayName: linkedUser ? (linkedUser.wechatNickname || linkedUser.nickname || member.alias) : member.alias,
    avatarFileId: linkedUser ? (linkedUser.avatarFileId || '') : '',
    registered: Boolean(linkedUser),
    latestTargetKm: latestTarget ? round(latestTarget.targetKm) : null,
    latestTargetMonth: latestTarget ? latestTarget.month : null,
    averageActualKm: actualHistory.length ? round(actualHistory.reduce((sum, record) => sum + record.calculatedKm, 0) / actualHistory.length) : null,
    bestActualKm: actualHistory.length ? round(Math.max(...actualHistory.map(record => record.calculatedKm))) : null,
    totalActualKm: round(actualHistory.reduce((sum, record) => sum + record.calculatedKm, 0)),
    totalFundAmount: round(joinedHistory.reduce((sum, record) => sum + (isNumber(record.fundAmount) ? record.fundAmount : 0), 0)),
    totalFundAmountText: formatMoney(joinedHistory.reduce((sum, record) => sum + (isNumber(record.fundAmount) ? record.fundAmount : 0), 0)),
    recentTrend: buildRecentTrend(joinedHistory),
    history,
    historyYears: buildHistoryYears(profileChronologicalHistory)
  }
}

function buildLifetimeStats(records) {
  const counted = records.filter(record => isNumber(record.targetKm) && isNumber(record.calculatedKm))
  const activeMonths = records.filter(record => isNumber(record.targetKm)).map(record => record.month).sort()
  const totalKm = round(counted.reduce((sum, record) => sum + record.calculatedKm, 0))
  const comparisons = [
    { label: '相当于绕赤道', value: `${formatRatio(totalKm / 40075)} 圈`, note: '赤道约 40,075 km' },
    { label: '相当于北京—上海往返', value: `${formatRatio(totalKm / 2400)} 趟`, note: '按往返约 2,400 km' },
    { label: '相当于北京—广州往返', value: `${formatRatio(totalKm / 4200)} 趟`, note: '按往返约 4,200 km' },
    { label: '相当于北京—拉萨往返', value: `${formatRatio(totalKm / 7500)} 趟`, note: '按往返约 7,500 km' }
  ]
  const startMonth = activeMonths[0]
  const [startYear, startMonthNumber] = startMonth.split('-').map(Number)
  const [currentYear, currentMonthNumber] = monthOffset(0).split('-').map(Number)
  const elapsedMonths = Math.max(0, (currentYear - startYear) * 12 + currentMonthNumber - startMonthNumber)
  const operatingText = `已运营 ${Math.floor(elapsedMonths / 12)}年${elapsedMonths % 12}个月`
  return { totalKm, totalKmText: formatTotalKm(totalKm), operatingText, comparisons }
}

async function getLifetimeStats() {
  if (lifetimeCache.value && Date.now() < lifetimeCache.expiresAt) return lifetimeCache.value
  const membersResult = await db.collection('historical_members').limit(100).get()
  const histories = await Promise.all(membersResult.data.map(async member => {
    const memberId = member.legacyMemberKey || member._id
    const result = await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'desc').limit(100).get()
    return result.data
  }))
  const value = buildLifetimeStats(histories.flatMap(deriveRecords))
  lifetimeCache = { value, expiresAt: Date.now() + 30 * 60 * 1000 }
  return value
}

async function getMemberProfile(memberId) {
  if (!memberId || typeof memberId !== 'string') throw new Error('成员标识无效')
  const [memberResult, recordsResult, linkedUserResult] = await Promise.all([
    db.collection('historical_members').doc(memberId).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'desc').limit(100).get(),
    db.collection('users').where({ historicalMemberId: memberId }).field({ nickname: true, wechatNickname: true, avatarFileId: true }).limit(1).get()
  ])
  const member = memberResult.data
  if (!member) throw new Error('未找到该成员的历史记录')
  const linkedUser = linkedUserResult.data[0]
  return buildMemberProfile(member, linkedUser, recordsResult.data)
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const userResult = await users.where({ openid: OPENID }).limit(1).get()
  const user = userResult.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  if (event.mode === 'lifetime') return getLifetimeStats()
  if (event.mode === 'profile') {
    const memberId = event.memberId || user.historicalMemberId
    const [profile] = await attachTemporaryAvatarUrls([await getMemberProfile(memberId)])
    const evaluationMonth = monthOffset(-1)
    let monthlyEvaluation = null
    if (memberId === user.historicalMemberId) {
      try {
        const savedEvaluation = (await db.collection('activity_records').doc(`activity-${user._id}-${evaluationMonth}`).get()).data.memberEvaluation
        monthlyEvaluation = savedEvaluation ? { ...savedEvaluation, source: 'confirmed_submission' } : null
      } catch (_) {}
    }
    if (!monthlyEvaluation) {
      try {
        const historicalEvaluation = (await db.collection('monthly_evaluations').doc(`evaluation-${memberId}-${evaluationMonth}`).get()).data
        monthlyEvaluation = historicalEvaluation && historicalEvaluation.evaluation ? { ...historicalEvaluation.evaluation, source: 'historical_import' } : null
      } catch (_) {}
    }
    return { ...profile, isMe: memberId === user.historicalMemberId, monthlyEvaluation }
  }

  const summaryMonth = monthOffset(-1)
  const [memberResult, summaryRecordsResult, allMembersResult, ownRecordsResult, linkedUsersResult, ledgerResult, pendingReviewResult, settlementsResult, monthActivitiesResult] = await Promise.all([
    db.collection('historical_members').doc(user.historicalMemberId).get(),
    db.collection('historical_monthly_records').where({ month: summaryMonth }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId }).orderBy('month', 'desc').limit(100).get(),
    db.collection('users').field({ historicalMemberId: true, nickname: true, wechatNickname: true, avatarFileId: true }).limit(100).get(),
    db.collection('fund_ledger').where({ status: 'confirmed' }).limit(100).get(),
    ADMIN_MEMBER_IDS.has(user.historicalMemberId) ? db.collection('activity_records').where({ reviewStatus: 'pending_admin_review' }).limit(100).get() : Promise.resolve({ data: [] }),
    db.collection('monthly_settlements').where({ month: summaryMonth }).limit(100).get(),
    db.collection('activity_records').where({ month: summaryMonth }).limit(100).get()
  ])

  const currentMonth = monthOffset(0)
  const membersByKey = new Map(allMembersResult.data.map(member => [member.legacyMemberKey || member._id, member]))
  const linkedUsersByMemberId = new Map(linkedUsersResult.data.filter(linkedUser => linkedUser.historicalMemberId).map(linkedUser => [linkedUser.historicalMemberId, linkedUser]))
  const memberIdsNeedingDerivation = new Set(summaryRecordsResult.data.filter(record => isNumber(record.fundAmount)).map(record => record.legacyMemberKey))
  const approvedActivitiesByMemberId = new Map(monthActivitiesResult.data.filter(record => record.reviewStatus === 'approved' && isNumber(record.adminApprovedEquivalentKm === undefined ? record.memberConfirmedEquivalentKm : record.adminApprovedEquivalentKm)).map(record => [record.historicalMemberId, record]))
  approvedActivitiesByMemberId.forEach((_, memberId) => memberIdsNeedingDerivation.add(memberId))
  memberIdsNeedingDerivation.add(user.historicalMemberId)
  const histories = new Map([[user.historicalMemberId, ownRecordsResult.data]])
  await Promise.all([...memberIdsNeedingDerivation].filter(memberId => memberId !== user.historicalMemberId).map(async memberId => {
    const result = await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'desc').limit(100).get()
    histories.set(memberId, result.data)
  }))
  const derivedByRecordKey = new Map()
  histories.forEach(history => deriveRecords(history).forEach(record => {
    derivedByRecordKey.set(record.legacyRecordKey, record)
  }))
  const settlementsByMemberId = new Map(settlementsResult.data.map(record => [record.historicalMemberId, record]))
  const memberRow = rawRecord => {
    let record = derivedByRecordKey.get(rawRecord.legacyRecordKey) || { ...rawRecord, calculatedKm: rawRecord.equivalentKm, actualSource: 'recorded' }
    const settlement = settlementsByMemberId.get(record.legacyMemberKey)
    if (settlement && settlement.status === 'fund_paid') record = { ...record, calculatedKm: isNumber(settlement.equivalentKm) ? settlement.equivalentKm : 0, fundAmount: settlement.fundDue, actualSource: 'admin_fund' }
    if (settlement && settlement.status === 'leave') record = { ...record, calculatedKm: null, adminDisposition: 'leave', actualSource: 'admin_leave' }
    const approvedActivity = approvedActivitiesByMemberId.get(record.legacyMemberKey)
    if (!settlement && approvedActivity) record = { ...record, calculatedKm: round(approvedActivity.adminApprovedEquivalentKm === undefined ? approvedActivity.memberConfirmedEquivalentKm : approvedActivity.adminApprovedEquivalentKm), actualSource: 'approved_activity', activityApproved: true }
    const member = membersByKey.get(record.legacyMemberKey)
    const linkedUser = linkedUsersByMemberId.get(record.legacyMemberKey)
    const targetKm = isNumber(record.targetKm) ? round(record.targetKm) : null
    const actualKm = isNumber(record.calculatedKm) ? round(record.calculatedKm) : null
    const completionPct = targetKm ? Math.round((actualKm || 0) / targetKm * 100) : 0
    const tone = completionTone(completionPct)
    const actual = actualDescription(record)
    const hasUnpaidShortfall = targetKm !== null && actualKm !== null && actualKm < targetKm && !isNumber(record.fundAmount) && record.adminDisposition !== 'leave'
    const failureStreak = hasUnpaidShortfall ? Math.max(1, Number(record.failureStreak || 0) + (record.activityApproved ? 1 : 0)) : 0
    const shortfallKm = hasUnpaidShortfall ? round(targetKm - actualKm) : 0
    const fundDue = hasUnpaidShortfall ? round(shortfallKm * 3 * failureStreak) : 0
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
      fundAmount: isNumber(record.fundAmount) ? record.fundAmount : 0,
      completionPct,
      ringPct: Math.min(100, completionPct),
      ringStyle: `background:conic-gradient(${tone.ringColor} ${Math.min(100, completionPct)}%,#E7EDE8 0);`,
      ...tone,
      submitted: actualKm !== null,
      shortfallKm,
      failureStreak,
      fundDue,
      fundDueText: formatMoney(fundDue),
      ...actual,
      isMe: record.legacyMemberKey === user.historicalMemberId
    }
  }
  const summaryRows = summaryRecordsResult.data.map(memberRow).filter(row => row.targetKm !== null).sort((a, b) => {
    if (b.completionPct !== a.completionPct) return b.completionPct - a.completionPct
    return (b.actualKm || 0) - (a.actualKm || 0)
  })

  const totalTarget = round(summaryRows.reduce((sum, row) => sum + (row.targetKm || 0), 0))
  const totalActual = round(summaryRows.reduce((sum, row) => sum + (row.actualKm || 0), 0))
  const ranking = await attachTemporaryAvatarUrls(summaryRows)
  const hasOpeningBalance = ledgerResult.data.some(entry => entry.entryType === 'opening_balance')
  const fundBalance = round(ledgerResult.data.reduce((sum, entry) => sum + (isNumber(entry.amount) ? entry.amount : 0), hasOpeningBalance ? 0 : -257))
  const historicalFundLastMonth = summaryRecordsResult.data.reduce((sum, record) => sum + (isNumber(record.fundAmount) ? record.fundAmount : 0), 0)
  const ledgerFundLastMonth = ledgerResult.data.filter(entry => entry.month === summaryMonth && entry.entryType === 'member_payment').reduce((sum, entry) => sum + (isNumber(entry.amount) ? entry.amount : 0), 0)
  const fundAddedLastMonth = round(historicalFundLastMonth + ledgerFundLastMonth)
  const [profile] = await attachTemporaryAvatarUrls([buildMemberProfile(memberResult.data, user, ownRecordsResult.data)])
  const activeActivityMemberIds = new Set(monthActivitiesResult.data.filter(record => !['cancelled', 'voided', 'recognition_failed', 'failed'].includes(record.reviewStatus)).map(record => record.historicalMemberId))
  const settledMemberIds = new Set(settlementsResult.data.map(record => record.historicalMemberId))
  const missingSubmissionCount = summaryRecordsResult.data.filter(record => isNumber(record.targetKm) && !isNumber(record.equivalentKm) && !isNumber(record.fundAmount) && !settledMemberIds.has(record.legacyMemberKey) && !activeActivityMemberIds.has(record.legacyMemberKey)).length
  const myPendingFundPayment = ranking.find(row => row.isMe && row.fundDue > 0) || null

  const completionPct = totalTarget ? Math.round(totalActual / totalTarget * 100) : 0
  const summaryTone = completionTone(completionPct)
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
    completionPct,
    summaryToneClass: summaryTone.toneClass,
    summaryRingStyle: `background:conic-gradient(#8DE0A8 ${Math.min(100, completionPct)}%,rgba(255,255,255,.18) 0);`,
    fundBalance,
    fundBalanceText: formatMoney(fundBalance),
    fundAddedLastMonth,
    fundAddedLastMonthText: formatMoney(fundAddedLastMonth),
    members: summaryRows,
    ranking,
    myLastMonthSubmitted: Boolean(ranking.find(row => row.isMe && row.submitted)),
    myPendingFundPayment,
    isAdmin: ADMIN_MEMBER_IDS.has(user.historicalMemberId),
    pendingReviewCount: pendingReviewResult.data.length,
    missingSubmissionCount,
    profile
  }
}
