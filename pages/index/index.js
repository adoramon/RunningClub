const { getHistoricalDashboard, getLifetimeStats, withdrawPendingActivitySubmission } = require('../../services/cloud')
const reviewDemo = require('../../services/review-demo')

Page({
  data: { dashboard: null, pct: 0, authorized: false, redirecting: false, withdrawingSubmission: false },
  onShow() {
    const app = getApp()
    app.globalData.sessionPromise.then(session => {
      if (!session || (!session.user.historicalMemberId && !session.user.reviewAccess)) {
        if (!this.data.redirecting) {
          this.setData({ redirecting: true })
          wx.navigateTo({ url: '/pages/register/register' })
        }
        return
      }
      if (session.user.reviewAccess && !session.user.historicalMemberId) {
        const dashboard = reviewDemo.demoDashboard()
        this.setData({ authorized: true, redirecting: false, dashboard, pct: dashboard.completionPct })
        return
      }
      this.setData({ authorized: true, redirecting: false })
      this.refresh()
    })
  },
  async refresh() {
    try {
      const dashboard = await getHistoricalDashboard()
      this.setData({ dashboard, pct: dashboard.completionPct })
      this.loadLifetime()
    } catch (error) {
      console.error('读取历史看板失败', error)
      wx.showToast({ title: '历史数据读取失败', icon: 'none' })
    }
  },
  async loadLifetime() {
    try {
      const lifetime = await getLifetimeStats()
      this.setData({ 'dashboard.lifetime': lifetime })
    } catch (error) {
      console.error('读取累计跑量失败', error)
    }
  },
  goMemberAnalysis(event) {
    const { memberId } = event.currentTarget.dataset
    if (!memberId) return
    wx.navigateTo({ url: `/pages/member-analysis/member-analysis?memberId=${encodeURIComponent(memberId)}` })
  },
  goUpload() { wx.navigateTo({ url: '/pages/upload/upload' }) },
  withdrawSubmission() {
    wx.showModal({
      title: '作废本次提交？',
      content: '作废后管理员将无法审核当前提交，云端截图将立即删除且无法恢复。你可以重新上传截图。',
      confirmText: '确认作废',
      confirmColor: '#B24F35',
      success: async result => {
        if (!result.confirm) return
        this.setData({ withdrawingSubmission: true })
        try {
          await withdrawPendingActivitySubmission()
          await this.refresh()
          wx.navigateTo({ url: '/pages/upload/upload' })
        } catch (error) {
          console.error('作废待审核提交失败', error)
          wx.showToast({ title: error.message || '作废失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ withdrawingSubmission: false })
        }
      },
      fail: error => {
        console.error('打开作废确认弹窗失败', error)
        wx.showToast({ title: '暂时无法打开确认窗口', icon: 'none' })
      }
    })
  },
  goFundLedger() { wx.navigateTo({ url: '/pages/fund-ledger/fund-ledger' }) },
  goReview() { wx.navigateTo({ url: '/pages/review/review' }) }
})
