const cloud = require('../../services/cloud')
Page({
  data: { name: '', avatarPath: '', claimed: false },
  onLoad() {
    const app = getApp()
    if (app.globalData.sessionPromise) {
      app.globalData.sessionPromise.then(session => {
        if (session && session.user.historicalMemberId) this.setData({ name: session.user.nickname, claimed: true })
      })
    }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseAvatar(e) { this.setData({ avatarPath: e.detail.avatarUrl }) },
  async save() {
    const { name, avatarPath } = this.data
    if (!name.trim()) return wx.showToast({ title: '请填写跑团昵称', icon: 'none' })
    try {
      wx.showLoading({ title: '正在保存' })
      const identity = await cloud.claimHistoricalIdentity({ alias: name.trim() })
      let avatarFileId = ''
      if (avatarPath) {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: `avatars/${identity.userId}/${Date.now()}.png`, filePath: avatarPath })
        avatarFileId = uploaded.fileID
        await cloud.saveProfileAvatar({ avatarFileId })
      }
      const app = getApp()
      if (app.globalData.session) app.globalData.session.user = { ...app.globalData.session.user, nickname: identity.alias, historicalMemberId: identity.historicalMemberId, avatarFileId }
      wx.hideLoading()
      wx.showToast({ title: '身份已绑定', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.hideLoading()
      console.error('保存用户资料失败', error)
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    }
  }
})
