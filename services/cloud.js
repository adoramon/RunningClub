function getCurrentUser() {
  return wx.cloud.callFunction({ name: 'get_current_user' }).then(result => result.result)
}

module.exports = { getCurrentUser }
