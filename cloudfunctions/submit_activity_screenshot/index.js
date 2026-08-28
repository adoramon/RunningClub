const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const AI_MODEL = process.env.RUNNING_CLUB_AI_MODEL || 'local-premium'
const round = value => Math.round(value * 100) / 100
const isNumber = value => typeof value === 'number' && Number.isFinite(value)

function previousMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function recordIdFor(userId, month) {
  return `activity-${userId}-${month}`
}

function safeError(error) {
  return String(error && error.message ? error.message : error || '识别服务暂不可用').slice(0, 240)
}

function imageMimeType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

function activityEquivalentKm(activity) {
  const value = Number(activity.rawValue)
  if (!Number.isFinite(value) || value < 0) return null
  switch (activity.activityType) {
    case 'running': return round(value)
    case 'cycling': return round(value / 3)
    case 'swimming': return round(value * 5)
    case 'jump_rope': return round(value / 100)
    case 'elevation': return round(value * 0.02)
    default: return null
  }
}

function canonicalType(value) {
  const type = String(value || '').trim().toLowerCase()
  const aliases = {
    running: 'running', run: 'running', 跑步: 'running',
    cycling: 'cycling', cycle: 'cycling', bike: 'cycling', 骑行: 'cycling', 自行车: 'cycling',
    swimming: 'swimming', swim: 'swimming', 游泳: 'swimming',
    jump_rope: 'jump_rope', jumprope: 'jump_rope', skipping: 'jump_rope', 跳绳: 'jump_rope',
    elevation: 'elevation', climbing: 'elevation', ascent: 'elevation', 爬升: 'elevation'
  }
  return aliases[type] || 'custom'
}

function normalizeActivities(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).map(item => {
    const activityType = canonicalType(item && item.activityType)
    const rawValue = Number(item && item.rawValue)
    const rawUnit = String(item && item.rawUnit || '').trim().slice(0, 20)
    const equivalentKm = activityEquivalentKm({ activityType, rawValue })
    return {
      activityType,
      rawValue: Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null,
      rawUnit,
      equivalentKm,
      evidence: String(item && item.evidence || '').trim().slice(0, 120)
    }
  }).filter(item => item.rawValue !== null)
}

function parseModelContent(content) {
  const text = Array.isArray(content)
    ? content.map(item => item && (item.text || item.content || '')).join('')
    : String(content || '')
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(cleaned)
  const activities = normalizeActivities(parsed.activities)
  if (!activities.length) throw new Error('截图中未识别到可换算的运动数据')
  const hasCustomActivity = activities.some(item => item.equivalentKm === null)
  const equivalentKm = hasCustomActivity ? null : round(activities.reduce((sum, item) => sum + item.equivalentKm, 0))
  const confidence = Number(parsed.confidence)
  return {
    sourceApp: String(parsed.sourceApp || '').trim().slice(0, 60),
    screenshotMonth: /^\d{4}-\d{2}$/.test(String(parsed.screenshotMonth || '')) ? parsed.screenshotMonth : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    activities,
    suggestedEquivalentKm: equivalentKm,
    needsReview: Boolean(parsed.needsReview) || hasCustomActivity || equivalentKm === null,
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(item => String(item).slice(0, 120)).slice(0, 5) : []
  }
}

function requestJson(options, headers, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({ ...options, method: 'POST', headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const detail = text.replace(/\s+/g, ' ').trim().slice(0, 360)
          return reject(new Error(`模型服务返回 ${response.statusCode}${detail ? `：${detail}` : ''}`))
        }
        try { resolve(JSON.parse(text)) } catch (_) { reject(new Error('模型服务返回了无效响应')) }
      })
    })
    request.setTimeout(55000, () => request.destroy(new Error('模型识别超时')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function recognizeImage(fileId, expectedMonth) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('模型服务尚未配置，请联系管理员')
  const downloaded = await cloud.downloadFile({ fileID: fileId })
  const fileContent = Buffer.from(downloaded.fileContent)
  if (!fileContent.length || fileContent.length > MAX_IMAGE_BYTES) throw new Error('截图文件需小于 6 MB')
  const imageUrl = `data:${imageMimeType(fileContent)};base64,${fileContent.toString('base64')}`
  const prompt = `你是运动截图结构化识别器。请只根据截图中清晰可见的内容提取运动总量，不猜测、不补全。目标统计月份是 ${expectedMonth}。\n\n支持类型及云端换算规则：running（跑步，公里）；cycling（骑行，公里后除以3）；swimming（游泳，公里后乘以5）；jump_rope（跳绳，次数后除以100）；elevation（累计爬升，米后乘以0.02）。无法明确归类时用 custom，并设 needsReview=true。\n\n只输出不带 Markdown 的 JSON：{"sourceApp":"","screenshotMonth":"YYYY-MM或null","activities":[{"activityType":"running|cycling|swimming|jump_rope|elevation|custom","rawValue":数字,"rawUnit":"km|m|count","evidence":"截图中对应文字"}],"confidence":0到1,"needsReview":true或false,"notes":["不确定项"]}`
  const requestBody = JSON.stringify({
    model: AI_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你必须返回严格 JSON，绝不输出解释性文字。' },
      { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }
    ]
  })
  const base = new URL(AI_API_BASE)
  const path = `${base.pathname.replace(/\/$/, '')}/chat/completions`
  const response = await requestJson({ protocol: base.protocol, hostname: base.hostname, port: base.port, path }, {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  }, requestBody)
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
  const recognized = parseModelContent(content)
  return { ...recognized, provider: 'openai-compatible', model: AI_MODEL, rawResponse: JSON.stringify(response).slice(0, 8000) }
}

