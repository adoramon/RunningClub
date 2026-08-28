const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// CloudBase 单次调用的硬上限为 60 秒；三张可让视觉模型推理和写库都有余量。
const MAX_SCREENSHOT_COUNT = 3
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const AI_MODEL = process.env.RUNNING_CLUB_AI_MODEL || 'local-vsr'
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

function normalizedUnit(value) {
  const unit = String(value || '').trim().toLowerCase()
  if (['m', 'meter', 'meters', '米'].includes(unit)) return 'm'
  if (['km', 'kilometer', 'kilometers', '公里', '千米'].includes(unit)) return 'km'
  if (['count', '次', '个'].includes(unit)) return 'count'
  return unit
}

function distanceToKm(value, rawUnit) {
  const unit = normalizedUnit(rawUnit)
  return unit === 'm' ? value / 1000 : value
}

function activityEquivalentKm(activity) {
  const value = Number(activity.rawValue)
  if (!Number.isFinite(value) || value < 0) return null
  switch (activity.activityType) {
    case 'running': return round(distanceToKm(value, activity.rawUnit))
    case 'cycling': return round(distanceToKm(value, activity.rawUnit) / 3)
    case 'swimming': return round(distanceToKm(value, activity.rawUnit) * 5)
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

function normalizeActivities(value, imageCount) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).map(item => {
    const activityType = canonicalType(item && item.activityType)
    const rawValue = Number(item && item.rawValue)
    const rawUnit = normalizedUnit(item && item.rawUnit).slice(0, 20)
    const equivalentKm = activityEquivalentKm({ activityType, rawValue, rawUnit })
    return {
      activityType,
      rawValue: Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null,
      rawUnit,
      equivalentKm,
      evidenceImageIndex: Math.max(1, Math.min(imageCount || 1, Number.parseInt(item && item.imageIndex, 10) || 1)),
      evidence: String(item && item.evidence || '').trim().slice(0, 120)
    }
  }).filter(item => item.rawValue !== null)
}

