function getCurrentUser() {
  return wx.cloud.callFunction({ name: 'get_current_user' }).then(result => result.result)
}

function updateProfile({ nickname }) {
  return wx.cloud.callFunction({ name: 'update_profile', data: { nickname } }).then(result => result.result)
}

module.exports = { getCurrentUser, updateProfile }
