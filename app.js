const { CLOUDBASE_ENV_ID } = require('./config/cloud')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请在微信开发者工具升级基础库。')
      return
    }
    wx.cloud.init({ env: CLOUDBASE_ENV_ID, traceUser: true })
  },
  globalData: { clubName: '东成西就跑团', cloudEnvId: CLOUDBASE_ENV_ID }
})
