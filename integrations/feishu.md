# 输出终点 · 飞书

解读出来之后往哪儿放？默认是落成本地 markdown。这个可选模块让它顺手进飞书——
**卡片推到群里**（想让同事看见）或者**导入成云文档**（想存档和搜索）。

不配也完全不影响解读。这是加分项，不是前置条件。

两档，配了哪档走哪档：

| 档位 | 配置时间 | 你得到什么 | 需要的环境变量 | 状态 |
|---|---|---|---|---|
| ① 群机器人卡片 | 30 秒 | 一张卡片推进群/私聊，带原视频链接 | `FEISHU_WEBHOOK`（+ 开了签名校验才要 `FEISHU_WEBHOOK_SECRET`） | ✅ 2026-08-11 实测推送成功 |
| ② 云文档 | 5 分钟 | 完整解读导入成飞书文档，能搜能改能分享 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_OWNER_OPEN_ID` | ✅ 2026-08-12 实测建档成功，`auto` 模式（建档 + 卡片带链接）也已跑通 |

两档都配的话走 `auto`：先建文档，再把文档链接一起推进卡片。

## 三层交付物怎么分发（重要）

`card.md` 的产物是三层：**卡片**（摘要/要点/金句）、**精读**（讲述脉络等）、**全文中译**。

**飞书卡片装不下全部**——interactive card 整个 JSON 上限 30KB，而 45 分钟视频的全文中译
约 2 万字 ≈ 60KB（按实测转写密度 7.5 字/秒推算），超一倍。所以：

| 去处 | 装什么 |
|---|---|
| **云文档** | **整篇，三层齐全。这才是交付物** |
| 群机器人卡片 | 卡片层 + 讲述脉络目录（索引）+ 一个「打开完整解读」链接 |

脚本按 `—— 卡片 ——` / `—— 全稿 ——` / `—— 全文中译 ——` 三个分隔符自动拆，不用你手动传两份。

**只配了 webhook 没配云文档时**，卡片底部会明说「精读与全文中译未随卡片发送」并指向本文档——
不能让人以为解读就只有卡片上那点东西。**要在飞书里拿到全文，云文档档位是必须的。**

---

## ① 群机器人卡片（30 秒，推荐先配这个）

1. 飞书里建一个群（只有你自己也行，当收藏夹用）
2. 群设置 → **群机器人** → 添加机器人 → **自定义机器人**
3. 起个名（比如「视频解读」），复制给出的 **Webhook 地址**
4. 安全设置建议勾「签名校验」，把密钥也复制下来（不勾就跳过 `FEISHU_WEBHOOK_SECRET`）
5. 写进你的 shell 配置：

```bash
export FEISHU_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
export FEISHU_WEBHOOK_SECRET="你的签名密钥"   # 没开签名校验就不用配
```

验证：

```bash
node scripts/push-feishu.mjs --mode card --title "测试" --text "**【摘要】**\n能收到这条就通了。"
```

预期输出 `{"ok":true,"mode":"card","cardSent":true}`，同时群里出现一张卡片。

---

## ② 云文档（5 分钟）

需要一个飞书**自建应用**。个人版飞书也能建。

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → **创建企业自建应用**
2. 「凭证与基础信息」里拿 **App ID** 和 **App Secret**
3. 「权限管理」里开这几个权限，然后**创建版本并发布**（不发布权限不生效）：
   - `drive:drive` — 云空间读写（导入文档要）
   - `docx:document` — 文档读写
   - `contact:user.id:readonly` — 拿你自己的 open_id（可选，用于第 4 步）
4. 先把前两个写进 shell 配置：

```bash
export FEISHU_APP_ID="cli_xxxxxxxx"
export FEISHU_APP_SECRET="xxxxxxxx"
# 国际版 Lark 才需要改这个，飞书·中国不用配
# export FEISHU_BASE="https://open.larksuite.com"
```

5. 拿你自己的 **open_id**（文档要转给你，不转的话建出来只有应用能看见，你打不开）。
   `open_id` 是**应用维度**的——同一个人在不同应用里 open_id 不一样，所以必须用你这个应用去查：

```bash
node scripts/push-feishu.mjs --get-open-id --mobile 13800138000    # 换成你登录飞书的手机号
# 或 --email you@example.com
```

   输出里会直接给你要粘的那行。加进 shell 配置：

```bash
export FEISHU_OWNER_OPEN_ID="ou_xxxxxxxx"
```

   查不到时先分清是哪一层的问题，别乱猜：拿不到 `tenant_access_token` = App ID/Secret 不对；
   拿得到 token 但接口返回 `code=0` 却查无此人 = **权限没问题，只是这个手机号/邮箱不是你的飞书账号**；
   接口直接报权限错 = `contact:user.id:readonly` 开了但**没创建版本发布**（最常漏的一步）。

验证：

```bash
node scripts/push-feishu.mjs --mode doc --title "测试文档" --text "# 标题\n\n正文一段。"
```

预期输出 `{"ok":true,"mode":"doc","docUrl":"https://xxx.feishu.cn/docx/xxxx"}`，点开能看到排好版的文档。

---

## 用法

```bash
# 只推卡片
node scripts/push-feishu.mjs --mode card --title "标题" --file card.md --source-url "原视频链接"

