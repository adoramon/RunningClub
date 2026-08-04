const data = require('../../services/data')
Page({
  data: { name: '', target: '', editing: false },
  onLoad() { const profile = data.getProfile(); if (profile) this.setData({ ...profile, editing: true }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  save() {
    const { name, target } = this.data
    if (!name.trim()) return wx.showToast({ title: '请填写跑团昵称', icon: 'none' })
    if (!Number(target) || Number(target) < 1 || Number(target) > 1000) return wx.showToast({ title: '请输入 1–1000 的公里数', icon: 'none' })
    data.saveProfile({ name: name.trim(), target: Number(target) })
    wx.showToast({ title: '承诺已登记', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 700)
  }
})
