const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_SCREENSHOT_COUNT = 3
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const OCR_MODEL = process.env.RUNNING_CLUB_AI_OCR_MODEL || process.env.RUNNING_CLUB_AI_MODEL || 'local-vsr'
const OCR_TIMEOUT_MS = 48000

function previousMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function recordIdFor(userId, month) { return `activity-${userId}-${month}` }
function safeError(error) { return String(error && error.message ? error.message : error || '文字识别服务暂不可用').slice(0, 240) }

function imageMimeType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

function modelContentText(content) {
  return Array.isArray(content)
    ? content.map(item => item && (item.text || item.content || '')).join('')
    : String(content || '')
}

function parseOcrContent(content, imageCount) {
  const cleaned = modelContentText(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed
  try { parsed = JSON.parse(cleaned) } catch (_) { throw new Error('文字识别模型返回了无效 JSON') }
  const sourceImages = Array.isArray(parsed.images) ? parsed.images : []
  const images = Array.from({ length: imageCount }, (_, index) => {
    const imageIndex = index + 1
    const source = sourceImages.find(item => Number(item && item.imageIndex) === imageIndex) || sourceImages[index] || {}
    const lines = (Array.isArray(source.lines) ? source.lines : [])
      .map(item => typeof item === 'string' ? item : String(item && item.text || ''))
      .map(item => item.trim()).filter(Boolean).slice(0, 120).map(item => item.slice(0, 180))
    const confidence = Number(source.confidence)
    return { imageIndex, lines, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0 }
  })
  if (!images.some(image => image.lines.length)) throw new Error('文字识别模型未读取到有效文字')
  return {
    images,
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
          return reject(new Error(`文字识别服务返回 ${response.statusCode}${detail ? `：${detail}` : ''}`))
        }
        try { resolve(JSON.parse(text)) } catch (_) { reject(new Error('文字识别服务返回了无效响应')) }
      })
    })
    request.setTimeout(OCR_TIMEOUT_MS, () => request.destroy(new Error('截图文字识别超时')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  return user
}

async function recognizeText(fileIds) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('OCR 模型服务尚未配置，请联系管理员')
  const downloads = await Promise.all(fileIds.map(fileID => cloud.downloadFile({ fileID })))
  const fileContents = downloads.map(downloaded => Buffer.from(downloaded.fileContent))
  const totalBytes = fileContents.reduce((sum, content) => sum + content.length, 0)
  if (fileContents.some(content => !content.length || content.length > MAX_IMAGE_BYTES)) throw new Error('单张截图需小于 4 MB')
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('本次截图总大小需小于 12 MB')
  const imageParts = fileContents.map(fileContent => ({
    type: 'image_url', image_url: { url: `data:${imageMimeType(fileContent)};base64,${fileContent.toString('base64')}` }
  }))
  const prompt = `你是严格的截图文字抄录器。以下共有 ${fileIds.length} 张图片。你的唯一任务是逐图抄录所有清晰可见的文字、数字、标点和单位，并按视觉阅读顺序逐行输出。不要判断哪个数字是运动总量，不要筛选字段，不要计算，不要换算，不要合并多张图片，也不要根据常识纠正或补全数字。千位分隔符、小数点和单位必须原样保留；看不清的内容不要猜测，可在 notes 中说明。只输出 JSON：{"images":[{"imageIndex":1,"lines":["原样文字行"],"confidence":0到1}],"notes":["不确定内容"]}`
  const requestBody = JSON.stringify({
    model: OCR_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你只负责逐字抄录图片文字，禁止进行业务判断；必须返回严格 JSON。' },
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
  const rawResponse = JSON.stringify(response).slice(0, 5000)
  try {
    const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
    return { ocr: parseOcrContent(content, fileIds.length), rawResponse }
  } catch (error) {
    error.rawResponse = rawResponse
    throw error
  }
}

exports.main = async (event = {}) => {
  const user = await currentUser()
  const month = previousMonth()
  const recordId = recordIdFor(user._id, month)
  const suppliedFileIds = Array.isArray(event.evidenceFileIds) ? event.evidenceFileIds : [event.evidenceFileId]
  const evidenceFileIds = [...new Set(suppliedFileIds.map(item => String(item || '')).filter(Boolean))]
  if (!evidenceFileIds.length || evidenceFileIds.length > MAX_SCREENSHOT_COUNT || evidenceFileIds.some(fileId => !fileId.startsWith('cloud://'))) {
    throw new Error(`请上传 1 至 ${MAX_SCREENSHOT_COUNT} 张有效的运动截图`)
  }
  const records = db.collection('activity_records')
  let previous = null
  try { previous = (await records.doc(recordId).get()).data } catch (_) {}
  if (previous && ['pending_admin_review', 'approved'].includes(previous.reviewStatus)) throw new Error('当前月份已有不可覆盖的提交记录')
  const previousEvidenceFileIds = Array.isArray(previous && previous.evidenceFileIds) ? previous.evidenceFileIds : []
  const oldEvidenceFileIds = Array.isArray(previous && previous.previousEvidenceFileIds) ? previous.previousEvidenceFileIds : []
  const baseRecord = {
    submissionKey: recordId, userId: user._id, historicalMemberId: user.historicalMemberId, month,
    evidenceFileId: evidenceFileIds[0], evidenceFileIds,
    previousEvidenceFileIds: [...new Set([...oldEvidenceFileIds, ...previousEvidenceFileIds])].filter(fileId => !evidenceFileIds.includes(fileId)).slice(-12),
    recognitionStatus: 'ocr_analyzing', reviewStatus: 'pending_member_confirmation',
    updatedAt: db.serverDate(), submittedAt: db.serverDate(), revision: Number(previous && previous.revision || 0) + 1
  }
  await records.doc(recordId).set({ data: baseRecord })
  try {
    const result = await recognizeText(evidenceFileIds)
    await records.doc(recordId).update({ data: {
      recognitionStatus: 'ocr_completed', ocr: result.ocr, ocrModel: OCR_MODEL,
      ocrRawResponse: result.rawResponse, ocrCompletedAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    return { ocrCompleted: true, month, evidenceCount: evidenceFileIds.length }
  } catch (error) {
    const recognition = { error: safeError(error), activities: [], notes: [] }
    if (error && error.rawResponse) recognition.rawResponse = error.rawResponse
    await records.doc(recordId).update({ data: {
      recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed', updatedAt: db.serverDate()
    } })
    return { ocrCompleted: false, error: recognition.error }
  }
}
