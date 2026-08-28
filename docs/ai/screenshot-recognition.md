# 运动截图识别接入说明

## 目标

成员上传上一个完整月的运动软件截图后，由视觉大模型抽取可见运动量；云函数再按东成西就规则计算等效跑量。模型输出仅是识别建议，成员确认和管理员审核后才可用于结算。

## 云函数

函数名：`submit_activity_screenshot`。

它有三个操作：

- `get`：读取当前认领成员上一个完整月的提交状态；
- `recognize`：下载已上传的截图、调用模型、保存原始识别结果及服务端换算结果；
- `confirm`：成员确认或修正等效跑量，状态变为 `pending_admin_review`。

同一成员、同一月份只保留一个当前提交文档，文档 ID 为 `activity-用户ID-月份`。重新上传会增加修订号，并保留至多 8 个历史截图 File ID。客户端不直接写数据库。

## 模型环境变量

在 CloudBase 的 `submit_activity_screenshot` 云函数配置中设置以下环境变量，不要把密钥提交到 Git：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `RUNNING_CLUB_AI_API_KEY` | 是 | 模型服务 API Key |
| `RUNNING_CLUB_AI_API_BASE` | 否 | OpenAI 兼容 API 根地址；未设置时使用项目当前配置的服务地址 |
| `RUNNING_CLUB_AI_MODEL` | 否 | 模型名称；未设置时使用项目当前配置的模型名 |

接口需兼容 `POST /v1/chat/completions`，并支持 OpenAI 风格的多模态 `image_url`（Data URL）输入与 JSON 输出。模型密钥仅在云函数运行时通过 `process.env` 读取。

## 模型输出约定

云函数要求模型仅返回 JSON：

```json
{
  "sourceApp": "运动软件名称或空字符串",
  "screenshotMonth": "YYYY-MM 或 null",
  "activities": [
    {
      "activityType": "running|cycling|swimming|jump_rope|elevation|custom",
      "rawValue": 128.6,
      "rawUnit": "km|m|count",
      "evidence": "截图中的对应文字"
    }
  ],
  "confidence": 0.96,
  "needsReview": false,
  "notes": []
}
```

模型必须只提取截图中清晰可见的数据，不得推测缺失数值。无法归类的运动使用 `custom`，系统不自动换算，必须由管理员审核。

## 固定换算规则

- 跑步：原始公里数；
- 骑行：公里数 ÷ 3；
- 游泳：公里数 × 5；
- 跳绳：次数 ÷ 100；
- 累计爬升：米数 × 0.02；
- 其他运动：不自动换算。

所有换算在服务端执行。公积金、连续未达标次数和正式月度结算不在截图识别函数中计算，必须等待管理员审核完成后由后续结算函数处理。
