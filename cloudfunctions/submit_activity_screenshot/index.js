const https = require('https')
const cloud = require('wx-server-sdk')
const { deterministicMonthlySummary } = require('./monthly-summary')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// CloudBase 单次调用的硬上限为 60 秒；OCR 与文本判断共用该时间预算。
const MAX_SCREENSHOT_COUNT = 3
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
const AI_API_BASE = process.env.RUNNING_CLUB_AI_API_BASE || 'https://ai.home.adoramon.com:13246/v1'
const OCR_MODEL = process.env.RUNNING_CLUB_AI_OCR_MODEL || process.env.RUNNING_CLUB_AI_MODEL || 'local-vsr'
const JUDGEMENT_MODEL = process.env.RUNNING_CLUB_AI_JUDGEMENT_MODEL || 'local-premium'
const OCR_TIMEOUT_MS = 30000
const JUDGEMENT_TIMEOUT_MS = 18000
const STANDALONE_JUDGEMENT_TIMEOUT_MS = 54000
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

function evidenceFileIdsFor(record) {
  return [...new Set([
    ...(Array.isArray(record && record.evidenceFileIds) ? record.evidenceFileIds : []),
    ...(Array.isArray(record && record.previousEvidenceFileIds) ? record.previousEvidenceFileIds : []),
    record && record.evidenceFileId
  ].filter(fileId => String(fileId || '').startsWith('cloud://')))]
}

async function deleteEvidenceFiles(record) {
  const fileList = evidenceFileIdsFor(record)
  if (!fileList.length) return 0
  const result = await cloud.deleteFile({ fileList })
  const failed = (result.fileList || []).filter(item => Number(item.status) !== 0 && !/not\s*exist|nosuchkey|不存在/i.test(String(item.errMsg || '')))
  if (failed.length) throw new Error('云端截图删除失败，请稍后重试')
  return fileList.length
}

