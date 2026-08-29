const { getFundLedger, withdrawFund } = require('../../services/cloud')

Page({
  data: { ledger: null, amount: '', purpose: '', loading: true, submitting: false },
  onShow() { this.loadLedger() },
  async loadLedger() {
    this.setData({ loading: true })
    try { this.setData({ ledger: await getFundLedger() }) }
    catch (error) { console.error('读取公积金流水失败', error); wx.showToast({ title: error.message || '读取公示失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },
  withdraw() {
    const amount = Number(this.data.amount)
    const purpose = this.data.purpose.trim()
    if (!Number.isFinite(amount) || amount <= 0) return wx.showToast({ title: '请输入有效的提取金额', icon: 'none' })
    if (purpose.length < 2) return wx.showToast({ title: '请填写提取用途', icon: 'none' })
    wx.showModal({ title: '确认提取公积金？', content: `本次将支取 ¥${amount.toFixed(2)}，用途：${purpose}。确认后会立即写入所有成员可见的公积金流水。`, confirmText: '确认支取', confirmColor: '#B54C3E', success: async result => {
      if (!result.confirm) return
      this.setData({ submitting: true })
      try { await withdrawFund({ amount, purpose }); this.setData({ amount: '', purpose: '' }); wx.showToast({ title: '已记入公积金流水', icon: 'success' }); await this.loadLedger() }
      catch (error) { console.error('提取公积金失败', error); wx.showToast({ title: error.message || '提取失败', icon: 'none' }) }
      finally { this.setData({ submitting: false }) }
    } })
  }
})
