const { getActivitySubmission, recognizeActivityScreenshots, confirmActivitySubmission, cancelActivityRecognition, withdrawPendingActivitySubmission, generateMonthlyEvaluation } = require('../../services/cloud')

function previousMonth() {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const activityLabels = { running: '跑步', cycling: '骑行', swimming: '游泳', jump_rope: '跳绳', elevation: '累计爬升', custom: '其他运动（需审核）' }
const round = value => Math.round(value * 100) / 100

function clientEquivalentKm(activity, rawValue) {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value < 0) return null
  const distanceKm = activity.rawUnit === 'm' ? value / 1000 : value
  switch (activity.activityType) {
    case 'running': return round(distanceKm)
    case 'cycling': return round(distanceKm / 3)
    case 'swimming': return round(distanceKm * 5)
    case 'jump_rope': return round(value / 100)
    case 'elevation': return round(value * 0.02)
    default: return null
  }
}

function clientUnitValid(activity) {
  if (['running', 'cycling', 'swimming'].includes(activity.activityType)) return activity.rawUnit === 'km' || activity.rawUnit === 'm'
  if (activity.activityType === 'jump_rope') return activity.rawUnit === 'count'
  return activity.activityType === 'elevation' ? activity.rawUnit === 'm' : false
}

Page({
  data: { month: previousMonth(), images: [], submission: null, activities: [], reviewActivities: [], evidenceFiles: [], reviewTotalText: '0.00', loading: false },
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
    const activities = (recognition.activities || []).map((item, activityIndex) => ({
      ...item,
      activityIndex,
      activityLabel: activityLabels[item.activityType] || activityLabels.custom,
      equivalentText: typeof item.equivalentKm === 'number' ? item.equivalentKm : '待审核',
      evidenceImageIndex: item.evidenceImageIndex || 1
    }))
    const reviewActivities = activities.map(item => ({
      ...item, invalidUnit: !clientUnitValid(item), included: clientUnitValid(item), rawValueText: String(item.rawValue),
      reviewEquivalentKm: item.equivalentKm, reviewEquivalentText: typeof item.equivalentKm === 'number' ? item.equivalentKm.toFixed(2) : '待审核'
    }))
    this.setData({
      submission,
      activities,
      reviewActivities,
      evidenceFiles: (submission.evidenceFileIds || []).map((fileId, index) => ({ fileId, index: index + 1 })),
      confidenceText: Math.round((recognition.confidence || 0) * 100),
      reviewTotalText: this.reviewTotalText(reviewActivities)
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
  reviewTotalText(reviewActivities) {
    const total = reviewActivities.reduce((sum, item) => sum + (item.included && typeof item.reviewEquivalentKm === 'number' ? item.reviewEquivalentKm : 0), 0)
    return round(total).toFixed(2)
  },
  inputActivityValue(event) {
    const activityIndex = Number(event.currentTarget.dataset.index)
    const rawValueText = event.detail.value
    const reviewActivities = this.data.reviewActivities.map(item => {
      if (item.activityIndex !== activityIndex) return item
      const reviewEquivalentKm = clientEquivalentKm(item, rawValueText)
      return { ...item, rawValueText, reviewEquivalentKm, reviewEquivalentText: typeof reviewEquivalentKm === 'number' ? reviewEquivalentKm.toFixed(2) : '—' }
    })
    this.setData({ reviewActivities, reviewTotalText: this.reviewTotalText(reviewActivities) })
  },
  toggleActivity(event) {
    const activityIndex = Number(event.currentTarget.dataset.index)
    const reviewActivities = this.data.reviewActivities.map(item => item.activityIndex === activityIndex && !item.invalidUnit ? { ...item, included: !item.included } : item)
    this.setData({ reviewActivities, reviewTotalText: this.reviewTotalText(reviewActivities) })
  },
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
    const reviewedActivities = this.data.reviewActivities.map(item => ({ activityIndex: item.activityIndex, included: item.included, rawValue: item.rawValueText }))
    if (!reviewedActivities.some(item => item.included)) return wx.showToast({ title: '请至少计入一项运动', icon: 'none' })
    this.setData({ loading: true })
    try {
      const { submission } = await confirmActivitySubmission({ reviewedActivities, confirmedEquivalentKm: this.data.reviewTotalText })
      this.applySubmission(submission)
      wx.showToast({ title: '已提交，等待管理员审核', icon: 'success' })
      generateMonthlyEvaluation().catch(error => console.warn('阶段性评价稍后生成', error))
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
  },
  withdrawSubmission() {
    wx.showModal({
      title: '作废本次提交？',
      content: '作废后管理员将无法审核当前提交，你可以重新选择截图。原始截图会保留用于审计。',
      confirmText: '确认作废',
      confirmColor: '#B24F35',
      success: async result => {
        if (!result.confirm) return
        this.setData({ loading: true })
        try {
          const { submission } = await withdrawPendingActivitySubmission()
          this.applySubmission(submission)
          this.setData({ images: [] })
          wx.showToast({ title: '已作废，请重新提交', icon: 'success' })
        } catch (error) {
          console.error('作废待审核提交失败', error)
          wx.showToast({ title: error.message || '作废失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ loading: false })
        }
      },
      fail: error => {
        console.error('打开作废确认弹窗失败', error)
        wx.showToast({ title: '暂时无法打开确认窗口', icon: 'none' })
      }
    })
  }
})
