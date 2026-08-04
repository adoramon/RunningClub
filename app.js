const { CLOUDBASE_ENV_ID } = require('./config/cloud')
const { getCurrentUser } = require('./services/cloud')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请在微信开发者工具升级基础库。')
      return
    }
    wx.cloud.init({ env: CLOUDBASE_ENV_ID, traceUser: true })
    this.globalData.sessionPromise = getCurrentUser()
      .then(session => {
        this.globalData.session = session
        return session
      })
      .catch(error => {
        console.error('初始化云端用户失败，请确认云函数已部署。', error)
        return null
      })
  },
  globalData: { clubName: '东成西就', cloudEnvId: CLOUDBASE_ENV_ID, session: null, sessionPromise: null }
})
