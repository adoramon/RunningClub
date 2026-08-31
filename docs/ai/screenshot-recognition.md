# 运动截图识别接入说明

## 目标

成员可一次上传上一个完整月的 1 至 3 张运动软件截图。识别采用两阶段模型：`local-vsr` 只逐图抄录可见文字，`local-premium` 只根据 OCR 原文判断月度运动总量；云函数验证判断引用的原文与数字后，再按东成西就规则计算等效跑量。模型输出仅是识别建议，成员确认和管理员审核后才可用于结算。

## 云函数

两个模型分别运行在独立云函数中：

- `ocr_activity_screenshot`：下载截图并调用 `local-vsr`，将 OCR 原文保存到当前活动记录；
- `submit_activity_screenshot`：读取已保存的 OCR 原文，调用 `local-premium` 判断数据，并负责成员确认、取消和撤回。

它支持以下操作：

- `get`：读取当前认领成员上一个完整月的提交状态；
- `recognize`：下载已上传的截图、调用模型、保存原始识别结果及服务端换算结果；
- `confirm`：成员确认或修正等效跑量，状态变为 `pending_admin_review`。
- `cancel`：成员取消尚未确认的识别结果，状态变为 `cancelled`，不删除截图文件或审计记录，可重新提交。
- `withdraw`：成员作废仍处于 `pending_admin_review` 的提交，状态变为 `withdrawn`，保留原始截图并重新开放提交通道；已经被管理员处理的记录不可撤回。

同一成员、同一月份只保留一个当前提交文档，文档 ID 为 `activity-用户ID-月份`。当前一批截图保存在 `evidenceFileIds`（最多 3 张），重新上传会增加修订号；上一批的文件 ID 会转入 `previousEvidenceFileIds` 审计保留（最多 12 张）。客户端不直接写数据库。

## 模型环境变量

在 CloudBase 云函数配置中设置以下环境变量，不要把密钥提交到 Git。`RUNNING_CLUB_AI_API_KEY` 和 API 地址需要同时配置给两个函数；模型变量按各自职责配置：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `RUNNING_CLUB_AI_API_KEY` | 是 | 模型服务 API Key |
| `RUNNING_CLUB_AI_API_BASE` | 否 | OpenAI 兼容 API 根地址；未设置时使用项目当前配置的服务地址 |
| `RUNNING_CLUB_AI_MODEL` | 否 | 兼容旧配置的 OCR 模型名；未设置时使用 `local-vsr` |
| `RUNNING_CLUB_AI_OCR_MODEL` | 否 | OCR 模型名，优先级高于旧变量；默认 `local-vsr` |
| `RUNNING_CLUB_AI_JUDGEMENT_MODEL` | 否 | 数据判断模型名；默认 `local-premium` |

接口需兼容 `POST /v1/chat/completions`，并支持 OpenAI 风格的多模态 `image_url`（Data URL）输入与 JSON 输出。模型密钥仅在云函数运行时通过 `process.env` 读取。

CloudBase 每个云函数的超时硬上限为 60 秒。客户端先等待 OCR 函数完成，再发起数据判断函数，因此两个阶段各自拥有独立的 60 秒运行窗口；两个模型的内部请求均在 48 秒主动中断，为数据库回写保留余量。如果第一阶段完成后用户关闭页面，再次进入上传页会根据 `ocr_completed` 状态自动继续第二阶段，不需要重新上传截图。单批限制为最多 3 张，单张图片最大 4 MB，单次所有图片总大小最大 12 MB。

## 模型输出约定

第一阶段 `local-vsr` 只返回逐图 OCR 原文：

```json
{
  "images": [
    { "imageIndex": 1, "lines": ["累计游泳距离", "48,806 米"], "confidence": 0.96 }
  ],
  "notes": []
}
```

第二阶段 `local-premium` 只能引用上述 OCR 行号进行判断，并返回：

```json
{
  "sourceApp": "运动软件名称或空字符串",
  "screenshotMonth": "YYYY-MM 或 null",
  "activities": [
    {
      "imageIndex": 1,
      "sourceLineIndexes": [1, 2],
      "activityType": "running|cycling|swimming|jump_rope|elevation|custom",
      "rawValue": 128.6,
      "rawUnit": "km|m|count",
    }
  ],
  "confidence": 0.96,
  "needsReview": false,
  "notes": []
}
```

`local-vsr` 禁止判断、筛选、计算或合并数据，只允许原样抄录。`local-premium` 必须只提取 OCR 中明确标注为累计或当月总量的数据，不得推测缺失数值。每项必须带图片序号和 `sourceLineIndexes`。服务端会重新取出这些 OCR 行，确认 `rawValue` 确实逐字存在；无法验证的项目自动丢弃。同一张图内若同时有累计总量与下方分段、单次或按天记录，累计总量有绝对优先级。服务端再将 `m` 转为 `km`，并按运动类型换算等效跑量。若多张图片可能展示同一份月度总量，判断模型不得自行相加，并须要求成员复核。

服务端还会执行单位白名单校验：跑步、骑行、游泳只能为 `km` 或 `m`；跳绳只能为 `count`；累计爬升只能为 `m`。卡路里/大卡/kcal、步数、时长、心率等任何非距离或非跳绳次数都会被丢弃，即使模型错误地将其标成跑步也不能计入等效跑量。

## 固定换算规则

- 跑步：原始公里数；
- 骑行：公里数 ÷ 3；
- 游泳：公里数 × 5；
- 跳绳：次数 ÷ 100；
- 累计爬升：米数 × 0.02；
- 其他运动：不自动换算。

所有换算在服务端执行。公积金、连续未达标次数和正式月度结算不在截图识别函数中计算，必须等待管理员审核完成后由后续结算函数处理。

## 成员核对

识别完成后，成员必须逐项核对截图缩略图、来源图片序号、识别依据、原始数值与单位。成员可修改原始数值，或将某一项标为“不计入”。确认提交时，客户端仅提交每项的“是否计入”和原始数值；云函数根据原始运动类型与单位重新计算等效跑量，不能信任前端传来的总公里数。成员修订明细保存到 `memberReviewedActivities`，再进入 `pending_admin_review`。
