const { getHistoricalDashboard } = require('../../services/cloud')
Page({
  data: { profile: null, records: [], average: 0, best: 0 },
  async onShow() {
    try {
      const dashboard = await getHistoricalDashboard()
      const profile = dashboard.profile
      this.setData({ profile, profileName: profile.alias, records: profile.history, average: profile.averageActualKm === null ? '—' : profile.averageActualKm, best: profile.bestActualKm === null ? '—' : profile.bestActualKm })
    } catch (error) {
      console.error('读取个人历史失败', error)
      this.setData({ profile: null, records: [] })
    }
  },
  goRegister() { wx.navigateTo({ url: '/pages/register/register' }) }
})
