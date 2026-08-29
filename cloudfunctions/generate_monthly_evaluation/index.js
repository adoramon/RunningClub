const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const AI_MODEL = process.env.RUNNING_CLUB_EVALUATION_MODEL || 'local-premium'
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])
const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(Number(value || 0) * 100) / 100

function previousMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function recordIdFor(userId, month) { return `activity-${userId}-${month}` }
function historicalEvaluationId(memberId, month) { return `evaluation-${memberId}-${month}` }

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  return user
}

function deriveHistoricalRecords(records) {
  let failureStreak = 0
  return [...records].sort((a, b) => a.month.localeCompare(b.month)).map(record => {
    if (!isNumber(record.targetKm)) {
      failureStreak = 0
      return { ...record, calculatedKm: isNumber(record.equivalentKm) ? round(record.equivalentKm) : null }
    }
    if (isNumber(record.equivalentKm)) {
      failureStreak = record.equivalentKm >= record.targetKm ? 0 : failureStreak + 1
      return { ...record, calculatedKm: round(record.equivalentKm), failureStreak }
    }
    if (isNumber(record.fundAmount)) {
      failureStreak += 1
      return { ...record, calculatedKm: round(Math.max(0, record.targetKm - record.fundAmount / (3 * failureStreak))), failureStreak }
    }
    return { ...record, calculatedKm: null, failureStreak }
  })
}

function requestJson(options, headers, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({ ...options, method: 'POST', headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`模型服务返回 ${response.statusCode}`))
        try { resolve(JSON.parse(text)) } catch (_) { reject(new Error('模型服务返回了无效响应')) }
      })
    })
    request.setTimeout(45000, () => request.destroy(new Error('评价生成超时')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function parseEvaluation(content) {
  const text = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed = {}
  try { parsed = JSON.parse(text) } catch (_) { parsed = { content: text } }
  const title = String(parsed.title || '本月跑步小结').replace(/[\r\n]/g, ' ').trim().slice(0, 28)
  const body = String(parsed.content || parsed.evaluation || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180)
  if (!body) throw new Error('模型没有生成有效评价')
  return { title, content: body }
}

function parseBatchEvaluations(content, allowedMemberIds) {
  const text = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed = {}
  try { parsed = JSON.parse(text) } catch (_) { throw new Error('模型没有返回有效的批量评价 JSON') }
  const items = Array.isArray(parsed.evaluations) ? parsed.evaluations : []
  const result = new Map()
  for (const item of items) {
    const memberId = String(item.memberId || '')
    if (!allowedMemberIds.has(memberId) || result.has(memberId)) continue
    const title = String(item.title || '本月跑步小结').replace(/[\r\n]/g, ' ').trim().slice(0, 28)
    const body = String(item.content || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180)
    if (body) result.set(memberId, { title, content: body })
  }
  if (!result.size) throw new Error('模型未返回可保存的批量评价')
  return result
}

async function generateEvaluation({ displayName, actualKm, targetKm, month, previousActual }) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('评价模型尚未配置，请联系管理员')
  const averageKm = previousActual.length ? round(previousActual.reduce((sum, value) => sum + value, 0) / previousActual.length) : null
  const completionPct = targetKm && targetKm > 0 ? Math.round(actualKm / targetKm * 100) : null
  const facts = { month, displayName, actualKm, targetKm, completionPct, recentAverageKm: averageKm, recentMonthsWithData: previousActual.length }
  const prompt = `你是“东成西就”跑团的活泼陪跑教练。根据以下已确认的月度数据，写一段中文阶段性运动评价。\n${JSON.stringify(facts)}\n\n要求：只根据给定事实，不编造距离、天数、健康或医学结论；语气轻松、真诚、略带俏皮，可自然使用 1-3 个表情符；肯定努力但不要羞辱未达标；若未达标，给一个小而可执行的下月建议。输出严格 JSON：{"title":"不超过12字的标题，可含emoji","content":"50到110字的一段评价"}，不输出 Markdown。`
  const body = JSON.stringify({
    model: AI_MODEL, temperature: 0.8, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: '你只输出严格 JSON。' }, { role: 'user', content: prompt }]
  })
  const base = new URL(AI_API_BASE)
  const response = await requestJson({ protocol: base.protocol, hostname: base.hostname, port: base.port, path: `${base.pathname.replace(/\/$/, '')}/chat/completions` }, {
    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
  }, body)
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
  return { ...parseEvaluation(content), month, model: AI_MODEL, generatedAt: db.serverDate() }
}

