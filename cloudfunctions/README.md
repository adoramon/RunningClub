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

部署完成后，确认 `activity_records` 集合保持客户端不可读写。函数首次成功调用时会按“用户 + 月份”写入当前提交记录；管理员审核与结算功能将在后续阶段接入。

## 当前已实现的函数

- `get_current_user`：读取或创建当前微信用户。

> `update_profile` 是早期演示函数，不符合“仅历史成员可注册”的准入规则。请不要部署它；后续会由 `claim_historical_identity` 替代。

- `import_legacy_history`：分批导入本地生成的历史艺名和月度台账。首次以 `{ "offset": 0 }` 调用，后续将返回的 `nextOffset` 作为下一次入参，直到 `completed` 为 `true`；导入数据文件不会进入 Git 仓库。
