const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const AI_MODEL = process.env.RUNNING_CLUB_EVALUATION_MODEL || 'local-premium'
const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(Number(value || 0) * 100) / 100

function previousMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function recordIdFor(userId, month) { return `activity-${userId}-${month}` }

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  return user
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
    request.setTimeout(15000, () => request.destroy(new Error('评价生成超时')))
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

async function generateEvaluation(user, record, month) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('评价模型尚未配置，请联系管理员')
  const [goalResult, historyResult] = await Promise.all([
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId, month }).limit(1).get(),
    db.collection('historical_monthly_records').where({ legacyMemberKey: user.historicalMemberId }).orderBy('month', 'desc').limit(24).get()
  ])
  const targetKm = goalResult.data[0] && isNumber(goalResult.data[0].targetKm) ? round(goalResult.data[0].targetKm) : null
  const actualKm = round(record.memberConfirmedEquivalentKm)
  const previousActual = historyResult.data.filter(item => item.month < month && isNumber(item.equivalentKm)).slice(0, 6).map(item => item.equivalentKm)
  const averageKm = previousActual.length ? round(previousActual.reduce((sum, value) => sum + value, 0) / previousActual.length) : null
  const completionPct = targetKm && targetKm > 0 ? Math.round(actualKm / targetKm * 100) : null
  const displayName = user.wechatNickname || user.nickname || '跑友'
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
  return { ...parseEvaluation(content), month, basedOnRevision: Number(record.revision || 0), model: AI_MODEL, generatedAt: db.serverDate() }
}

exports.main = async () => {
  const user = await currentUser()
  const month = previousMonth()
  const recordRef = db.collection('activity_records').doc(recordIdFor(user._id, month))
  let record
  try { record = (await recordRef.get()).data } catch (_) { return { evaluation: null, reason: 'no_confirmed_submission' } }
  if (!record || !isNumber(record.memberConfirmedEquivalentKm) || !['pending_admin_review', 'approved'].includes(record.reviewStatus)) return { evaluation: null, reason: 'no_confirmed_submission' }
  const existing = record.memberEvaluation
  if (existing && existing.basedOnRevision === Number(record.revision || 0) && existing.content) return { evaluation: existing, cached: true }
  const evaluation = await generateEvaluation(user, record, month)
  await recordRef.update({ data: { memberEvaluation: evaluation, updatedAt: db.serverDate() } })
  return { evaluation, cached: false }
}
