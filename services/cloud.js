function getCurrentUser() {
  return wx.cloud.callFunction({ name: 'get_current_user' }).then(result => result.result)
}

function claimHistoricalIdentity({ alias }) {
  return wx.cloud.callFunction({ name: 'claim_historical_identity', data: { alias } }).then(result => result.result)
}

function saveProfileAvatar({ avatarFileId }) {
  return wx.cloud.callFunction({ name: 'save_profile_avatar', data: { avatarFileId } }).then(result => result.result)
}

module.exports = { getCurrentUser, claimHistoricalIdentity, saveProfileAvatar }
