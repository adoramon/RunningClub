const { getPendingActivityReviews, approveActivityReview } = require('../../services/cloud')

const labels = { running: '跑步', cycling: '骑行', swimming: '游泳', jump_rope: '跳绳', elevation: '累计爬升', custom: '其他运动' }

Page({
  data: { reviews: [], loading: true, approvingId: '' },
  onShow() { this.loadReviews() },
  async loadReviews() {
    this.setData({ loading: true })
    try {
      const { reviews } = await getPendingActivityReviews()
      this.setData({ reviews: (reviews || []).map(review => ({
        ...review,
        activities: (review.activities || []).map(item => ({ ...item, label: labels[item.activityType] || labels.custom, equivalentText: Number(item.equivalentKm || 0).toFixed(2) })),
        evidenceFiles: (review.evidenceFileIds || []).map((fileId, index) => ({ fileId, index: index + 1 }))
      })) })
    } catch (error) {
      console.error('读取审核队列失败', error)
      wx.showToast({ title: '读取审核队列失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  approve(event) {
    const submissionId = event.currentTarget.dataset.id
    wx.showModal({
      title: '通过本次审核？',
      content: '通过后将作为该成员上月已审核跑量，另一位管理员无需重复审核。',
      confirmText: '通过审核',
      confirmColor: '#1F6F54',
      success: async result => {
        if (!result.confirm) return
        this.setData({ approvingId: submissionId })
        try {
          await approveActivityReview(submissionId)
          wx.showToast({ title: '审核已通过', icon: 'success' })
          this.loadReviews()
        } catch (error) {
          console.error('通过审核失败', error)
          wx.showToast({ title: '审核失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ approvingId: '' })
        }
      }
    })
  }
})
