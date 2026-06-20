# ⚠️ SECURITY WARNING / 安全声明

> **本仓库中的 `vosk-realtime-asr/server/.env` 包含明文 API 凭据，提交者明知风险仍选择公开。**
> **请勿 fork / 使用本仓库中的任何凭据。**

## 🚨 暴露的密钥

文件 `vosk-realtime-asr/server/.env` 包含以下凭据：

| 变量 | 用途 | 状态 |
| --- | --- | --- |
| `VOLC_APP_KEY` | 火山引擎（字节跳动）语音识别 API Key | **应立即在控制台轮换** |
| `VOLC_ACCESS_TOKEN` | 火山引擎 Access Token | **应立即在控制台轮换** |

## 🔥 立即行动清单（提交者必做）

1. **登入 [火山引擎控制台](https://console.volcengine.com/)** → 找到对应应用
2. **轮换 / 禁用** `VOLC_APP_KEY` 和 `VOLC_ACCESS_TOKEN`
3. 检查调用日志，**确认无异常调用 / 异常账单**
4. 启用 **GitHub Secret Scanning**（Settings → Code security and analysis）
5. 删除此 commit / 仓库前请三思 —— GitHub 仍会保留历史

## 📜 背景说明

此为个人**作品集仓库**，提交者明确知悉以下风险仍选择公开：

- Public 仓库 = 任何人、任何搜索引擎可索引
- GitHub secret scanning 会在 push 后数分钟内捕获并告警
- 任何 fork / 镜像 / 备份都可能导致密钥二次扩散
- 使用此密钥的 API 调用费用 / 滥用责任均在凭证所有者账户

## 🛡️ 访问者请注意

- ❌ **不要**在生产环境使用此仓库中的任何凭据
- ❌ **不要**直接 `cp .env.example .env` 后启动服务
- ✅ 如果要复现，请自行在火山控制台申请新 Key 填入

## 📞 报告问题

如发现其他安全问题，请联系：见 commit author email
