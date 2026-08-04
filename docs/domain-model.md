# 东成西就跑团：领域与数据设计（第一版）

## 已确认的业务规则

- 成员按月承诺跑量；入团后首个未完成承诺的月份计为连续未达标第 1 月。
- 当月等效跑量低于承诺跑量时，缺口按连续未达标次数缴纳公积金：`缺口 × 3 元 × 连续未达标次数`。
- 任意一个月完成承诺后，连续未达标次数清零；下次未完成重新从 `3 元/公里` 计算。
- 自行车公里数除以 3、游泳公里数乘以 5、跳绳个数除以 100、爬升米数乘以 0.02，均换算为跑步等效公里数。
- 截至 2026-07 结算后，跑团公积金余额为 `-257.00` 元，作为新系统的历史结转余额。

## 核心集合（CloudBase 文档数据库）

### users

`_id`、`openid`、`nickname`、`avatarFileId`、`createdAt`、`updatedAt`

### clubs

`_id`、`name`、`ownerUserId`、`inviteCode`、`timezone`（固定 `Asia/Shanghai`）、`fundOpeningBalance`、`fundOpeningMonth`

### club_members

`clubId`、`userId`、`role`（`member` / `admin`）、`status`（`active` / `inactive`）、`joinedMonth`、`leftMonth`

建立唯一索引：`clubId + userId`。

### monthly_goals

`clubId`、`userId`、`month`（`YYYY-MM`）、`targetKm`、`status`（`draft` / `locked`）、`createdAt`

建立唯一索引：`clubId + userId + month`。

### activity_records

`clubId`、`userId`、`month`、`activityType`、`rawValue`、`rawUnit`、`equivalentKm`、`evidenceFileIds`、`submittedAt`、`reviewStatus`

`activityType` 为 `running`、`cycling`、`swimming`、`jump_rope`、`elevation` 或 `custom`。`custom` 必须由管理员审核并记录换算系数。

### monthly_settlements

`clubId`、`userId`、`month`、`targetKm`、`equivalentKm`、`shortfallKm`、`isCompleted`、`failureStreak`、`fundRatePerKm`、`fundDue`、`status`、`reviewedBy`、`reviewedAt`

建立唯一索引：`clubId + userId + month`。该集合由云函数写入，不允许客户端直接改写计算字段。

### fund_ledger

`clubId`、`month`、`entryType`、`amount`、`userId`、`settlementId`、`status`、`occurredAt`、`confirmedBy`、`note`

金额采用有符号数：缴纳/补缴为正，支出/返还为负。`entryType` 包括 `opening_balance`、`member_payment`、`expense`、`refund`、`adjustment`。

创建一条初始化流水：`month: 2026-07`、`entryType: opening_balance`、`amount: -257.00`、`status: confirmed`。

## 云函数边界

- `getMyMemberships`：取得当前用户身份与跑团成员关系。
- `saveMonthlyGoal`：校验成员身份及可编辑窗口。
- `submitActivities`：上传凭证后登记原始运动数据。
- `settleMonth`：读取历史结算，计算连续未达标与应缴公积金。
- `reviewSettlement`：管理员审核并生成应缴公积金流水。
- `confirmFundPayment`：管理员确认到账，写入实际收款流水。
- `getClubDashboard`：返回已审核汇总、榜单与公积金余额。

## 历史数据迁移原则

原 Excel 的“实际跑量”单元格同时承载公里数与“交/收 XX 元”文本。迁移时：

1. 数字导入为历史等效公里数。
2. `交/收 XX 元` 导入为历史公积金缴纳线索，保留原始文本与来源单元格。
3. 不足以可靠还原跑量、缺口或连续未达标次数的记录标为 `legacy_unverified`，由管理员核对；不伪造计算结果。
4. 以 2026-07 的 `-257.00` 建立历史结转流水；2026-08 起由系统流水自动累计。
