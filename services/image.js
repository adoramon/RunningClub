const DEFAULT_MAX_LONG_EDGE = 1800
const DEFAULT_MAX_PIXELS = 1600000

function fitImageDimensions(width, height, maxLongEdge = DEFAULT_MAX_LONG_EDGE, maxPixels = DEFAULT_MAX_PIXELS) {
  const sourceWidth = Number(width)
  const sourceHeight = Number(height)
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null
  const longEdgeScale = maxLongEdge / Math.max(sourceWidth, sourceHeight)
  const pixelScale = Math.sqrt(maxPixels / (sourceWidth * sourceHeight))
  const scale = Math.min(1, longEdgeScale, pixelScale)
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    resized: scale < 0.999
  }
}

async function compressActivityScreenshot(path) {
  let dimensions = null
  try {
    const info = await wx.getImageInfo({ src: path })
    dimensions = fitImageDimensions(info.width, info.height)
  } catch (_) {}
  const options = { src: path, quality: 82 }
  if (dimensions && dimensions.resized) {
    options.compressedWidth = dimensions.width
    options.compressedHeight = dimensions.height
  }
  try {
    const result = await wx.compressImage(options)
    return result.tempFilePath
  } catch (_) {
    return path
  }
}

module.exports = { fitImageDimensions, compressActivityScreenshot }
