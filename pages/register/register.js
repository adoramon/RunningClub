const data = require('../../services/data')
const cloud = require('../../services/cloud')
Page({
  data: { name: '', target: '', editing: false },
  onLoad() {
    const localProfile = data.getProfile()
    if (localProfile) this.setData({ ...localProfile, editing: true })
    const app = getApp()
    if (app.globalData.sessionPromise) {
      app.globalData.sessionPromise.then(session => {
        if (session && session.user.nickname) this.setData({ name: session.user.nickname, editing: true })
      })
    }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  async save() {
    const { name, target } = this.data
    if (!name.trim()) return wx.showToast({ title: '请填写跑团昵称', icon: 'none' })
    if (!Number(target) || Number(target) < 1 || Number(target) > 1000) return wx.showToast({ title: '请输入 1–1000 的公里数', icon: 'none' })
    try {
      wx.showLoading({ title: '正在保存' })
      const user = await cloud.updateProfile({ nickname: name.trim() })
      const app = getApp()
      if (app.globalData.session) app.globalData.session.user = { ...app.globalData.session.user, ...user }
      data.saveProfile({ name: name.trim(), target: Number(target) })
      wx.hideLoading()
      wx.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.hideLoading()
      console.error('保存用户资料失败', error)
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    }
  }
})
