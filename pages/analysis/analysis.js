const data = require('../../services/data')
Page({
  data: { profile: null, records: [], average: 0, best: 0 },
  onShow() {
    const records = data.getSubmissions(); const kms = records.map(x => Number(x.distance));
    const profile = data.getProfile()
    this.setData({ profile, profileName: profile ? profile.name.toUpperCase() : '', records, average: kms.length ? (kms.reduce((a,b) => a+b, 0) / kms.length).toFixed(1) : 0, best: kms.length ? Math.max(...kms) : 0 })
  },
  goRegister() { wx.navigateTo({ url: '/pages/register/register' }) }
})
