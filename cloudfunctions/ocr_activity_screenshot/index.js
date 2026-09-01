const https = require('https')
const cloud = require('wx-server-sdk')
const { parseOcrContent } = require('./parser')

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
    max_tokens: 1600,
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

function evidenceFileIdsFrom(event) {
  const suppliedFileIds = Array.isArray(event.evidenceFileIds) ? event.evidenceFileIds : [event.evidenceFileId]
  const evidenceFileIds = [...new Set(suppliedFileIds.map(item => String(item || '')).filter(Boolean))]
  if (!evidenceFileIds.length || evidenceFileIds.length > MAX_SCREENSHOT_COUNT || evidenceFileIds.some(fileId => !fileId.startsWith('cloud://'))) {
    throw new Error(`请上传 1 至 ${MAX_SCREENSHOT_COUNT} 张有效的运动截图`)
  }
  return evidenceFileIds
}

async function startBatch(records, recordId, user, month, evidenceFileIds) {
  let previous = null
  try { previous = (await records.doc(recordId).get()).data } catch (_) {}
  if (previous && ['pending_admin_review', 'approved'].includes(previous.reviewStatus)) throw new Error('当前月份已有不可覆盖的提交记录')
  const previousEvidenceFileIds = Array.isArray(previous && previous.evidenceFileIds) ? previous.evidenceFileIds : []
  const oldEvidenceFileIds = Array.isArray(previous && previous.previousEvidenceFileIds) ? previous.previousEvidenceFileIds : []
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const baseRecord = {
    submissionKey: recordId, userId: user._id, historicalMemberId: user.historicalMemberId, month,
    evidenceFileId: evidenceFileIds[0], evidenceFileIds, ocrBatchId: batchId,
    previousEvidenceFileIds: [...new Set([...oldEvidenceFileIds, ...previousEvidenceFileIds])].filter(fileId => !evidenceFileIds.includes(fileId)).slice(-12),
    recognitionStatus: 'ocr_analyzing', reviewStatus: 'pending_member_confirmation',
    ocrPart1: {}, ocrPart2: {}, ocrPart3: {},
    updatedAt: db.serverDate(), submittedAt: db.serverDate(), revision: Number(previous && previous.revision || 0) + 1
  }
  await records.doc(recordId).set({ data: baseRecord })
  return { batchId, baseRecord }
}

exports.main = async (event = {}) => {
  const user = await currentUser()
  const month = previousMonth()
  const recordId = recordIdFor(user._id, month)
  const records = db.collection('activity_records')
  const action = String(event.action || 'recognize')

  if (action === 'start') {
    const evidenceFileIds = evidenceFileIdsFrom(event)
    const started = await startBatch(records, recordId, user, month, evidenceFileIds)
    return { batchId: started.batchId, month, evidenceCount: evidenceFileIds.length }
  }

  if (action === 'recognize_one') {
    const batchId = String(event.batchId || '')
    const imageIndex = Number(event.imageIndex)
    const evidenceFileId = String(event.evidenceFileId || '')
    const current = (await records.doc(recordId).get()).data
    if (!current || current.ocrBatchId !== batchId || current.recognitionStatus !== 'ocr_analyzing') throw new Error('本批截图识别任务已失效')
    if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > current.evidenceFileIds.length || current.evidenceFileIds[imageIndex - 1] !== evidenceFileId) {
      throw new Error('截图序号或文件不匹配')
    }
    let part
    try {
      const result = await recognizeText([evidenceFileId])
      part = {
        status: 'completed', image: { ...result.ocr.images[0], imageIndex }, notes: result.ocr.notes,
        rawResponse: result.rawResponse, model: OCR_MODEL, completedAt: new Date().toISOString()
      }
    } catch (error) {
      part = { status: 'failed', imageIndex, error: safeError(error), rawResponse: String(error && error.rawResponse || '').slice(0, 5000) }
    }
    const latest = (await records.doc(recordId).get()).data
    if (!latest || latest.ocrBatchId !== batchId) return { ocrCompleted: false, superseded: true, imageIndex }
    await records.doc(recordId).update({ data: { [`ocrPart${imageIndex}`]: part, updatedAt: db.serverDate() } })
    return { ocrCompleted: part.status === 'completed', imageIndex, error: part.error || '' }
  }

  if (action === 'complete') {
    const batchId = String(event.batchId || '')
    const current = (await records.doc(recordId).get()).data
    if (!current || current.ocrBatchId !== batchId) throw new Error('本批截图识别任务已失效')
    const parts = current.evidenceFileIds.map((_, index) => current[`ocrPart${index + 1}`])
    const failedIndexes = parts.map((part, index) => (!part || part.status !== 'completed') ? index + 1 : null).filter(Boolean)
    if (failedIndexes.length) {
      const partErrors = parts.map(part => part && part.error).filter(Boolean)
      const error = `第 ${failedIndexes.join('、')} 张截图识别失败${partErrors.length ? `：${partErrors[0]}` : '，请重新提交'}`
      const recognition = { error, activities: [], notes: [] }
      await records.doc(recordId).update({ data: {
        recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed', updatedAt: db.serverDate()
      } })
      return { ocrCompleted: false, error }
    }
    const ocr = {
      images: parts.map(part => part.image),
      notes: parts.flatMap(part => Array.isArray(part.notes) ? part.notes : []).slice(0, 10)
    }
    const ocrRawResponse = JSON.stringify(parts.map(part => ({ imageIndex: part.image.imageIndex, response: part.rawResponse }))).slice(0, 12000)
    await records.doc(recordId).update({ data: {
      recognitionStatus: 'ocr_completed', ocr, ocrModel: OCR_MODEL,
      ocrRawResponse, ocrCompletedAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    return { ocrCompleted: true, month, evidenceCount: current.evidenceFileIds.length }
  }

  if (action !== 'recognize') throw new Error('不支持的截图识别操作')

  // 兼容尚未升级的小程序体验版：旧客户端仍可整批调用，新客户端使用 start/recognize_one/complete。
  const evidenceFileIds = evidenceFileIdsFrom(event)
  await startBatch(records, recordId, user, month, evidenceFileIds)
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
