const data = require('../../services/data')

Page({
  data: { dashboard: null, pct: 0 },
  onShow() { this.refresh() },
  refresh() {
    const dashboard = data.getDashboard()
    this.setData({ dashboard, pct: dashboard.totalTarget ? Math.min(100, Math.round(dashboard.totalActual / dashboard.totalTarget * 100)) : 0 })
  },
  goRegister() { wx.navigateTo({ url: '/pages/register/register' }) },
  goUpload() { wx.switchTab({ url: '/pages/upload/upload' }) }
})