function clearedEvidenceData(reason) {
  return {
    evidenceFileId: '', evidenceFileIds: [], previousEvidenceFileIds: [],
    evidencePurgedReason: reason, evidencePurgedAt: db.serverDate()
  }
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

function isValidActivityUnit(activityType, rawUnit) {
  const unit = normalizedUnit(rawUnit)
  if (['running', 'cycling', 'swimming'].includes(activityType)) return unit === 'km' || unit === 'm'
  if (activityType === 'jump_rope') return unit === 'count'
  if (activityType === 'elevation') return unit === 'm'
  return activityType === 'custom'
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

function modelContentText(content) {
  return Array.isArray(content)
    ? content.map(item => item && (item.text || item.content || '')).join('')
    : String(content || '')
}

function parseStrictJson(content, errorLabel) {
  const cleaned = modelContentText(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(cleaned) } catch (_) { throw new Error(`${errorLabel}返回了无效 JSON`) }
}

function parseOcrContent(content, imageCount) {
  const parsed = parseStrictJson(content, '文字识别模型')
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

function numericValueAppearsInText(value, text) {
  const expected = Number(value)
  if (!Number.isFinite(expected)) return false
  const candidates = String(text || '').match(/\d[\d,，]*(?:\.\d+)?/g) || []
  return candidates.some(candidate => {
    const actual = Number(candidate.replace(/[,，]/g, ''))
    return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(0.0001, Math.abs(expected) * 1e-10)
  })
}

function referencedOcrEvidence(ocr, imageIndex, lineIndexes) {
  const image = ocr.images.find(item => item.imageIndex === imageIndex)
  if (!image) return null
  const indexes = [...new Set((Array.isArray(lineIndexes) ? lineIndexes : [lineIndexes])
    .map(item => Number.parseInt(item, 10)).filter(item => item >= 1 && item <= image.lines.length))].slice(0, 4)
  if (!indexes.length) return null
  const lines = indexes.map(index => image.lines[index - 1])
  return { indexes, text: lines.join(' · ') }
}

function monthsMentionedInText(text, expectedMonth) {
  const expectedYear = String(expectedMonth || '').slice(0, 4)
  const months = new Set()
  const source = String(text || '')
  const fullPattern = /(20\d{2})\s*(?:年|[-/.])\s*(1[0-2]|0?[1-9])\s*月?/g
  let match
  while ((match = fullPattern.exec(source))) months.add(`${match[1]}-${String(Number(match[2])).padStart(2, '0')}`)
  const monthPattern = /(^|\D)(1[0-2]|0?[1-9])\s*月(?!个)/g
  while ((match = monthPattern.exec(source))) months.add(`${expectedYear}-${String(Number(match[2])).padStart(2, '0')}`)
  return [...months]
}

function normalizeActivities(value, imageCount, ocr, expectedMonth) {
  if (!Array.isArray(value)) return { activities: [], rejectedCount: 0 }
  let rejectedCount = 0
  let monthRejectedCount = 0
  const activities = value.slice(0, 8).map(item => {
    const imageIndex = Math.max(1, Math.min(imageCount || 1, Number.parseInt(item && item.imageIndex, 10) || 1))
    const ocrImage = (ocr.images || []).find(image => Number(image.imageIndex) === imageIndex)
    const imageOcrMonths = monthsMentionedInText((ocrImage && ocrImage.lines || []).join('\n'), expectedMonth)
    const activityType = canonicalType(item && item.activityType)
    const imageText = (ocrImage && ocrImage.lines || []).join(' ')
    const rawValue = Number(item && item.rawValue)
    const rawUnit = normalizedUnit(item && item.rawUnit).slice(0, 20)
    const equivalentKm = activityEquivalentKm({ activityType, rawValue, rawUnit })
    const evidence = referencedOcrEvidence(ocr, imageIndex, item && (item.sourceLineIndexes || item.sourceLineIndex))
    const activityMonth = /^\d{4}-\d{2}$/.test(String(item && item.activityMonth || '')) ? String(item.activityMonth) : null
    const evidenceMonths = evidence ? monthsMentionedInText(evidence.text, expectedMonth) : []
    const monthValid = activityMonth
      ? activityMonth === expectedMonth && (!imageOcrMonths.length || (
        imageOcrMonths.includes(expectedMonth) && (imageOcrMonths.length === 1 || evidenceMonths.includes(expectedMonth))
      ))
      : imageOcrMonths.length === 0
    const hikingImage = /徒步|登山|爬山|hiking|trekking|山地活动/i.test(imageText)
    const elevationEvidence = Boolean(evidence && /爬升|海拔增益|累计上升|总上升|上升高度|elevation\s*gain|ascent/i.test(evidence.text))
    const explicitRunningEvidence = Boolean(evidence && /跑步|running|跑步机/i.test(evidence.text))
    const walkingEvidence = Boolean(evidence && /步行|健走|散步|walking|(^|\W)walk(\W|$)/i.test(evidence.text))
    const semanticValid = activityType === 'elevation'
      ? elevationEvidence && !walkingEvidence
      : !walkingEvidence && !(activityType === 'running' && hikingImage && !explicitRunningEvidence)
    return {
      activityType,
      activityMonth,
      rawValue: Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null,
      rawUnit,
      equivalentKm,
      evidenceImageIndex: imageIndex,
      evidenceLineIndexes: evidence ? evidence.indexes : [],
      evidence: evidence ? evidence.text.slice(0, 180) : '',
      unitValid: isValidActivityUnit(activityType, rawUnit),
      evidenceValid: Boolean(evidence && numericValueAppearsInText(rawValue, evidence.text)),
      monthValid,
      semanticValid
    }
  }).filter(item => {
    const valid = item.rawValue !== null && item.unitValid && item.evidenceValid && item.monthValid && item.semanticValid
    if (!valid) rejectedCount += 1
    if (!item.monthValid) monthRejectedCount += 1
    return valid
  }).map(({ unitValid, evidenceValid, monthValid, semanticValid, ...item }) => item)
  return { activities, rejectedCount, monthRejectedCount }
}

function parseJudgementContent(content, imageCount, expectedMonth, ocr) {
  const parsed = parseStrictJson(content, '数据判断模型')
  const normalized = normalizeActivities(parsed.activities, imageCount, ocr, expectedMonth)
  const activities = normalized.activities
  if (!activities.length) {
    if (normalized.monthRejectedCount) throw new Error(`截图中未识别到属于 ${expectedMonth} 的运动数据`)
    throw new Error('截图中未识别到可换算的运动数据')
  }
  const hasCustomActivity = activities.some(item => item.equivalentKm === null)
  const equivalentKm = hasCustomActivity ? null : round(activities.reduce((sum, item) => sum + item.equivalentKm, 0))
  const confidence = Number(parsed.confidence)
  const screenshotMonth = /^\d{4}-\d{2}$/.test(String(parsed.screenshotMonth || '')) ? parsed.screenshotMonth : null
  const monthMismatch = Boolean(screenshotMonth && screenshotMonth !== expectedMonth)
  const notes = Array.isArray(parsed.notes) ? parsed.notes.map(item => String(item).slice(0, 120)).slice(0, 5) : []
  if (normalized.monthRejectedCount) notes.push(`有 ${normalized.monthRejectedCount} 项不属于 ${expectedMonth}，已自动排除`)
  if (normalized.rejectedCount) notes.push(`有 ${normalized.rejectedCount} 项判断无法在 OCR 原文中验证，已自动排除`)
  if (monthMismatch) notes.push(`截图月份 ${screenshotMonth} 与应提交月份 ${expectedMonth} 不一致`)
  return {
    sourceApp: String(parsed.sourceApp || '').trim().slice(0, 60),
    screenshotMonth,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    activities,
    suggestedEquivalentKm: equivalentKm,
    needsReview: Boolean(parsed.needsReview) || imageCount > 1 || hasCustomActivity || equivalentKm === null || normalized.rejectedCount > 0 || monthMismatch,
    notes: notes.slice(0, 5)
  }
}

function judgementPromptFor(indexedOcr, imageCount, expectedMonth) {
  return `你是东成西就跑团的运动数据判断器。你只能根据下面提供的 OCR 文字判断，不得读取图片，不得创造 OCR 中不存在的数字。目标月份是 ${expectedMonth}。

必须严格按以下优先级判断：
1. 先锁定目标月份 ${expectedMonth}。若 OCR 同时出现其他月份（例如上月、前月、历史月份），其他月份的数据一律忽略，不得输出。每项活动都填写 activityMonth；OCR 有月份或日期时，sourceLineIndexes 必须同时引用月份/日期上下文和运动数值。
2. 先判断运动类型。若截图属于登山、徒步、爬山、Hiking、Trekking 或同类山地活动，只提取明确标注为“累计爬升”“总爬升”“爬升高度”“海拔增益”“累计上升”或等义字段的米数，activityType 必须为 elevation、rawUnit 必须为 m。路线距离不得当作 running，当前海拔、最高海拔、最低海拔也不得当作爬升。没有明确爬升总量时不要用路线距离替代，并设 needsReview=true。
3. 对目标月份的同一种运动，优先寻找“累计”“本月累计”“月度总计”“总距离”“总里程”或等义的月度汇总。存在月度汇总时，只输出汇总，不得再输出其下方单次、分段或按天明细；登山徒步仍按上一条只取爬升。
4. 只有确实找不到该运动的月度汇总时，才把整张截图视为一次单次运动。每张截图最多输出一项，只取该次运动页面明确显示的“总距离”“距离”“总次数”或“累计爬升”；不得把圈数、分段、每公里、按天或其他明细自主相加。若截图只是多次运动列表且没有任何单次总量，不要计算，设 needsReview=true。不得把月度汇总与组成它的单次记录同时计入。
5. 卡路里/kcal/大卡、步数、时长、配速、心率、排名和目标值永远不得计入。不同截图疑似重复展示同一份汇总或同一次运动时不得重复输出，并设 needsReview=true。
6. 步行、健走、散步、Walking、Walk 不属于本跑团自动换算项目，必须完全忽略，绝不能映射为 running，也不能与骑行或其他运动相加。

支持 running、cycling、swimming、jump_rope、elevation；无法明确判断时不要输出。rawValue 必须是所引用 OCR 行中逐字存在的数字，rawUnit 必须来自所引用 OCR 行。sourceLineIndexes 填写支撑判断的 1 至 4 个 OCR 行号。不要计算等效跑量。

OCR 原文：${JSON.stringify(indexedOcr)}

只输出 JSON：{"sourceApp":"","screenshotMonth":"YYYY-MM或null","activities":[{"imageIndex":1到${imageCount},"sourceLineIndexes":[1],"activityMonth":"YYYY-MM或null","activityType":"running|cycling|swimming|jump_rope|elevation","rawValue":数字,"rawUnit":"km|m|count"}],"confidence":0到1,"needsReview":true或false,"notes":["判断说明"]}`
}

function reviewedActivitiesFor(activities, requestedReviews) {
  if (!Array.isArray(requestedReviews)) return null
  const requestedByIndex = {}
  requestedReviews.forEach(item => {
    const activityIndex = Number(item && item.activityIndex)
    if (!Number.isInteger(activityIndex) || activityIndex < 0 || activityIndex >= activities.length || requestedByIndex[activityIndex]) {
      throw new Error('提交的核对项目无效')
    }
    requestedByIndex[activityIndex] = item
  })
  return activities.map((activity, activityIndex) => {
    const requested = requestedByIndex[activityIndex] || {}
    const included = requested.included !== false
    const hasValue = Object.prototype.hasOwnProperty.call(requested, 'rawValue')
    const rawValue = hasValue ? Number(requested.rawValue) : Number(activity.rawValue)
    if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 10000000) throw new Error('请填写有效的原始运动数值')
    if (included && !isValidActivityUnit(activity.activityType, activity.rawUnit)) throw new Error('存在单位不匹配的识别项，请取消该项目后再提交')
    const equivalentKm = included ? activityEquivalentKm({ ...activity, rawValue }) : 0
    if (included && equivalentKm === null) throw new Error('存在无法自动换算的运动，请取消该项目后再提交')
    return {
      activityIndex, activityType: activity.activityType, rawValue: round(rawValue), rawUnit: activity.rawUnit,
      equivalentKm: round(equivalentKm), included, evidenceImageIndex: activity.evidenceImageIndex, evidence: activity.evidence
    }
  })
}

function requestJson(options, headers, body, timeoutMs) {
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
    request.setTimeout(timeoutMs, () => request.destroy(new Error('模型识别超时')))
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
  const base = new URL(AI_API_BASE)
  const path = `${base.pathname.replace(/\/$/, '')}/chat/completions`
  const requestOptions = { protocol: base.protocol, hostname: base.hostname, port: base.port, path }
  const requestHeaders = requestBody => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  })
  let ocrRawResponse = ''
  let judgementRawResponse = ''

  const ocrPrompt = `你是严格的截图文字抄录器。以下共有 ${fileIds.length} 张图片。你的唯一任务是逐图抄录所有清晰可见的文字、数字、标点和单位，并按视觉阅读顺序逐行输出。不要判断哪个数字是运动总量，不要筛选字段，不要计算，不要换算，不要合并多张图片，也不要根据常识纠正或补全数字。千位分隔符、小数点和单位必须原样保留；看不清的内容不要猜测，可在 notes 中说明。只输出 JSON：{"images":[{"imageIndex":1,"lines":["原样文字行"],"confidence":0到1}],"notes":["不确定内容"]}`
  const ocrRequestBody = JSON.stringify({
    model: OCR_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你只负责逐字抄录图片文字，禁止进行业务判断；必须返回严格 JSON。' },
      { role: 'user', content: [{ type: 'text', text: ocrPrompt }, ...imageParts] }
    ]
  })
  try {
    const ocrResponse = await requestJson(requestOptions, requestHeaders(ocrRequestBody), ocrRequestBody, OCR_TIMEOUT_MS)
    ocrRawResponse = JSON.stringify(ocrResponse).slice(0, 5000)
    const ocrContent = ocrResponse && ocrResponse.choices && ocrResponse.choices[0] && ocrResponse.choices[0].message && ocrResponse.choices[0].message.content
    const ocr = parseOcrContent(ocrContent, fileIds.length)
    const indexedOcr = {
      images: ocr.images.map(image => ({
        imageIndex: image.imageIndex,
        lines: image.lines.map((text, index) => ({ lineIndex: index + 1, text }))
      }))
    }
    const judgementPrompt = judgementPromptFor(indexedOcr, fileIds.length, expectedMonth)
    const judgementRequestBody = JSON.stringify({
      model: JUDGEMENT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只根据 OCR 原文判断运动总量，不得创造数字；必须返回严格 JSON。' },
        { role: 'user', content: judgementPrompt }
      ]
    })
    const judgementResponse = await requestJson(requestOptions, requestHeaders(judgementRequestBody), judgementRequestBody, JUDGEMENT_TIMEOUT_MS)
    judgementRawResponse = JSON.stringify(judgementResponse).slice(0, 5000)
    const judgementContent = judgementResponse && judgementResponse.choices && judgementResponse.choices[0] && judgementResponse.choices[0].message && judgementResponse.choices[0].message.content
    const recognized = parseJudgementContent(judgementContent, fileIds.length, expectedMonth, ocr)
    return {
      ...recognized,
      provider: 'openai-compatible',
      model: JUDGEMENT_MODEL,
      ocrModel: OCR_MODEL,
      judgementModel: JUDGEMENT_MODEL,
      ocr,
      rawResponse: JSON.stringify({ ocr: ocrRawResponse, judgement: judgementRawResponse }).slice(0, 8000)
    }
  } catch (error) {
    error.rawResponse = JSON.stringify({ ocr: ocrRawResponse, judgement: judgementRawResponse }).slice(0, 8000)
    throw error
  }
}