# 只建文档
node scripts/push-feishu.mjs --mode doc --title "标题" --file full.md

# auto：有什么用什么（卡片给概要，文档给全文，卡片里带文档链接）
node scripts/push-feishu.mjs --title "标题" --file card.md --full-file full.md --source-url "原视频链接"
```

`--text "内容"` 可以替代 `--file`。输出永远是一行 JSON。

改了模板或拆分逻辑，先用 `--dry-run` 自检——只打印会推出去的卡片文本和文档正文，**不碰网络**，
别拿真群当靶场：

```bash
node scripts/push-feishu.mjs --dry-run --title "标题" --file card.md
```

---

## 踩过的坑（照抄的时候别绕回去）

- **飞书卡片的 `lark_md` 不是 markdown**：它只认 `**粗体**`、`*斜体*`、`~~删除线~~`、
  `[文字](链接)`、`<font color>` 和换行。**标题 `#`、引用 `>`、分隔线 `---`、代码围栏统统不认，
  会原样显示。** 2026-08-11 实测第一版推过去，`templates/card.md` 里金句是 `> ` 开头，
  卡片上就挂了一排裸 `>`。脚本里的 `toLarkMd()` 负责转换：
  标题→粗体、引用→「」、无序列表→圆点、分隔线→空行、代码围栏→去掉保内容。
  **改卡片模板时留意这个转换，别假设 markdown 原样能用。**
  另外两处也在 `toLarkMd()` 里处理了：`【摘要】` 这类分区标记自动加粗（模板里是裸的，
  markdown 产物保持干净，加粗只是飞书这一侧的排版需要）；正文首行的 H1 若与 `--title` 同义
  则整行丢弃 —— 卡片头部已经显示标题了，不去重每张卡都会把标题写两遍。
- **三层分隔符要在推送前去掉**：`—— 卡片 ——` / `—— 全稿 ——` / `—— 全文中译 ——` 是给脚本
  拆层用的机器标记，2026-08-12 实测第一版忘了删，它们原样躺在云文档正文里。
  `stripSeparators()` 负责收干净——**新增分隔符时记得同步这个函数**。
- **`--title` 会被截到 60 字**：飞书导入的文件名有长度限制，超了整个任务失败。
- **上传素材时不要手写 `Content-Type`**：multipart 边界由 `fetch` 自动生成，手写就传不上去。
- **文档必须转 owner**：不转的话它挂在应用名下，你在飞书里根本搜不到，只会留下一堆孤儿文档。
  所以 `FEISHU_OWNER_OPEN_ID` 没配时脚本直接报错，不会先建了再说。
- **卡片正文有 30KB 上限**：脚本在 8000 字处截断并提示看完整文档，宁可截断也不让整条推失败。
- **文档失败不拖垮卡片**：`auto` 模式下建文档报错时，只要 webhook 还在就照推卡片，
  降级信息走 stderr 如实上报，不静默吞掉。

---

## 想接别的地方？

这个文件就是模板。`scripts/push-feishu.mjs` 只有两件事：把 markdown 变成目标平台要的形状，然后 POST 出去。
照着写一个 Notion / Obsidian / 语雀 / Slack 的版本，大概是一顿饭的工夫——
或者把这个文件和脚本一起丢给你的 coding agent，说「照这个写一个 Notion 的」。

写好了欢迎发出来，我很想看看大家把解读接到了哪儿去。
