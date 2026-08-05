# 东成西就微信小程序

一个面向封闭跑团成员的原生微信小程序。

- 历史艺名与微信账号的唯一认领；
- 微信昵称、头像和历史跑量数据的长期绑定（昵称使用微信 `input type="nickname"` 官方输入能力，头像使用 `chooseAvatar`）；
- 月度承诺、运动凭证、公积金与数据分析（持续开发中）。

跑团规则与 CloudBase 数据模型见 [docs/domain-model.md](docs/domain-model.md)。其中已固化公积金的递增计算、运动换算规则，以及截至 2026 年 7 月 `-257.00` 元的历史结转余额。

项目的持续背景、云端现状、已知限制与下一步请先阅读 [docs/project-context.md](docs/project-context.md)。

## 品牌资源

- 团徽：[`assets/images/dongcheng-xijiu-logo.png`](assets/images/dongcheng-xijiu-logo.png)，用于认领页和看板品牌标识。
- 马拉松主视觉：[`assets/images/marathon-hero.jpg`](assets/images/marathon-hero.jpg)，用于看板首页首屏；已压缩为适合小程序加载的版本。

## 本地预览

在微信开发者工具中导入此目录，AppID 可替换为自己的测试或正式 AppID。

## 云开发

当前开发环境为 `cloud1-d3gu11p800a6f5c2a`。首次部署的集合与云函数步骤见 [cloudfunctions/README.md](cloudfunctions/README.md)。

## 当前开发阶段

- 已完成：公积金计算规则、历史 Excel 转换、历史艺名库、封闭身份认领和头像上传；已完成一次完整认领链路验证。
- 已完成：历史真实看板。首页展示上一个完整月的团队承诺与实际跑量汇总、有效成员明细；分析页展示当前认领成员的真实历史记录。本月承诺自动继承该成员历史台账中当前月或最近一次有效承诺。
- 已完成云端操作：核心集合与历史集合创建；历史数据应通过控制台 JSON 导入，详见 [docs/historical-migration.md](docs/historical-migration.md)。
- 已完成云端操作：`get_current_user`、`suggest_historical_aliases`、`claim_historical_identity`、`save_profile_avatar`、`get_historical_dashboard` 已部署到 `cloud1-d3gu11p800a6f5c2a`。
- 下一开发阶段：初始化东成西就跑团及历史结转余额，然后将自动继承的承诺写入正式月度目标，最后实现截图审核与公积金结算。

> 不要部署 `update_profile`。它是旧的自由昵称演示函数，不符合封闭成员准入规则。

### 后续批量部署

不要使用单函数的 Skill 包装命令；它会为每个函数请求一次确认。使用微信开发者工具原生 CLI 的 `cloud functions deploy --paths`，可一次提交多个函数：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloud1-d3gu11p800a6f5c2a \
  --appid wx0007e6f1f408c23f \
  --remote-npm-install \
  --paths \
    /Users/gaoxiang/Documents/Codex/Projects/Running/cloudfunctions/get_current_user \
    /Users/gaoxiang/Documents/Codex/Projects/Running/cloudfunctions/suggest_historical_aliases \
    /Users/gaoxiang/Documents/Codex/Projects/Running/cloudfunctions/claim_historical_identity \
    /Users/gaoxiang/Documents/Codex/Projects/Running/cloudfunctions/save_profile_avatar
```

该命令来自微信官方 CLI 的云函数批量部署能力；以后在一个开发阶段完成后统一执行，并在部署前先说明本次发布范围。

## 生产接入建议

当前 `services/data.js` 使用 `wx.setStorageSync` 作为演示数据层。正式发布时请替换为云开发（CloudBase）或后端 API，并实现：微信登录的 `openid`、对象存储上传、服务端截图审核/里程识别，以及管理员的成员与月度记录审核。