async function judgeStoredOcr(ocr, imageCount, expectedMonth) {
  const apiKey = process.env.RUNNING_CLUB_AI_API_KEY
  if (!apiKey) throw new Error('模型服务尚未配置，请联系管理员')
  const indexedOcr = {
    images: ocr.images.map(image => ({
      imageIndex: image.imageIndex,
      lines: image.lines.map((text, index) => ({ lineIndex: index + 1, text }))
    }))
  }
  const judgementPrompt = judgementPromptFor(indexedOcr, imageCount, expectedMonth)
  const requestBody = JSON.stringify({
    model: JUDGEMENT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你只根据 OCR 原文判断运动总量，不得创造数字；必须返回严格 JSON。' },
      { role: 'user', content: judgementPrompt }
    ]
  })
  const base = new URL(AI_API_BASE)
  const path = `${base.pathname.replace(/\/$/, '')}/chat/completions`
  const response = await requestJson({ protocol: base.protocol, hostname: base.hostname, port: base.port, path }, {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  }, requestBody, STANDALONE_JUDGEMENT_TIMEOUT_MS)
  const rawResponse = JSON.stringify(response).slice(0, 5000)
  try {
    const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
    return { recognized: parseJudgementContent(content, imageCount, expectedMonth, ocr), rawResponse }
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
    adminVoidReason: record.adminVoidReason || '',
    memberConfirmedEquivalentKm: record.memberConfirmedEquivalentKm,
    memberReviewedActivities: record.memberReviewedActivities || [],
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
    if (!current || current.recognitionStatus !== 'recognized' || current.reviewStatus !== 'pending_member_confirmation') throw new Error('请先完成截图识别')
    const suggested = current.recognition && current.recognition.suggestedEquivalentKm
    const reviewedActivities = reviewedActivitiesFor((current.recognition && current.recognition.activities) || [], event.reviewedActivities)
    const supplied = reviewedActivities
      ? round(reviewedActivities.reduce((sum, item) => sum + (item.included ? item.equivalentKm : 0), 0))
      : (event.confirmedEquivalentKm === '' || event.confirmedEquivalentKm === undefined ? suggested : Number(event.confirmedEquivalentKm))
    if (!Number.isFinite(supplied) || supplied < 0 || supplied > 10000) throw new Error('请确认有效的等效跑量')
    await records.doc(recordId).update({ data: {
      memberConfirmedEquivalentKm: round(supplied), memberConfirmedAt: db.serverDate(),
      memberReviewedActivities: reviewedActivities || [], reviewStatus: 'pending_admin_review', updatedAt: db.serverDate()
    } })
    return { submission: publicSubmission({ ...current, memberConfirmedEquivalentKm: round(supplied), memberReviewedActivities: reviewedActivities || [], reviewStatus: 'pending_admin_review' }) }
  }

  if (action === 'cancel') {
    const current = (await records.doc(recordId).get()).data
    if (!current || current.recognitionStatus !== 'recognized' || current.reviewStatus !== 'pending_member_confirmation') {
      throw new Error('当前没有可取消的识别结果')
    }
    await deleteEvidenceFiles(current)
    const clearedEvidence = clearedEvidenceData('member_cancelled')
    await records.doc(recordId).update({ data: {
      recognitionStatus: 'cancelled', reviewStatus: 'cancelled', cancelledAt: db.serverDate(), updatedAt: db.serverDate(),
      ...clearedEvidence
    } })
    return { submission: publicSubmission({ ...current, ...clearedEvidence, recognitionStatus: 'cancelled', reviewStatus: 'cancelled' }) }
  }

  if (action === 'withdraw') {
    const current = (await records.doc(recordId).get()).data
    if (!current || current.reviewStatus !== 'pending_admin_review') {
      throw new Error('当前提交已不在等待审核状态，无法作废')
    }
    const withdrawnEvaluation = current.memberEvaluation || null
    await deleteEvidenceFiles(current)
    const clearedEvidence = clearedEvidenceData('member_withdrawn')
    await records.doc(recordId).update({ data: {
      reviewStatus: 'withdrawn', memberWithdrawnAt: db.serverDate(),
      memberWithdrawnRevision: Number(current.revision || 0),
      withdrawnEvaluation, memberEvaluation: null, updatedAt: db.serverDate(), ...clearedEvidence
    } })
    return { submission: publicSubmission({ ...current, ...clearedEvidence, reviewStatus: 'withdrawn', memberEvaluation: null }) }
  }

  if (action === 'judge') {
    const current = (await records.doc(recordId).get()).data
    if (!current || current.recognitionStatus !== 'ocr_completed' || !current.ocr || current.reviewStatus !== 'pending_member_confirmation') {
      throw new Error('请先完成截图文字识别')
    }
    try {
      const result = await judgeStoredOcr(current.ocr, (current.evidenceFileIds || []).length, month)
      const recognition = {
        ...result.recognized,
        provider: 'openai-compatible', model: JUDGEMENT_MODEL,
        ocrModel: current.ocrModel || OCR_MODEL, judgementModel: JUDGEMENT_MODEL,
        ocr: current.ocr,
        rawResponse: JSON.stringify({ ocr: current.ocrRawResponse || '', judgement: result.rawResponse }).slice(0, 8000)
      }
      await records.doc(recordId).update({ data: {
        recognitionStatus: 'recognized', recognition, recognizedAt: db.serverDate(), updatedAt: db.serverDate()
      } })
      return { submission: publicSubmission({ ...current, recognitionStatus: 'recognized', recognition }) }
    } catch (error) {
      const fallbackActivities = deterministicMonthlySummary(current.ocr, month)
      if (fallbackActivities.length) {
        const suggestedEquivalentKm = round(fallbackActivities.reduce((sum, item) => sum + item.equivalentKm, 0))
        const recognition = {
          sourceApp: '', screenshotMonth: month, confidence: 0.9,
          activities: fallbackActivities, suggestedEquivalentKm, needsReview: true,
          notes: ['数据判断模型未及时返回，已按目标月份明确标注的月度汇总提取；步行已忽略，请重点核对。'],
          provider: 'deterministic-monthly-summary-fallback', model: JUDGEMENT_MODEL,
          ocrModel: current.ocrModel || OCR_MODEL, judgementModel: JUDGEMENT_MODEL,
          ocr: current.ocr, rawResponse: String(error && error.rawResponse || '').slice(0, 8000)
        }
        await records.doc(recordId).update({ data: {
          recognitionStatus: 'recognized', recognition, recognizedAt: db.serverDate(), updatedAt: db.serverDate()
        } })
        return { submission: publicSubmission({ ...current, recognitionStatus: 'recognized', recognition }) }
      }
      const recognition = { error: safeError(error), activities: [], notes: [], ocr: current.ocr }
      if (error && error.rawResponse) recognition.rawResponse = error.rawResponse
      await records.doc(recordId).update({ data: {
        recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed', updatedAt: db.serverDate()
      } })
      return { submission: publicSubmission({ ...current, recognitionStatus: 'failed', recognition, reviewStatus: 'recognition_failed' }) }
    }
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
