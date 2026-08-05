const { getHistoricalDashboard, getLifetimeStats } = require('../../services/cloud')

Page({
  data: { dashboard: null, pct: 0, authorized: false, redirecting: false },
  onShow() {
    const app = getApp()
    app.globalData.sessionPromise.then(session => {
      if (!session || !session.user.historicalMemberId) {
        if (!this.data.redirecting) {
          this.setData({ redirecting: true })
          wx.navigateTo({ url: '/pages/register/register' })
        }
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
  goUpload() { wx.switchTab({ url: '/pages/upload/upload' }) }
})
