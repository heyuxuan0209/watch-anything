---
name: watch-anything
description: 看懂视频与富媒体：X 推文（含推文视频）/ YouTube / B站 / 无字幕视频链接 → 字幕优先或本地/云端语音转写 → 中文卡片解读（卡片：摘要 3 句 + 要点 3-6 条 + 金句中英对照；全稿：讲述脉络按原片结构走完 + 关键案例 + 结构图）→ 基于材料的多轮问答。触发：用户丢 X/YouTube/B站/视频链接并说"解读/看懂/讲了啥/转写一下/值得看吗/这视频说了什么"，或明确说"watch-anything"。read-anything 的姊妹：read 管读文字，watch 管看视频/富媒体。
---

# 看懂视频（watch-anything）

按本目录 `PLAYBOOK.md` 执行，它是唯一的行为规范（路由表、转写降级链、卡片格式、
诚实守则、降级话术都在里面）。本文件只是 Claude Code 的触发入口。

要点提醒：

1. 先读 `PLAYBOOK.md`，按链接类型走路由：X 推文先 `scripts/fetch-x.mjs` 拿正文+媒体清单，
   带视频再 `scripts/transcribe-video.mjs` 转写；YouTube/B站 直接 `transcribe-video.mjs`
   （字幕优先，无字幕才转写）。脚本零 npm 依赖、Node 18+、JSON 进出。
2. 转写降级链：视频字幕 > Groq 云 whisper（需 `GROQ_API_KEY`）> 本地 faster-whisper。
   缺哪级降哪级，长视频转写前告知用户「需等几分钟」。
3. 解读模板在 `templates/`，默认 `card.md`（卡片格式）；用户一句话可覆盖，
   自定义模板 = 目录里的新 .md 文件。
   输出终点在 `integrations/`（可选）：环境里有 `FEISHU_WEBHOOK` / `FEISHU_APP_ID` 时，
   卡片出完可问一句要不要推飞书，跑 `scripts/push-feishu.mjs`；没配就当它不存在，别催用户配。
4. 诚实守则优先级最高：抓不到的推文、转不出的音频、未解析的画面，如实降级并显式声明，
   绝不脑补视频/图片里的内容。
