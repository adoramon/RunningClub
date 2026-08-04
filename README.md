# 逐风跑团微信小程序

一个原生微信小程序 MVP，包含：

- 跑团成员登记昵称与月度承诺跑量；
- 每月跑量截图与数字记录提交；
- 团队完成看板、排行榜、个人历史与基础统计。

跑团规则与 CloudBase 数据模型见 [docs/domain-model.md](docs/domain-model.md)。其中已固化公积金的递增计算、运动换算规则，以及截至 2026 年 7 月 `-257.00` 元的历史结转余额。

## 本地预览

在微信开发者工具中导入此目录，AppID 可替换为自己的测试或正式 AppID。

## 云开发

当前开发环境为 `cloud1-d3gu11p800a6f5c2a`。首次部署的集合与云函数步骤见 [cloudfunctions/README.md](cloudfunctions/README.md)。

## 生产接入建议

当前 `services/data.js` 使用 `wx.setStorageSync` 作为演示数据层。正式发布时请替换为云开发（CloudBase）或后端 API，并实现：微信登录的 `openid`、对象存储上传、服务端截图审核/里程识别，以及管理员的成员与月度记录审核。