function parseModelContent(content, imageCount) {
  const text = Array.isArray(content)
    ? content.map(item => item && (item.text || item.content || '')).join('')
    : String(content || '')
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(cleaned)
  const activities = normalizeActivities(parsed.activities, imageCount)
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
    needsReview: Boolean(parsed.needsReview) || imageCount > 1 || hasCustomActivity || equivalentKm === null,
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
    request.setTimeout(48000, () => request.destroy(new Error('模型识别超时')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function recognizeImages(fileIds, expectedMonth) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('模型服务尚未配置，请联系管理员')
  const downloads = await Promise.all(fileIds.map(fileID => cloud.downloadFile({ fileID })))
  const fileContents = downloads.map(downloaded => Buffer.from(downloaded.fileContent))
  const totalBytes = fileContents.reduce((sum, content) => sum + content.length, 0)
  if (fileContents.some(content => !content.length || content.length > MAX_IMAGE_BYTES)) throw new Error('单张截图需小于 4 MB')
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('本次截图总大小需小于 12 MB')
  const imageParts = fileContents.map(fileContent => ({
    type: 'image_url', image_url: { url: `data:${imageMimeType(fileContent)};base64,${fileContent.toString('base64')}` }
  }))
  const prompt = `你是运动截图结构化识别器。以下共有 ${fileIds.length} 张截图，全部是同一成员 ${expectedMonth} 的月度运动记录。请逐图识别并把所有不同运动记录相加；只根据截图中清晰可见、明确标注为本月或累计总量的距离/次数提取数据，不猜测、不补全。\n\n【总量优先规则，必须遵守】一张截图只读取该运动的“累计”“本月累计”“月度总计”“总距离”或等义总量卡片。若游泳截图顶部显示“累计游泳距离 48,806 米”，而下方还有分段、单次、泳姿、训练记录或按天明细，则只输出 48,806 米；下方任一分段数字都不得输出、不得相加、不得作为替代值。跑步和骑行截图同样：忽略单次活动、分段、配速、时长、卡路里、排名和目标值。若找不到明确的累计/本月总量标签，不输出该项并在 notes 说明，设 needsReview=true。不要把同一截图内重复展示的同一个总量重复计入；若不同截图疑似展示同一条或同一月总量，不要擅自相加，设 needsReview=true 并写入 notes。\n\n数字必须逐字读取并保留完整精度：带千位分隔符的 48,806 米必须输出 rawValue=48806、rawUnit="m"，不能缩写为 48.806、2600 或其他数值；52.76 公里必须输出 rawValue=52.76、rawUnit="km"。无法明确看清完整数字时，不输出该项并在 notes 说明。\n\n支持类型及云端换算规则：running（跑步，距离）；cycling（骑行，距离后除以3）；swimming（游泳，距离后乘以5）；jump_rope（跳绳，次数后除以100）；elevation（累计爬升，米后乘以0.02）。距离必须使用截图显示的原始单位：“km”或“m”；无法明确归类时用 custom，并设 needsReview=true。\n\n只输出不带 Markdown 的 JSON：{"sourceApp":"","screenshotMonth":"YYYY-MM或null","activities":[{"imageIndex":1到${fileIds.length},"activityType":"running|cycling|swimming|jump_rope|elevation|custom","rawValue":数字,"rawUnit":"km|m|count","evidence":"累计/本月总量标签 + 完整数字 + 单位"}],"confidence":0到1,"needsReview":true或false,"notes":["不确定项"]}`
  const requestBody = JSON.stringify({
    model: AI_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你必须返回严格 JSON，绝不输出解释性文字。' },
      { role: 'user', content: [{ type: 'text', text: prompt }, ...imageParts] }
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
  const rawResponse = JSON.stringify(response).slice(0, 8000)
  try {
    const recognized = parseModelContent(content, fileIds.length)
    return { ...recognized, provider: 'openai-compatible', model: AI_MODEL, rawResponse }
  } catch (error) {
    error.rawResponse = rawResponse
    throw error
  }
}

function publicSubmission(record) {
  if (!record) return null
  const recognition = record.recognition || {}
  return {
    submissionId: record._id || record.submissionKey,
    month: record.month,
    evidenceFileId: record.evidenceFileId,
    evidenceFileIds: record.evidenceFileIds || [],
    evidenceCount: (record.evidenceFileIds || []).length,
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

  if (action === 'cancel') {
    const current = (await records.doc(recordId).get()).data
    if (!current || current.recognitionStatus !== 'recognized' || current.reviewStatus !== 'pending_member_confirmation') {
      throw new Error('当前没有可取消的识别结果')
    }
    await records.doc(recordId).update({ data: {
      recognitionStatus: 'cancelled', reviewStatus: 'cancelled', cancelledAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    return { submission: publicSubmission({ ...current, recognitionStatus: 'cancelled', reviewStatus: 'cancelled' }) }
  }

  if (action !== 'recognize') throw new Error('不支持的提交操作')
  const suppliedFileIds = Array.isArray(event.evidenceFileIds) ? event.evidenceFileIds : [event.evidenceFileId]
  const evidenceFileIds = [...new Set(suppliedFileIds.map(item => String(item || '')).filter(Boolean))]
  if (!evidenceFileIds.length || evidenceFileIds.length > MAX_SCREENSHOT_COUNT || evidenceFileIds.some(fileId => !fileId.startsWith('cloud://'))) {
    throw new Error(`请上传 1 至 ${MAX_SCREENSHOT_COUNT} 张有效的运动截图`)
  }
  const evidenceFileId = evidenceFileIds[0]
  let previous = null
  try { previous = (await records.doc(recordId).get()).data } catch (_) {}
  const previousEvidenceFileIds = Array.isArray(previous && previous.evidenceFileIds) ? previous.evidenceFileIds : []
  const oldEvidenceFileIds = Array.isArray(previous && previous.previousEvidenceFileIds) ? previous.previousEvidenceFileIds : []
  const baseRecord = {
    submissionKey: recordId, userId: user._id, historicalMemberId: user.historicalMemberId, month,
    evidenceFileId, evidenceFileIds, previousEvidenceFileIds: [...new Set([...oldEvidenceFileIds, ...previousEvidenceFileIds])].filter(fileId => !evidenceFileIds.includes(fileId)).slice(-12),
    recognitionStatus: 'analyzing', reviewStatus: 'pending_member_confirmation',
    updatedAt: db.serverDate(), submittedAt: db.serverDate(), revision: Number(previous && previous.revision || 0) + 1
  }
  await records.doc(recordId).set({ data: baseRecord })
  try {
    const recognition = await recognizeImages(evidenceFileIds, month)
    const result = { ...baseRecord, recognitionStatus: 'recognized', recognition, reviewStatus: 'pending_member_confirmation' }
    await records.doc(recordId).update({ data: { recognitionStatus: 'recognized', recognition, reviewStatus: 'pending_member_confirmation', recognizedAt: db.serverDate(), updatedAt: db.serverDate() } })
    return { submission: publicSubmission(result) }
  } catch (error) {
    const recognition = { error: safeError(error), activities: [], notes: [] }
    if (error && error.rawResponse) recognition.rawResponse = error.rawResponse
    const result = { ...baseRecord, recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed' }
    await records.doc(recordId).update({ data: { recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed', updatedAt: db.serverDate() } })
    return { submission: publicSubmission(result) }
  }
}
