# 云函数部署说明

当前开发环境：`cloud1-d3gu11p800a6f5c2a`。

## 首次部署顺序

1. 在微信开发者工具的「云开发 > 数据库」创建集合：`users`、`clubs`、`club_members`、`monthly_goals`、`activity_records`、`monthly_settlements`、`fund_ledger`。
2. 将这些集合的客户端读写权限保持为关闭或仅管理员可访问；业务写入通过云函数完成。
3. 右键 `cloudfunctions/get_current_user`，选择「上传并部署：云端安装依赖」。
4. 在云函数控制台使用测试面板运行 `get_current_user`。首次调用会在 `users` 中创建当前微信开发者对应的用户记录。

后续云函数会继续以同样的方式部署。

## 截图保留与清理

- `submit_activity_screenshot` 在成员取消识别或撤回待审核提交时，立即删除该记录关联的云端截图。
- `review_activity_submissions` 在管理员作废提交时，立即删除该记录关联的云端截图。
- `cleanup_activity_evidence` 每天北京时间 03:30 清理超过最近三个提交月份的截图，只清空文件引用，不删除结构化跑量、识别、审核和结算数据。

部署 `cleanup_activity_evidence` 后需将函数超时设为 60 秒。新版微信开发者工具和云开发控制台可能只读展示触发器，此时使用项目根目录 `cloudbaserc.json` 与官方命令 `tcb fn trigger create cleanup_activity_evidence -e cloud1-d3gu11p800a6f5c2a --yes` 创建。触发器只需配置一次；后续普通代码更新不会改变保留周期。

## 截图识别函数

截图识别由两个函数串联：`ocr_activity_screenshot` 调用 `local-vsr` 抄录原文，多图时每张截图分别调用一次并保存分片；全部分片完成后，客户端再调用 `submit_activity_screenshot`，由后者调用 `local-premium` 统一判断运动总量并在服务端换算。每张 OCR 调用和最终判断都拥有独立的 60 秒云函数窗口。部署新 OCR 函数后，必须在其 CloudBase 配置中设置与现有识别函数相同的 `RUNNING_CLUB_AI_API_KEY`；密钥不能写入源码或小程序端。模型协议、换算规则和完整环境变量说明见 [../docs/ai/screenshot-recognition.md](../docs/ai/screenshot-recognition.md)。

部署完成后，确认 `activity_records` 集合保持客户端不可读写。函数首次成功调用时会按“用户 + 月份”写入当前提交记录；成员确认后由 `review_activity_submissions` 完成管理员审核，并由月度结算及公积金确认流程写入 `monthly_settlements` 与 `fund_ledger`。

## 当前已实现的函数

- `get_current_user`：读取或创建当前微信用户，并返回认领、管理员或审核体验状态。
- `suggest_historical_aliases`：根据微信昵称提供历史艺名匹配建议，不直接占用身份。
- `claim_historical_identity`：以事务方式完成历史艺名唯一认领。
- `save_profile_avatar`：保存用户主动选择并上传的微信头像文件 ID。
- `get_historical_dashboard`：返回真实历史看板、累计跑量、个人分析及最终审核数据覆盖结果。
- `ocr_activity_screenshot`：逐张调用视觉模型抄录截图原文并保存 OCR 分片。
- `submit_activity_screenshot`：判断 OCR 原文、服务端换算、成员确认、取消及撤回。
- `review_activity_submissions`：管理员审核、修正、通过或作废，并处理上月未提交及未达标成员。
- `generate_monthly_evaluation`：一次性生成并持久化成员月度运动评价。
- `manage_fund_ledger`：读取公积金公示账本，并为管理员执行带用途的支取。
- `cleanup_activity_evidence`：按最近三个提交月份清理过期截图。
- `claim_review_access`：提供与真实跑团数据隔离的微信审核体验入口。
- `import_legacy_history`：分批导入历史艺名和月度台账；导入数据文件不进入 Git 仓库。

> `update_profile` 是早期演示函数，不符合“仅历史成员可注册”的准入规则。请不要部署它；正式认领已由 `claim_historical_identity` 实现。

历史导入首次以 `{ "offset": 0 }` 调用，后续将返回的 `nextOffset` 作为下一次入参，直到 `completed` 为 `true`。
