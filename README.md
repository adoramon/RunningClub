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

### v1.0.0（当前体验版）

首个可供成员体验的版本已定版，发布说明见 [v1.0.0 发布说明](docs/releases/v1.0.0.md)。本版本开放封闭身份认领、历史真实看板和个人历史分析；截图审核、正式月度结算与公积金流水仍未开放，不能作为正式月度申报使用。

`1.0.0` 已上传为微信小程序体验版。管理员需在微信公众平台将跑团成员添加为体验成员后，成员才可进入体验版登录；该上传不代表已通过微信审核或已正式公开发布。

- 已完成：公积金计算规则、历史 Excel 转换、历史艺名库、封闭身份认领和头像上传；已完成一次完整认领链路验证。
- 已完成：历史真实看板。首页展示上一个完整月的团队承诺与实际跑量汇总、有效成员明细；分析页展示当前认领成员的真实历史记录。本月承诺自动继承该成员历史台账中当前月或最近一次有效承诺。历史“收/交 X 元”公积金记录会按连续未达标规则倒算跑量并计入统计，原始记录保持不变。
- 已完成：看板展示优化。上月团队汇总、公积金当前余额与上月新增、上月提交引导、上月达成目标排名均已接入；排名按达成率排序并用分级圆环展示。已认领成员显示微信昵称与头像，未认领成员保留历史艺名并标记“未注册”。
- 已完成：成员个人分析入口。点击上月跑量排名中的任意成员行（姓名、里程或完成率圆环）可进入独立的个人分析页，查看该成员的继承承诺、历史月均、历史最高跑量、累计跑量、累计公积金贡献及历史台账；指标以“数值 + 单位”呈现，累计跑量和累计公积金贡献分别使用深绿、深橙强调卡片。页面还提供最近两年的原生跑量趋势图，缺失月份按 0 km 连续展示，页面仅向已完成历史艺名认领的跑团成员开放。
- 已完成：个人历史明细优化。个人分析页将历史跑量数据按年分区为年历宫格：每年 12 个月、每行 4 个月；每格用大号月份作背景，跑量下移避开月份水印，并随状态使用同色系文字。底部以“2×2”状态文字块与完成率圆环并排展示；状态背景和圆环分别用绿色“达成目标”、黄色“已缴基金”、橙色“提前请假”区分；同时排除本月与加入跑团前连续空白记录。
- 已完成：跑团战报卡。首页将马拉松主视觉、上月结算和累计统计融合为一张连续卡片，主视觉通过深绿渐变自然过渡到结算区；结算区突出放大的浅绿色达成圆环，标题与人数摘要同行，并在同一对比区等宽、等字号展示上月全员实际跑量和全员总承诺跑量，左侧右对齐、右侧左对齐，并以相同内边距保证两组数字内侧到中央半透明竖线的留白一致；浅色下半部保留既有布局但降低文字强调度，同一行展示累计有效跑量和跑团运营时长，并以“相当于 + 项目 + 数值”的单行形式展示绕赤道、城市往返等动态对比。累计统计后台加载并缓存，避免影响首页打开速度。
- 已完成：移除底部“看板 / 提交 / 分析”固定菜单，改由首页和各功能页内的明确引导进入相应功能，减少非当前阶段功能入口对主流程的干扰。
- 已完成：真实截图智能识别提交。成员可一次上传 1 至 3 张上月截图，由 `local-vsr` 视觉模型逐图识别、合并不同运动记录，再由服务端按跑步、骑行、游泳、跳绳和爬升规则换算；距离会保留截图中的 `km` 或 `m` 原始单位，服务端统一换算后再计算等效跑量。成员核对页会显示截图缩略图、每项识别依据和原始数值；可逐项修改数值或选择不计入，确认时由云函数重新计算总量后进入管理员审核。限制为 3 张是为了适配 CloudBase 云函数 60 秒硬超时。正式管理员审核、月度结算和公积金流水仍在后续阶段实现。
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
