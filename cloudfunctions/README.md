# 云函数部署说明

当前开发环境：`cloud1-d3gu11p800a6f5c2a`。

## 首次部署顺序

1. 在微信开发者工具的「云开发 > 数据库」创建集合：`users`、`clubs`、`club_members`、`monthly_goals`、`activity_records`、`monthly_settlements`、`fund_ledger`。
2. 将这些集合的客户端读写权限保持为关闭或仅管理员可访问；业务写入通过云函数完成。
3. 右键 `cloudfunctions/get_current_user`，选择「上传并部署：云端安装依赖」。
4. 在云函数控制台使用测试面板运行 `get_current_user`。首次调用会在 `users` 中创建当前微信开发者对应的用户记录。

后续云函数会继续以同样的方式部署。