async function generateCurrentSubmissionEvaluation(user, record, month) {
  const [goalResult, historyResult] = await Promise.all([
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId, month }).limit(1).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId }).orderBy('month', 'desc').limit(24).get()
  ])
  const targetKm = goalResult.data[0] && isNumber(goalResult.data[0].targetKm) ? round(goalResult.data[0].targetKm) : null
  const previousActual = historyResult.data.filter(item => item.month < month && isNumber(item.equivalentKm)).slice(0, 6).map(item => item.equivalentKm)
  const evaluation = await generateEvaluation({ displayName: user.wechatNickname || user.nickname || '跑友', actualKm: round(record.memberConfirmedEquivalentKm), targetKm, month, previousActual })
  return { ...evaluation, basedOnRevision: Number(record.revision || 0) }
}

async function backfillHistoricalEvaluation(memberId, month) {
  const evaluationRef = db.collection('monthly_evaluations').doc(historicalEvaluationId(memberId, month))
  try {
    const existing = (await evaluationRef.get()).data
    if (existing && existing.evaluation && existing.evaluation.content) return { evaluation: existing.evaluation, cached: true }
  } catch (_) {}
  const [memberResult, historyResult, linkedUserResult] = await Promise.all([
    db.collection('historical_members').doc(memberId).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'asc').limit(100).get(),
    db.collection('users').where({ historicalMemberId: memberId }).limit(1).get()
  ])
  const history = deriveHistoricalRecords(historyResult.data)
  const current = history.find(item => item.month === month)
  if (!current || !isNumber(current.targetKm) || !isNumber(current.calculatedKm)) return { evaluation: null, reason: 'no_eligible_historical_data' }
  const linkedUser = linkedUserResult.data[0]
  const previousActual = history.filter(item => item.month < month && isNumber(item.calculatedKm)).slice(-6).map(item => item.calculatedKm)
  const member = memberResult.data
  const evaluation = await generateEvaluation({ displayName: (linkedUser && (linkedUser.wechatNickname || linkedUser.nickname)) || member.alias || '跑友', actualKm: current.calculatedKm, targetKm: current.targetKm, month, previousActual })
  const storedEvaluation = { ...evaluation, basedOnRevision: `historical-${current.legacyRecordKey || current._id}` }
  await evaluationRef.set({ data: { legacyMemberId: memberId, month, source: 'historical_import', evaluation: storedEvaluation, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  return { evaluation: storedEvaluation, cached: false }
}

async function backfillAllHistoricalEvaluations(month, requestedMemberIds = null) {
  const [monthRecordsResult, membersResult, usersResult, existingResult] = await Promise.all([
    db.collection('historical_monthly_records').where({ month }).limit(100).get(),
    db.collection('historical_members').limit(100).get(),
    db.collection('users').field({ historicalMemberId: true, nickname: true, wechatNickname: true }).limit(100).get(),
    db.collection('monthly_evaluations').where({ month }).limit(100).get()
  ])
  const existingIds = new Set(existingResult.data.filter(item => item.evaluation && item.evaluation.content).map(item => item.legacyMemberId))
  const memberById = new Map(membersResult.data.map(item => [item.legacyMemberKey || item._id, item]))
  const userByMemberId = new Map(usersResult.data.map(item => [item.historicalMemberId, item]))
  const requestedIds = Array.isArray(requestedMemberIds) ? new Set(requestedMemberIds.filter(memberId => /^legacy-member-\d{3}$/.test(String(memberId)))) : null
  const candidateIds = monthRecordsResult.data.filter(item => isNumber(item.targetKm)).map(item => item.legacyMemberKey).filter(memberId => !existingIds.has(memberId) && (!requestedIds || requestedIds.has(memberId)))
  const histories = await Promise.all(candidateIds.map(async memberId => ({ memberId, records: (await db.collection('historical_monthly_records').where({ legacyMemberKey: memberId }).orderBy('month', 'asc').limit(100).get()).data })))
  const facts = histories.map(({ memberId, records }) => {
    const history = deriveHistoricalRecords(records)
    const current = history.find(item => item.month === month)
    if (!current || !isNumber(current.targetKm) || !isNumber(current.calculatedKm)) return null
    const linkedUser = userByMemberId.get(memberId)
    const member = memberById.get(memberId)
    const previousActual = history.filter(item => item.month < month && isNumber(item.calculatedKm)).slice(-6).map(item => item.calculatedKm)
    return {
      memberId,
      displayName: (linkedUser && (linkedUser.wechatNickname || linkedUser.nickname)) || (member && member.alias) || '跑友',
      actualKm: current.calculatedKm,
      targetKm: current.targetKm,
      completionPct: Math.round(current.calculatedKm / current.targetKm * 100),
      recentAverageKm: previousActual.length ? round(previousActual.reduce((sum, value) => sum + value, 0) / previousActual.length) : null,
      recentMonthsWithData: previousActual.length,
      historicalRecordKey: current.legacyRecordKey || current._id
    }
  }).filter(Boolean)
  if (!facts.length) return { generated: 0, cached: existingIds.size, skipped: candidateIds.length }
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('评价模型尚未配置，请联系管理员')
  const promptFacts = facts.map(({ historicalRecordKey, ...fact }) => fact)
  const prompt = `你是“东成西就”跑团的活泼陪跑教练。请根据下列已核定的 2026-07 月度数据，为每位成员各写一段中文阶段性运动评价。\n${JSON.stringify(promptFacts)}\n\n硬性要求：只根据给定事实，不编造距离、天数、健康或医学结论；语气轻松、真诚、略带俏皮，可自然使用 1-3 个表情符；肯定努力但不要羞辱未达标；未达标时给一个小而可执行的下月建议。每段 content 50 到 110 字。输出严格 JSON：{"evaluations":[{"memberId":"原样保留输入 ID","title":"不超过12字的标题，可含emoji","content":"评价正文"}]}，必须包含每一个输入 memberId，不输出 Markdown。`
  const body = JSON.stringify({
    model: AI_MODEL, temperature: 0.8, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: '你只输出严格 JSON。' }, { role: 'user', content: prompt }]
  })
  const base = new URL(AI_API_BASE)
  const response = await requestJson({ protocol: base.protocol, hostname: base.hostname, port: base.port, path: `${base.pathname.replace(/\/$/, '')}/chat/completions` }, {
    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
  }, body)
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
  const evaluations = parseBatchEvaluations(content, new Set(facts.map(item => item.memberId)))
  const saved = []
  for (const fact of facts) {
    const evaluation = evaluations.get(fact.memberId)
    if (!evaluation) continue
    const storedEvaluation = { ...evaluation, month, basedOnRevision: `historical-${fact.historicalRecordKey}`, model: AI_MODEL, generatedAt: db.serverDate() }
    await db.collection('monthly_evaluations').doc(historicalEvaluationId(fact.memberId, month)).set({ data: { legacyMemberId: fact.memberId, month, source: 'historical_import', evaluation: storedEvaluation, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
    saved.push(fact.memberId)
  }
  return { generated: saved.length, cached: existingIds.size, skipped: candidateIds.length - facts.length, missingFromModel: facts.length - saved.length }
}

exports.main = async (event = {}) => {
  const user = await currentUser()
  const month = event.month || previousMonth()
  if (event.action === 'backfill_historical') {
    if (!ADMIN_MEMBER_IDS.has(user.historicalMemberId)) throw new Error('仅管理员可回填历史评价')
    if (!/^legacy-member-\d{3}$/.test(String(event.memberId || ''))) throw new Error('成员参数无效')
    return backfillHistoricalEvaluation(event.memberId, month)
  }
  if (event.action === 'backfill_all_historical') {
    if (!ADMIN_MEMBER_IDS.has(user.historicalMemberId)) throw new Error('仅管理员可批量回填历史评价')
    return backfillAllHistoricalEvaluations(month, event.memberIds)
  }
  const recordRef = db.collection('activity_records').doc(recordIdFor(user._id, month))
  let record
  try { record = (await recordRef.get()).data } catch (_) { return { evaluation: null, reason: 'no_confirmed_submission' } }
  if (!record || !isNumber(record.memberConfirmedEquivalentKm) || !['pending_admin_review', 'approved'].includes(record.reviewStatus)) return { evaluation: null, reason: 'no_confirmed_submission' }
  const existing = record.memberEvaluation
  if (existing && existing.basedOnRevision === Number(record.revision || 0) && existing.content) return { evaluation: existing, cached: true }
  const evaluation = await generateCurrentSubmissionEvaluation(user, record, month)
  await recordRef.update({ data: { memberEvaluation: evaluation, updatedAt: db.serverDate() } })
  return { evaluation, cached: false }
}
