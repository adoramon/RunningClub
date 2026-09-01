function modelContentText(content) {
  return Array.isArray(content)
    ? content.map(item => typeof item === 'string' ? item : item && (item.text || item.content || '')).join('')
    : String(content || '')
}

function jsonObjectCandidates(content) {
  const text = modelContentText(content)
    .replace(/^\uFEFF/, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const candidates = []
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  if (unfenced) candidates.push(unfenced)
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (character === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return [...new Set(candidates)]
}

function parseJsonObject(content) {
  for (const candidate of jsonObjectCandidates(content)) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (_) {}
  }
  const text = modelContentText(content).replace(/```(?:json)?/gi, '').trim()
  if (!text) throw new Error('文字识别模型输出不完整，请重新识别')
  throw new Error('文字识别模型返回了无效 JSON')
}

function parseOcrContent(content, imageCount) {
  const parsed = parseJsonObject(content)
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

module.exports = { modelContentText, parseJsonObject, parseOcrContent }
