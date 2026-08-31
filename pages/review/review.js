const { getPendingActivityReviews, approveActivityReview, voidActivityReview, resolveMissingSubmission, confirmPendingFundPayment } = require('../../services/cloud')

const labels = { running: '跑步', cycling: '骑行', swimming: '游泳', jump_rope: '跳绳', elevation: '累计爬升', custom: '其他运动' }

function normalizedUnit(unit) {
  const value = String(unit || '').trim().toLowerCase()
  if (['km', '公里', '千米'].includes(value)) return 'km'
  if (['m', '米'].includes(value)) return 'm'
  if (['次', '个', 'count'].includes(value)) return 'count'
  return value
}
function validUnit(type, unit) {
  const normalized = normalizedUnit(unit)
  if (['running', 'cycling', 'swimming'].includes(type)) return ['km', 'm'].includes(normalized)
  if (type === 'jump_rope') return normalized === 'count'
  if (type === 'elevation') return normalized === 'm'
  return false
}
function equivalentKm(type, rawValue, unit) {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value < 0 || !validUnit(type, unit)) return null
  const distance = normalizedUnit(unit) === 'm' ? value / 1000 : value
  if (type === 'running') return distance
  if (type === 'cycling') return distance / 3
  if (type === 'swimming') return distance * 5
  if (type === 'jump_rope') return value / 100
  if (type === 'elevation') return value * 0.02
  return null
}
function enrichReview(review) {
  const activities = (review.activities || []).map((item, index) => {
    const rawValue = Number(item.rawValue || 0)
    const included = item.included !== false
    const computed = equivalentKm(item.activityType, rawValue, item.rawUnit)
    return {
      ...item, activityIndex: Number.isInteger(item.activityIndex) ? item.activityIndex : index,
      label: labels[item.activityType] || labels.custom, included, rawValueText: String(item.rawValue ?? ''),
      invalidUnit: !validUnit(item.activityType, item.rawUnit), reviewEquivalentKm: computed,
      reviewEquivalentText: computed === null ? '待核对' : computed.toFixed(2)
    }
  })
  const total = activities.reduce((sum, item) => sum + (item.included && item.reviewEquivalentKm !== null ? item.reviewEquivalentKm : 0), 0)
  const evidenceFiles = review.evidenceFiles || (review.evidenceFileIds || []).map((fileId, index) => ({ fileId, index: index + 1, tempUrl: fileId }))
  return { ...review, activities, evidenceFiles, adminTotalText: total.toFixed(2), voidReason: '' }
}

async function resolveEvidenceUrls(reviews) {
  const fileIds = [...new Set(reviews.flatMap(review =>
    (review.evidenceFiles || []).filter(item => !item.tempUrl && item.fileId).map(item => item.fileId)
  ))]
  if (!fileIds.length) return reviews
  try {
    const result = await wx.cloud.getTempFileURL({ fileList: fileIds })
    const urlsByFileId = new Map((result.fileList || [])
      .filter(item => Number(item.status) === 0 && item.tempFileURL)
      .map(item => [item.fileID || item.fileId, item.tempFileURL]))
    return reviews.map(review => ({
      ...review,
      evidenceFiles: (review.evidenceFiles || []).map(item => ({
        ...item, tempUrl: item.tempUrl || urlsByFileId.get(item.fileId) || ''
      }))
    }))
  } catch (error) {
    console.warn('客户端截图临时链接生成失败', error)
    return reviews
  }
}

