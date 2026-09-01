const assert = require('node:assert/strict')
const { parseJsonObject, parseOcrContent } = require('../cloudfunctions/ocr_activity_screenshot/parser')
const { fitImageDimensions } = require('../services/image')

const fenced = parseOcrContent('```json\n{"images":[{"imageIndex":1,"lines":["累计骑行 198.21 公里"],"confidence":0.9}],"notes":[]}\n```', 1)
assert.equal(fenced.images[0].lines[0], '累计骑行 198.21 公里')

const reasoned = parseJsonObject('<think>先整理文字，花括号 { 不属于答案。</think>\n识别结果如下：\n{"images":[],"notes":["测试"]}\n谢谢')
assert.deepEqual(reasoned.notes, ['测试'])

assert.throws(() => parseJsonObject('```'), /输出不完整/)

assert.deepEqual(fitImageDimensions(1264, 2736), { width: 832, height: 1800, resized: true })
assert.deepEqual(fitImageDimensions(900, 1200), { width: 900, height: 1200, resized: false })

console.log('OCR 解析与截图尺寸测试通过')
