const data = require('../../services/data')
Page({
  data: { month: data.monthKey(), distance: '', image: '', submitted: null },
  onShow() { this.setData({ submitted: data.currentSubmission() }) },
  chooseImage() { wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: res => this.setData({ image: res.tempFiles[0].tempFilePath }) }) },
  input(e) { this.setData({ distance: e.detail.value }) },
  submit() {
    if (!data.getProfile()) return wx.showModal({ title: '请先登记承诺', content: '登记后才能提交本月跑量。', success: r => r.confirm && wx.navigateTo({ url: '/pages/register/register' }) })
    if (!this.data.image) return wx.showToast({ title: '请上传运动记录截图', icon: 'none' })
    if (!Number(this.data.distance) || Number(this.data.distance) > 2000) return wx.showToast({ title: '请填写有效跑量', icon: 'none' })
    data.submitRecord({ month: this.data.month, distance: Number(this.data.distance), image: this.data.image, submittedAt: Date.now() })
    this.setData({ submitted: data.currentSubmission() }); wx.showToast({ title: '提交成功', icon: 'success' })
  }
})
