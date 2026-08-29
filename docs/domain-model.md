# 东成西就：领域与数据设计（第一版）

## 已确认的业务规则

- 成员按月承诺跑量；入团后首个未完成承诺的月份计为连续未达标第 1 月。
- 当月等效跑量低于承诺跑量时，缺口按连续未达标次数缴纳公积金：`缺口 × 3 元 × 连续未达标次数`。
- 任意一个月完成承诺后，连续未达标次数清零；下次未完成重新从 `3 元/公里` 计算。
- 自行车公里数除以 3、游泳公里数乘以 5、跳绳个数除以 100、爬升米数乘以 0.02，均换算为跑步等效公里数。
- 截至 2026-07 结算后，跑团公积金余额为 `-257.00` 元，作为新系统的历史结转余额。

## 核心集合（CloudBase 文档数据库）

### users

`_id`、`openid`、`nickname`、`avatarFileId`、`historicalMemberId`、`createdAt`、`updatedAt`

未认领历史身份的用户不视为跑团成员，不能读取跑量、榜单或公积金数据。

### historical_members

`_id`、`alias`、`normalizedAlias`、`sourceRow`、`claimStatus`、`claimedUserId`、`claimedAt`、`importBatchId`

每个历史艺名一条记录。`normalizedAlias` 为去除首尾空格后的艺名，建立唯一索引。`claimStatus` 初始为 `unclaimed`；认领成功后变为 `claimed`，且不可被第二个微信用户覆盖。

### historical_monthly_records

`_id`、`historicalMemberId`、`month`、`targetRaw`、`actualRaw`、`targetKm`、`equivalentKm`、`fundAmount`、`recordState`、`source`、`importBatchId`

每位历史成员、每个历史月份均保留一条记录，即使单元格为空。`source` 保存工作表名称、行号、承诺跑量单元格与实际跑量单元格坐标。原始值永不覆盖。

建立唯一索引：`historicalMemberId + month`。

### history_import_batches

`_id`、`sourceFileName`、`sourceSheet`、`periodCount`、`memberCount`、`recordCount`、`createdAt`、`createdBy`、`checksum`

用于审计每次历史导入，避免重复导入。

### clubs

`_id`、`name`、`ownerUserId`、`inviteCode`、`timezone`（固定 `Asia/Shanghai`）、`fundOpeningBalance`、`fundOpeningMonth`

### club_members

`clubId`、`userId`、`role`（`member` / `admin`）、`status`（`active` / `inactive`）、`joinedMonth`、`leftMonth`

建立唯一索引：`clubId + userId`。

### monthly_goals

`clubId`、`userId`、`month`（`YYYY-MM`）、`targetKm`、`status`（`draft` / `locked`）、`createdAt`

建立唯一索引：`clubId + userId + month`。

### activity_records

`_id`、`clubId`、`userId`、`historicalMemberId`、`month`、`activityType`、`rawValue`、`rawUnit`、`equivalentKm`、`evidenceFileIds`、`evidenceFileId`、`previousEvidenceFileIds`、`recognitionStatus`、`recognition`、`memberConfirmedEquivalentKm`、`memberReviewedActivities`、`memberEvaluation`、`adminReviewedActivities`、`adminApprovedEquivalentKm`、`adminReviewedByUserId`、`adminReviewedByAlias`、`adminReviewedAt`、`adminVoidedByUserId`、`adminVoidedByAlias`、`adminVoidedAt`、`adminVoidReason`、`revision`、`submittedAt`、`reviewStatus`

`activityType` 为 `running`、`cycling`、`swimming`、`jump_rope`、`elevation` 或 `custom`。`custom` 必须由管理员审核并记录换算系数。

截图提交以“成员 + 月份”保存一个当前提交文档；一次可提交 1 至 3 张截图，当前批次保存于 `evidenceFileIds`，重传前一批转入 `previousEvidenceFileIds` 审计保留。模型识别到的多项运动保存到 `recognition.activities`；该字段保存原始值、单位、截图序号、截图佐证文字和云端计算的等效公里数。成员逐项核对后的“是否计入、原始数值、服务端重新计算的等效公里数”保存到 `memberReviewedActivities`。`memberEvaluation` 保存阶段性评价正文、标题、模型名和基于的提交版本；它只使用结构化跑量摘要，不发送截图。状态按 `analyzing`、`recognized`、`failed`、`cancelled`、`pending_member_confirmation`、`pending_admin_review` 流转。成员可在确认前取消识别，文件和模型结果保留审计但不会进入结算。

### monthly_settlements

`clubId`、`userId`、`historicalMemberId`、`month`、`targetKm`、`equivalentKm`、`shortfallKm`、`isCompleted`、`failureStreak`、`fundRatePerKm`、`fundDue`、`status`、`reviewedByUserId`、`reviewedByAlias`、`reviewedAt`

建立唯一索引：`clubId + userId + month`。该集合由云函数写入，不允许客户端直接改写计算字段。

### fund_ledger

`clubId`、`month`、`entryType`、`amount`、`userId`、`settlementId`、`status`、`occurredAt`、`confirmedBy`、`note`

金额采用有符号数：缴纳/补缴为正，支出/返还为负。`entryType` 包括 `opening_balance`、`member_payment`、`expense`、`refund`、`adjustment`。管理员确认上月未提交成员已缴公积金时，系统会写入一条状态为 `confirmed` 的 `member_payment` 流水；该流水立即进入公积金余额。

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

1. 先导入完整艺名清单，再导入每个艺名、每个月份的双单元格原始数据；空单元格也保留记录。
2. 数字导入为历史等效公里数；`交/收 XX 元` 解析为 `fundAmount`，同时保留原始文本与来源单元格。
3. 不足以可靠还原跑量、缺口或连续未达标次数的记录标为 `legacy_unverified`，由管理员核对；不伪造计算结果。
4. 以 2026-07 的 `-257.00` 建立历史结转流水；2026-08 起由系统流水自动累计。

## 封闭成员准入

1. 用户打开小程序时只创建最小化微信身份记录，不能进入跑团业务页面。
2. 用户填写艺名后，云函数在 `historical_members.normalizedAlias` 中精确匹配。
3. 仅当该艺名存在且 `claimStatus` 为 `unclaimed` 时，云函数才会在同一事务内绑定 `users.historicalMemberId` 和 `historical_members.claimedUserId`。
4. 认领后允许用户选择微信头像并上传到云存储；展示时使用 `avatarFileId`。
5. 所有跑团数据集合保持“所有用户不可读写”，客户端只调用云函数。未认领、艺名不存在或已被认领时均不返回历史数据。
