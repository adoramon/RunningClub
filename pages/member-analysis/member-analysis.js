const { getMemberHistoricalProfile } = require('../../services/cloud')

Page({
  data: { profile: null, profileName: '', historyYears: [], average: '—', best: '—', loading: true },
  async onLoad(options) {
    const memberId = options.memberId ? decodeURIComponent(options.memberId) : ''
    if (!memberId) {
      wx.showToast({ title: '成员信息无效', icon: 'none' })
      return
    }
    try {
      const profile = await getMemberHistoricalProfile(memberId)
      this.setData({
        profile,
        profileName: profile.displayName || profile.alias,
        historyYears: profile.historyYears || [],
        average: profile.averageActualKm === null ? '—' : profile.averageActualKm,
        best: profile.bestActualKm === null ? '—' : profile.bestActualKm,
        loading: false
      })
      wx.setNavigationBarTitle({ title: `${profile.displayName || profile.alias}的分析` })
    } catch (error) {
      console.error('读取成员历史失败', error)
      this.setData({ loading: false })
      wx.showToast({ title: '成员数据读取失败', icon: 'none' })
    }
  }
})
