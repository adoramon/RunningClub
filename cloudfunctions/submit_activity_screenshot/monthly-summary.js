function monthFromLine(line, expectedYear) {
  const match = String(line || '').match(/(20\d{2})\s*(?:年|[-/.])\s*(1[0-2]|0?[1-9])\s*月?/)
    || String(line || '').match(/(^|\D)(1[0-2]|0?[1-9])\s*月(?!个)/)
  if (!match) return null
  const year = match.length > 2 && /^20\d{2}$/.test(match[1]) ? match[1] : expectedYear
  const month = match.length > 2 && /^20\d{2}$/.test(match[1]) ? match[2] : match[2]
  return `${year}-${String(Number(month)).padStart(2, '0')}`
}

function numericOnly(line) {
  const match = String(line || '').trim().match(/^([0-9][0-9,，]*(?:\.[0-9]+)?)$/)
  if (!match) return null
  const value = Number(match[1].replace(/[,，]/g, ''))
  return Number.isFinite(value) ? value : null
}

function labelActivity(line) {
  const text = String(line || '').trim()
  const match = text.match(/^(跑步|骑行|自行车|游泳|跳绳|累计爬升|总爬升|爬升高度|海拔增益)\s*[（(]?\s*(公里|千米|km|米|m|次|个)\s*[)）]?$/i)
  if (!match) return null
  const typeByLabel = {
    跑步: 'running', 骑行: 'cycling', 自行车: 'cycling', 游泳: 'swimming', 跳绳: 'jump_rope',
    累计爬升: 'elevation', 总爬升: 'elevation', 爬升高度: 'elevation', 海拔增益: 'elevation'
  }
  const unitText = match[2].toLowerCase()
  const rawUnit = ['公里', '千米', 'km'].includes(unitText) ? 'km' : ['米', 'm'].includes(unitText) ? 'm' : 'count'
  return { activityType: typeByLabel[match[1]], rawUnit }
}

function equivalentKm(activityType, rawValue, rawUnit) {
  const distanceKm = rawUnit === 'm' ? rawValue / 1000 : rawValue
  if (activityType === 'running') return distanceKm
  if (activityType === 'cycling') return distanceKm / 3
  if (activityType === 'swimming') return distanceKm * 5
  if (activityType === 'jump_rope') return rawValue / 100
  if (activityType === 'elevation') return rawValue * 0.02
  return null
}

function deterministicMonthlySummary(ocr, expectedMonth) {
  const expectedYear = String(expectedMonth || '').slice(0, 4)
  const activities = []
  for (const image of Array.isArray(ocr && ocr.images) ? ocr.images : []) {
    const lines = Array.isArray(image.lines) ? image.lines.map(item => String(item || '').trim()) : []
    const sectionStarts = lines.map((line, index) => ({ index, month: monthFromLine(line, expectedYear) })).filter(item => item.month)
    const target = sectionStarts.find(item => item.month === expectedMonth)
    if (!target) continue
    const nextSection = sectionStarts.find(item => item.index > target.index)
    const end = nextSection ? nextSection.index : lines.length
    for (let index = target.index + 1; index < end; index += 1) {
      const label = labelActivity(lines[index])
      if (!label) continue
      const rawValue = numericOnly(lines[index - 1])
      if (rawValue === null) continue
      const converted = equivalentKm(label.activityType, rawValue, label.rawUnit)
      if (!Number.isFinite(converted)) continue
      activities.push({
        activityType: label.activityType,
        activityMonth: expectedMonth,
        rawValue,
        rawUnit: label.rawUnit,
        equivalentKm: Math.round(converted * 100) / 100,
        evidenceImageIndex: Number(image.imageIndex) || 1,
        evidenceLineIndexes: [target.index + 1, index, index + 1],
        evidence: `${lines[target.index]} · ${lines[index - 1]} · ${lines[index]}`.slice(0, 180)
      })
    }
  }
  return activities
}

module.exports = { deterministicMonthlySummary, labelActivity, monthFromLine, numericOnly }
