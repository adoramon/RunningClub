const cloud = require('../../services/cloud')
Page({
  data: { wechatNickname: '', alias: '', avatarPath: '', suggestions: [], claimed: false },
  onLoad() {
    const app = getApp()
    if (app.globalData.sessionPromise) {
      app.globalData.sessionPromise.then(session => {
        if (session && session.user.historicalMemberId) this.setData({ alias: session.user.nickname, claimed: true })
      })
    }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  nicknameReview(e) {
    if (!e.detail.pass) wx.showToast({ title: '昵称审核未通过，请调整后重试', icon: 'none' })
  },
  chooseAvatar(e) { this.setData({ avatarPath: e.detail.avatarUrl }) },
  async findSuggestions() {
    const { wechatNickname, avatarPath } = this.data
    if (!wechatNickname.trim() || !avatarPath) return wx.showToast({ title: '请先填写昵称并选择头像', icon: 'none' })
    wx.showLoading({ title: '正在匹配' })
    try { this.setData({ suggestions: await cloud.suggestHistoricalAliases({ nickname: wechatNickname.trim() }) }) } catch (error) { wx.showToast({ title: '匹配失败，请稍后重试', icon: 'none' }) } finally { wx.hideLoading() }
  },
  selectAlias(e) { this.setData({ alias: e.currentTarget.dataset.alias }) },
  goReviewAccess() { wx.navigateTo({ url: '/pages/review-access/review-access' }) },
  async save() {
    const { wechatNickname, alias, avatarPath } = this.data
    if (!wechatNickname.trim() || !avatarPath) return wx.showToast({ title: '请先完成昵称和头像授权', icon: 'none' })
    if (!alias.trim()) return wx.showToast({ title: '请选择或填写历史艺名', icon: 'none' })
    try {
      wx.showLoading({ title: '正在保存' })
      const identity = await cloud.claimHistoricalIdentity({ alias: alias.trim(), wechatNickname: wechatNickname.trim() })
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