Page({
  data: { reviews: [], missingSubmissions: [], pendingFundPayments: [], loading: true, actingId: '' },
  onShow() { this.loadReviews() },
  async loadReviews() {
    this.setData({ loading: true })
    try {
      const result = await getPendingActivityReviews()
      const reviews = await resolveEvidenceUrls((result.reviews || []).map(enrichReview))
      this.setData({ reviews, missingSubmissions: result.missingSubmissions || [], pendingFundPayments: result.pendingFundPayments || [] })
      return result
    } catch (error) {
      console.error('读取审核队列失败', error)
      wx.showToast({ title: '读取审核队列失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  updateReview(submissionId, updater) {
    this.setData({ reviews: this.data.reviews.map(review => review.submissionId === submissionId ? enrichReview(updater(review)) : review) })
  },
  inputActivityValue(event) {
    const { id, index } = event.currentTarget.dataset
    const rawValue = event.detail.value
    const activityIndex = Number(index)
    this.updateReview(id, review => ({ ...review, activities: review.activities.map(item => item.activityIndex === activityIndex ? { ...item, rawValue, rawValueText: rawValue } : item) }))
  },
  toggleActivity(event) {
    const { id, index } = event.currentTarget.dataset
    const activityIndex = Number(index)
    this.updateReview(id, review => ({ ...review, activities: review.activities.map(item => item.activityIndex === activityIndex ? { ...item, included: !item.included } : item) }))
  },
  inputVoidReason(event) {
    const id = event.currentTarget.dataset.id
    const voidReason = event.detail.value
    this.updateReview(id, review => ({ ...review, voidReason }))
  },
  async previewEvidence(event) {
    const { id, url, fileId } = event.currentTarget.dataset
    const review = this.data.reviews.find(item => item.submissionId === id)
    const urls = review ? review.evidenceFiles.map(item => item.tempUrl).filter(Boolean) : []
    if (url && urls.length) {
      wx.previewImage({ current: url, urls })
      return
    }
    const fileIds = review ? review.evidenceFiles.map(item => item.fileId).filter(Boolean) : [fileId].filter(Boolean)
    if (!fileIds.length) {
      wx.showToast({ title: '未找到原始截图', icon: 'none' })
      return
    }
    wx.showLoading({ title: '正在加载原图' })
    try {
      const downloads = await Promise.all(fileIds.map(fileID => wx.cloud.downloadFile({ fileID })))
      const localPaths = downloads.map(item => item.tempFilePath).filter(Boolean)
      if (!localPaths.length) throw new Error('下载截图失败')
      wx.previewImage({ current: localPaths[0], urls: localPaths })
    } catch (error) {
      console.error('下载审核截图失败', error)
      wx.showToast({ title: '原图暂不可访问，请稍后重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  approve(event) {
    const submissionId = event.currentTarget.dataset.id
    const review = this.data.reviews.find(item => item.submissionId === submissionId)
    if (!review || !review.activities.some(item => item.included && item.reviewEquivalentKm !== null)) {
      wx.showToast({ title: '请至少计入一项有效运动数据', icon: 'none' })
      return
    }
    wx.showModal({
      title: '通过本次审核？',
      content: `将按管理员核定的 ${review.adminTotalText} km 保存，另一位管理员无需重复审核。`,
      confirmText: '通过审核',
      confirmColor: '#1F6F54',
      success: async result => {
        if (!result.confirm) return
        this.setData({ actingId: submissionId })
        try {
          await approveActivityReview({ submissionId, reviewedActivities: review.activities.map(item => ({ activityIndex: item.activityIndex, rawValue: item.rawValueText, included: item.included })) })
          wx.showToast({ title: '审核已通过', icon: 'success' })
          const refreshed = await this.loadReviews()
          const payment = (refreshed && refreshed.pendingFundPayments || []).find(item => item.memberId === review.memberId || item.alias === review.memberAlias)
          if (payment) this.promptFundPayment(payment)
        } catch (error) {
          console.error('通过审核失败', error)
          wx.showToast({ title: '审核失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ actingId: '' })
        }
      }
    })
  },
  voidReview(event) {
    const submissionId = event.currentTarget.dataset.id
    const review = this.data.reviews.find(item => item.submissionId === submissionId)
    const voidReason = String(review && review.voidReason || '').trim()
    if (!voidReason) {
      wx.showToast({ title: '请填写作废原因', icon: 'none' })
      return
    }
    wx.showModal({
      title: '作废本次提交？', content: '成员会看到作废原因，并可重新上传截图。原始截图会保留用于审计。',
      confirmText: '确认作废', confirmColor: '#B64335',
      success: async result => {
        if (!result.confirm) return
        this.setData({ actingId: submissionId })
        try {
          await voidActivityReview({ submissionId, voidReason })
          wx.showToast({ title: '已作废并通知成员', icon: 'success' })
          this.loadReviews()
        } catch (error) {
          console.error('作废审核失败', error)
          wx.showToast({ title: '作废失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ actingId: '' })
        }
      }
    })
  },
  resolveMissing(event) {
    const { id, resolution } = event.currentTarget.dataset
    const member = this.data.missingSubmissions.find(item => item.memberId === id)
    if (!member) return
    const isFund = resolution === 'fund_paid'
    wx.showModal({
      title: isFund ? '确认已缴纳公积金？' : '设为上月请假？',
      content: isFund
        ? `${member.displayName} 上月承诺 ${member.targetText} km，连续未达标第 ${member.failureStreak} 月，应缴 ¥${member.fundDueText}。确认到账后将计入跑团公积金。`
        : `将 ${member.displayName} 标记为 ${member.month} 提前请假，不计入本次公积金。`,
      confirmText: isFund ? '确认已缴 ¥' + member.fundDueText : '确认请假',
      confirmColor: isFund ? '#1F6F54' : '#A96E27',
      success: async result => {
        if (!result.confirm) return
        this.setData({ actingId: id })
        try {
          await resolveMissingSubmission({ memberId: id, resolution })
          wx.showToast({ title: isFund ? '已计入公积金' : '已设为上月请假', icon: 'success' })
          this.loadReviews()
        } catch (error) {
          console.error('处理未提交跑量失败', error)
          wx.showToast({ title: error.message || '处理失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ actingId: '' })
        }
      }
    })
  },
  promptFundPayment(payment) {
    wx.showModal({
      title: '跑量未达标，确认已缴公积金？',
      content: `${payment.displayName} 上月实际 ${payment.actualText} km，承诺 ${payment.targetText} km，连续未达标第 ${payment.failureStreak} 月，应缴 ¥${payment.fundDueText}。`,
      confirmText: '确认已缴 ¥' + payment.fundDueText,
      confirmColor: '#1F6F54',
      success: result => {
        if (result.confirm) this.confirmFundPayment(payment.memberId)
      }
    })
  },
  confirmFundPayment(argument) {
    const memberId = typeof argument === 'string' ? argument : argument.currentTarget.dataset.id
    this.setData({ actingId: memberId })
    confirmPendingFundPayment({ memberId }).then(() => {
      wx.showToast({ title: '已计入公积金', icon: 'success' })
      return this.loadReviews()
    }).catch(error => {
      console.error('确认公积金失败', error)
      wx.showToast({ title: error.message || '确认失败，请稍后重试', icon: 'none' })
    }).finally(() => this.setData({ actingId: '' }))
  }
})
