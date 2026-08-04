# 云函数部署说明

当前开发环境：`cloud1-d3gu11p800a6f5c2a`。

## 首次部署顺序

1. 在微信开发者工具的「云开发 > 数据库」创建集合：`users`、`clubs`、`club_members`、`monthly_goals`、`activity_records`、`monthly_settlements`、`fund_ledger`。
2. 将这些集合的客户端读写权限保持为关闭或仅管理员可访问；业务写入通过云函数完成。
3. 右键 `cloudfunctions/get_current_user`，选择「上传并部署：云端安装依赖」。
4. 在云函数控制台使用测试面板运行 `get_current_user`。首次调用会在 `users` 中创建当前微信开发者对应的用户记录。

后续云函数会继续以同样的方式部署。

## 当前已实现的函数

- `get_current_user`：读取或创建当前微信用户。

> `update_profile` 是早期演示函数，不符合“仅历史成员可注册”的准入规则。请不要部署它；后续会由 `claim_historical_identity` 替代。

- `import_legacy_history`：分批导入本地生成的历史艺名和月度台账。首次以 `{ "offset": 0 }` 调用，后续将返回的 `nextOffset` 作为下一次入参，直到 `completed` 为 `true`；导入数据文件不会进入 Git 仓库。
