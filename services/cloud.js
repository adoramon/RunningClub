function getCurrentUser() {
  return wx.cloud.callFunction({ name: 'get_current_user' }).then(result => result.result)
}

function claimHistoricalIdentity(payload) {
  return wx.cloud.callFunction({ name: 'claim_historical_identity', data: payload }).then(result => result.result)
}

function claimReviewAccess(payload) {
  return wx.cloud.callFunction({ name: 'claim_review_access', data: payload }).then(result => result.result)
}

function suggestHistoricalAliases({ nickname }) {
  return wx.cloud.callFunction({ name: 'suggest_historical_aliases', data: { nickname } }).then(result => result.result)
}

function saveProfileAvatar({ avatarFileId }) {
  return wx.cloud.callFunction({ name: 'save_profile_avatar', data: { avatarFileId } }).then(result => result.result)
}

function getHistoricalDashboard() {
  return wx.cloud.callFunction({ name: 'get_historical_dashboard' }).then(result => result.result)
}

function getLifetimeStats() {
  return wx.cloud.callFunction({ name: 'get_historical_dashboard', data: { mode: 'lifetime' } }).then(result => result.result)
}

function getMemberHistoricalProfile(memberId) {
  return wx.cloud.callFunction({ name: 'get_historical_dashboard', data: { mode: 'profile', memberId } }).then(result => result.result)
}

function getActivitySubmission(targetMemberId = '') {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'get', targetMemberId } }).then(result => result.result)
}

async function recognizeActivityScreenshots(evidenceFileIds, targetMemberId = '') {
  const started = await wx.cloud.callFunction({ name: 'ocr_activity_screenshot', data: { action: 'start', evidenceFileIds, targetMemberId } })
  const batchId = started.result && started.result.batchId
  if (!batchId) throw new Error('未能创建截图识别任务')
  for (let index = 0; index < evidenceFileIds.length; index += 1) {
    try {
      await wx.cloud.callFunction({
        name: 'ocr_activity_screenshot',
        data: { action: 'recognize_one', targetMemberId, batchId, imageIndex: index + 1, evidenceFileId: evidenceFileIds[index] }
      })
    } catch (error) {
      console.warn(`第 ${index + 1} 张截图 OCR 调用失败`, error)
    }
  }
  const completed = await wx.cloud.callFunction({ name: 'ocr_activity_screenshot', data: { action: 'complete', batchId, targetMemberId } })
  if (!completed.result || !completed.result.ocrCompleted) return getActivitySubmission(targetMemberId)
  return judgeActivityScreenshot(targetMemberId)
}

function judgeActivityScreenshot(targetMemberId = '') {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'judge', targetMemberId } }).then(result => result.result)
}

function confirmActivitySubmission({ reviewedActivities, confirmedEquivalentKm, targetMemberId = '' }) {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'confirm', reviewedActivities, confirmedEquivalentKm, targetMemberId } }).then(result => result.result)
}

function cancelActivityRecognition(targetMemberId = '') {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'cancel', targetMemberId } }).then(result => result.result)
}

function withdrawPendingActivitySubmission(targetMemberId = '') {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'withdraw', targetMemberId } }).then(result => result.result)
}

function getPendingActivityReviews() {
  return wx.cloud.callFunction({ name: 'review_activity_submissions', data: { action: 'list' } }).then(result => result.result)
}

function approveActivityReview({ submissionId, reviewedActivities }) {
  return wx.cloud.callFunction({ name: 'review_activity_submissions', data: { action: 'approve', submissionId, reviewedActivities } }).then(result => result.result)
}

function voidActivityReview({ submissionId, voidReason }) {
  return wx.cloud.callFunction({ name: 'review_activity_submissions', data: { action: 'void', submissionId, voidReason } }).then(result => result.result)
}

function resolveMissingSubmission({ memberId, resolution }) {
  return wx.cloud.callFunction({ name: 'review_activity_submissions', data: { action: 'resolve_missing', memberId, resolution } }).then(result => result.result)
}

function confirmPendingFundPayment({ memberId }) {
  return wx.cloud.callFunction({ name: 'review_activity_submissions', data: { action: 'confirm_fund_payment', memberId } }).then(result => result.result)
}

function generateMonthlyEvaluation(targetMemberId = '') {
  return wx.cloud.callFunction({ name: 'generate_monthly_evaluation', data: { targetMemberId } }).then(result => result.result)
}

function getFundLedger() {
  return wx.cloud.callFunction({ name: 'manage_fund_ledger', data: { action: 'list' } }).then(result => result.result)
}

function withdrawFund({ amount, purpose }) {
  return wx.cloud.callFunction({ name: 'manage_fund_ledger', data: { action: 'withdraw', amount, purpose } }).then(result => result.result)
}

module.exports = { getCurrentUser, claimHistoricalIdentity, claimReviewAccess, suggestHistoricalAliases, saveProfileAvatar, getHistoricalDashboard, getLifetimeStats, getMemberHistoricalProfile, getActivitySubmission, recognizeActivityScreenshots, judgeActivityScreenshot, confirmActivitySubmission, cancelActivityRecognition, withdrawPendingActivitySubmission, getPendingActivityReviews, approveActivityReview, voidActivityReview, resolveMissingSubmission, confirmPendingFundPayment, generateMonthlyEvaluation, getFundLedger, withdrawFund }