function publicSubmission(record) {
  if (!record) return null
  const recognition = record.recognition || {}
  return {
    submissionId: record._id || record.submissionKey,
    month: record.month,
    evidenceFileId: record.evidenceFileId,
    recognitionStatus: record.recognitionStatus,
    reviewStatus: record.reviewStatus,
    memberConfirmedEquivalentKm: record.memberConfirmedEquivalentKm,
    recognition: {
      sourceApp: recognition.sourceApp || '', screenshotMonth: recognition.screenshotMonth || null,
      confidence: recognition.confidence || 0, activities: recognition.activities || [],
      suggestedEquivalentKm: isNumber(recognition.suggestedEquivalentKm) ? recognition.suggestedEquivalentKm : null,
      needsReview: Boolean(recognition.needsReview), notes: recognition.notes || [], error: recognition.error || ''
    }
  }
}

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  return user
}

exports.main = async (event = {}) => {
  const user = await currentUser()
  const month = previousMonth()
  const recordId = recordIdFor(user._id, month)
  const action = String(event.action || 'get')
  const records = db.collection('activity_records')

  if (action === 'get') {
    try { return { submission: publicSubmission((await records.doc(recordId).get()).data) } } catch (_) { return { submission: null, month } }
  }

  if (action === 'confirm') {
    const current = (await records.doc(recordId).get()).data
    if (!current || current.recognitionStatus !== 'recognized') throw new Error('请先完成截图识别')
    const suggested = current.recognition && current.recognition.suggestedEquivalentKm
    const supplied = event.confirmedEquivalentKm === '' || event.confirmedEquivalentKm === undefined ? suggested : Number(event.confirmedEquivalentKm)
    if (!Number.isFinite(supplied) || supplied < 0 || supplied > 10000) throw new Error('请确认有效的等效跑量')
    await records.doc(recordId).update({ data: {
      memberConfirmedEquivalentKm: round(supplied), memberConfirmedAt: db.serverDate(),
      reviewStatus: 'pending_admin_review', updatedAt: db.serverDate()
    } })
    return { submission: publicSubmission({ ...current, memberConfirmedEquivalentKm: round(supplied), reviewStatus: 'pending_admin_review' }) }
  }

  if (action !== 'recognize') throw new Error('不支持的提交操作')
  const evidenceFileId = String(event.evidenceFileId || '')
  if (!evidenceFileId.startsWith('cloud://')) throw new Error('请先上传有效的运动截图')
  let previous = null
  try { previous = (await records.doc(recordId).get()).data } catch (_) {}
  const previousEvidenceFileIds = Array.isArray(previous && previous.evidenceFileIds) ? previous.evidenceFileIds : []
  const baseRecord = {
    submissionKey: recordId, userId: user._id, historicalMemberId: user.historicalMemberId, month,
    evidenceFileId, evidenceFileIds: [...new Set([...previousEvidenceFileIds, evidenceFileId])].slice(-8), recognitionStatus: 'analyzing', reviewStatus: 'pending_member_confirmation',
    updatedAt: db.serverDate(), submittedAt: db.serverDate(), revision: Number(previous && previous.revision || 0) + 1
  }
  await records.doc(recordId).set({ data: baseRecord })
  try {
    const recognition = await recognizeImage(evidenceFileId, month)
    const result = { ...baseRecord, recognitionStatus: 'recognized', recognition, reviewStatus: 'pending_member_confirmation' }
    await records.doc(recordId).update({ data: { recognitionStatus: 'recognized', recognition, reviewStatus: 'pending_member_confirmation', recognizedAt: db.serverDate(), updatedAt: db.serverDate() } })
    return { submission: publicSubmission(result) }
  } catch (error) {
    const recognition = { error: safeError(error), activities: [], notes: [] }
    const result = { ...baseRecord, recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed' }
    await records.doc(recordId).update({ data: { recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed', updatedAt: db.serverDate() } })
    return { submission: publicSubmission(result) }
  }
}
