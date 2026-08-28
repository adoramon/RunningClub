const { getActivitySubmission, recognizeActivityScreenshots, confirmActivitySubmission, cancelActivityRecognition } = require('../../services/cloud')

function previousMonth() {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const activityLabels = { running: '跑步', cycling: '骑行', swimming: '游泳', jump_rope: '跳绳', elevation: '累计爬升', custom: '其他运动（需审核）' }

Page({
  data: { month: previousMonth(), images: [], submission: null, activities: [], equivalentKm: '', loading: false },
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
      equivalentText: typeof item.equivalentKm === 'number' ? item.equivalentKm : '待审核',
      evidenceImageIndex: item.evidenceImageIndex || 1
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
  async chooseImages() {
    try {
      const result = await wx.chooseMedia({ count: 3, mediaType: ['image'], sourceType: ['album', 'camera'] })
      const images = await Promise.all(result.tempFiles.map(async file => {
        let path = file.tempFilePath
        try { path = (await wx.compressImage({ src: path, quality: 80 })).tempFilePath } catch (_) {}
        return { path }
      }))
      this.setData({ images })
    } catch (_) {}
  },
  inputEquivalentKm(event) { this.setData({ equivalentKm: event.detail.value }) },
  async recognize() {
    if (!this.data.images.length) return wx.showToast({ title: '请先选择运动记录截图', icon: 'none' })
    this.setData({ loading: true })
    wx.showLoading({ title: '正在识别截图…', mask: true })
    try {
      const uploaded = await Promise.all(this.data.images.map((image, index) => {
        const extension = (image.path.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1]
        const suffix = /^(jpg|jpeg|png|webp)$/i.test(extension || '') ? extension.toLowerCase() : 'jpg'
        const cloudPath = `activity-proofs/${this.data.month}/${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}.${suffix}`
        return wx.cloud.uploadFile({ cloudPath, filePath: image.path })
      }))
      const { submission } = await recognizeActivityScreenshots(uploaded.map(item => item.fileID))
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
  },
  cancelRecognition() {
    wx.showModal({
      title: '取消本次识别？',
      content: '取消后不会提交管理员审核，你可以重新选择截图。已上传的凭证会保留用于审计。',
      confirmText: '确认取消',
      confirmColor: '#B24F35',
      success: async result => {
        if (!result.confirm) return
        this.setData({ loading: true })
        try {
          const { submission } = await cancelActivityRecognition()
          this.applySubmission(submission)
          this.setData({ images: [] })
          wx.showToast({ title: '已取消本次识别', icon: 'success' })
        } catch (error) {
          console.error('取消截图识别失败', error)
          wx.showToast({ title: '取消失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ loading: false })
        }
      }
    })
  }
})
