function getCurrentUser() {
  return wx.cloud.callFunction({ name: 'get_current_user' }).then(result => result.result)
}

function claimHistoricalIdentity(payload) {
  return wx.cloud.callFunction({ name: 'claim_historical_identity', data: payload }).then(result => result.result)
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

function getActivitySubmission() {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'get' } }).then(result => result.result)
}

function recognizeActivityScreenshots(evidenceFileIds) {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'recognize', evidenceFileIds } }).then(result => result.result)
}

function confirmActivitySubmission({ reviewedActivities, confirmedEquivalentKm }) {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'confirm', reviewedActivities, confirmedEquivalentKm } }).then(result => result.result)
}

function cancelActivityRecognition() {
  return wx.cloud.callFunction({ name: 'submit_activity_screenshot', data: { action: 'cancel' } }).then(result => result.result)
}

module.exports = { getCurrentUser, claimHistoricalIdentity, suggestHistoricalAliases, saveProfileAvatar, getHistoricalDashboard, getLifetimeStats, getMemberHistoricalProfile, getActivitySubmission, recognizeActivityScreenshots, confirmActivitySubmission, cancelActivityRecognition }
