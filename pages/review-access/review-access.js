const cloud = require('../../services/cloud')

Page({
  data: { wechatNickname: '', avatarPath: '', accessCode: '', loading: false },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },
  nicknameReview(event) {
    if (!event.detail.pass) wx.showToast({ title: '昵称审核未通过，请调整后重试', icon: 'none' })
  },
  chooseAvatar(event) { this.setData({ avatarPath: event.detail.avatarUrl }) },
  async enter() {
    const { wechatNickname, avatarPath, accessCode } = this.data
    if (!wechatNickname.trim() || !avatarPath) return wx.showToast({ title: '请先完成昵称和头像授权', icon: 'none' })
    if (!accessCode.trim()) return wx.showToast({ title: '请输入审核码', icon: 'none' })
    this.setData({ loading: true })
    try {
      const access = await cloud.claimReviewAccess({ wechatNickname: wechatNickname.trim(), accessCode: accessCode.trim() })
      const uploaded = await wx.cloud.uploadFile({ cloudPath: `review-avatars/${access.userId}/${Date.now()}.png`, filePath: avatarPath })
      await cloud.saveProfileAvatar({ avatarFileId: uploaded.fileID })
      const app = getApp()
      if (app.globalData.session) app.globalData.session.user = { ...app.globalData.session.user, reviewAccess: true }
      wx.showToast({ title: '已进入审核体验', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) {
      console.error('进入审核体验失败', error)
      wx.showToast({ title: error && error.message ? error.message : '验证失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
