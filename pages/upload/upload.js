const { getActivitySubmission, recognizeActivityScreenshot, confirmActivitySubmission } = require('../../services/cloud')

function previousMonth() {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const activityLabels = { running: '跑步', cycling: '骑行', swimming: '游泳', jump_rope: '跳绳', elevation: '累计爬升', custom: '其他运动（需审核）' }

Page({
  data: { month: previousMonth(), image: '', submission: null, activities: [], equivalentKm: '', loading: false },
  onShow() { this.loadSubmission() },
  async loadSubmission() {
    try {
      const { submission } = await getActivitySubmission()
      if (submission) this.applySubmission(submission)
    } catch (error) {
      console.error('读取上月提交记录失败', error)
    }
  },
  applySubmission(submission) {
    const recognition = submission.recognition || {}
    const activities = (recognition.activities || []).map(item => ({
      ...item,
      activityLabel: activityLabels[item.activityType] || activityLabels.custom,
      equivalentText: typeof item.equivalentKm === 'number' ? item.equivalentKm : '待审核'
    }))
    this.setData({
      submission,
      activities,
      confidenceText: Math.round((recognition.confidence || 0) * 100),
      equivalentKm: submission.memberConfirmedEquivalentKm === null || submission.memberConfirmedEquivalentKm === undefined
        ? (recognition.suggestedEquivalentKm === null || recognition.suggestedEquivalentKm === undefined ? '' : String(recognition.suggestedEquivalentKm))
        : String(submission.memberConfirmedEquivalentKm)
    })
  },
  async chooseImage() {
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
      let image = result.tempFiles[0].tempFilePath
      try { image = await wx.compressImage({ src: image, quality: 80 }).then(value => value.tempFilePath) } catch (_) {}
      this.setData({ image })
    } catch (_) {}
  },
  inputEquivalentKm(event) { this.setData({ equivalentKm: event.detail.value }) },
  async recognize() {
    if (!this.data.image) return wx.showToast({ title: '请先选择运动记录截图', icon: 'none' })
    this.setData({ loading: true })
    wx.showLoading({ title: '正在识别截图…', mask: true })
    try {
      const extension = (this.data.image.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1]
      const suffix = /^(jpg|jpeg|png|webp)$/i.test(extension || '') ? extension.toLowerCase() : 'jpg'
      const cloudPath = `activity-proofs/${this.data.month}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${suffix}`
      const uploaded = await wx.cloud.uploadFile({ cloudPath, filePath: this.data.image })
      const { submission } = await recognizeActivityScreenshot(uploaded.fileID)
      this.applySubmission(submission)
      if (submission.recognitionStatus === 'recognized') wx.showToast({ title: '识别完成，请确认结果', icon: 'success' })
      else wx.showToast({ title: submission.recognition.error || '识别失败，请更换清晰截图', icon: 'none', duration: 3200 })
    } catch (error) {
      console.error('识别运动截图失败', error)
      wx.showToast({ title: '截图识别失败，请稍后重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  },
  async confirm() {
    const value = Number(this.data.equivalentKm)
    if (!Number.isFinite(value) || value < 0 || value > 10000) return wx.showToast({ title: '请确认有效的等效跑量', icon: 'none' })
    this.setData({ loading: true })
    try {
      const { submission } = await confirmActivitySubmission(value)
      this.applySubmission(submission)
      wx.showToast({ title: '已提交，等待管理员审核', icon: 'success' })
    } catch (error) {
      console.error('确认跑量失败', error)
      wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
