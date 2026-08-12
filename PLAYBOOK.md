# 看懂视频剧本（Watch Anything Playbook）

X 推文（含推文视频）/ YouTube / B站 / 无字幕视频链接 →
字幕优先或语音转写 → 中文卡片解读 → 基于材料的多轮问答。

本文件与具体 AI 工具无关：任何能执行 shell 命令的 agent 按此剧本操作即可。
下文的 `scripts/`、`templates/` 均相对于本文件所在目录。

watch-anything 是 read-anything 的姊妹：read 管读文字（把 X 只当文字抓），
watch 管看视频——**杀手锏是把无字幕视频、推文视频转写成中文可读内容**。

---

## 流程总览

```
① 识别链接类型 → ② 按路由表抓取（X 拿文字+媒体清单 / 视频取字幕或转写）
→ ③ 组装材料块（元数据规范）→ ④ 选模板生成卡片解读 → ⑤ 进入对话模式
```

全程遵守「诚实守则」（见下），每一级降级都必须显式声明。

---

## ① 链接类型识别

| 输入特征 | 类型 | 走哪条路由 |
|---|---|---|
| `x.com` / `twitter.com` 且含 `/status/<数字>` | X 单条推文（可能带视频） | X 路由（先 fetch-x，带视频再 transcribe-video） |
| `x.com` / `twitter.com` 个人主页/搜索页（无 status ID） | 抓不到 | 如实说明，请粘贴具体推文链接 |
| `youtube.com` / `youtu.be` | YouTube 视频 | 视频路由（transcribe-video） |
| `bilibili.com` / `b23.tv` | B站视频 | 视频路由（transcribe-video） |
| 其他视频/富媒体链接 | 尝试视频路由；yt-dlp 支持则转写，否则降级 | 视频路由 → 失败降级 |
| 纯文字链接（网页/博客/播客） | 不是本 skill 的主场 | 建议改用 read-anything（如已装） |

> read-anything 已覆盖网页/公众号/小宇宙播客/本地录音；watch-anything 专攻
> **视频与推文富媒体**。两者可并存，路由不冲突。

---

## ② 抓取路由表

所有脚本零 npm 依赖、Node 18+。网络层用 curl / yt-dlp 子进程（天然读代理环境变量，
Node fetch 不读——国内几乎都挂代理，这是端口自工作台的实测踩坑）。

### X / 推特 推文

```bash
node scripts/fetch-x.mjs "<tweet_url>"
```

输出 JSON `{ok, text, author, publishedAt, sourceUrl, quote, photos[], videos[], error}`。
经 FxTwitter 免登录镜像 API 拿正文 + 作者 + 引用推文 + 媒体清单。

- `videos[]` 里有 `needsTranscribe:true` 的项 → **这条推文带真实视频，再调 transcribe-video
  下音轨转写**（动图 gif 无音轨，`needsTranscribe:false`，跳过）：
  ```bash
  node scripts/transcribe-video.mjs "<tweet_url>"
  ```
- `photos[]` → 画面 P0 不解析，但如实声明附图张数；作者提供 `altText` 时附上，
  **不得凭空描述图片内容**。
- 失败（受保护/NSFW/已删推文） → 如实报告，请用户直接粘贴推文文字（推文短，粘贴成本低）。

### YouTube / B站 / 其他视频

```bash
node scripts/transcribe-video.mjs "<url>"        # 默认转前 40 分钟
node scripts/transcribe-video.mjs "<url>" --full # 长视频要全程转写
```

输出 JSON `{ok, text, source:'captions'|'asr', engine, truncated, language, error}`。
内部降级链（每级失败自动降下一级）：

1. **字幕优先**（`source:'captions'`）：yt-dlp 拉人工/自动字幕，快、准、无时长限制。
   语言列表精确写 `zh-Hans,zh-Hant,zh,en,en-orig`，**不用 `en.*` 通配**（会连带拉自动
   翻译版触发 429 限流，工作台实测坑）。
2. **Groq 云转写**（`engine:'groq'`）：配了 `GROQ_API_KEY` 时用 `whisper-large-v3-turbo`，
   快、近乎免费，单文件 ≤25MB（约短视频/中短播客）。
3. **本地 whisper**（`engine:'local'`）：faster-whisper，零 API 费、内容不出本机，
   首次自动下载 small 模型 ~460MB。CPU int8 约 3.2× 实时（40 分钟音频约转 12 分钟）。

注意事项：
- 走到本地转写（无字幕 + 无 Groq key）时，**先告知用户「本地转写约需几分钟」**再跑
- `truncated:true` → 视频超过 40 分钟只转了前段，材料头部与解读里都要声明
- 代理：yt-dlp 天然读 `http_proxy/https_proxy`；设了 `YOUTUBE_PROXY_URL` 而 shell 未配
  代理时脚本会自动加 `--proxy`（X 与 YouTube 复用同一代理出口）
- yt-dlp 未安装 → 视频路由整体不可用，如实告知装法（`brew install yt-dlp`），
  不要试图用别的方式硬抓视频

### 手动标时间戳（可选）

自己用 yt-dlp 拉了字幕想给金句标出处时：
```bash
node scripts/vtt-to-text.mjs <file.vtt> --timestamps
```

---

## ③ 材料组装规范

解读前必须组装带元数据的材料块。**元数据缺失时写「未知」，不许省略该行**——
模型必须知道"没有"，否则会从字幕/语音里猜人名（工作台真实案例：自动字幕把
Thariq Shihipar 误听成 "Tarik Shaupar"，缺元数据时解读稿把错名当真）。

```
【元数据】
- 原题/推文作者：<标题或作者 或 未知>
- 平台：<X / YouTube / B站 …>
- 链接：<url>
- 日期：<YYYY-MM-DD 或 未知>
- 内容来源：<视频字幕 / Groq 云转写 / 本地 whisper 转写 / 推文文字>
<降级时加一行> ⚠️ <降级说明，用下方话术模板>
【正文】
<推文文字 + 引用推文 + 附图声明 + 视频转写，或视频字幕/转写全文>
```

超长内容截断：字幕/转写取前 2 万字（前段足以支撑解读；agent 上下文充裕时可放宽），
截断必须在产物中声明「内容过长，已截取前段解读」。

---

## ④ 模板路由与生成

模板在 `templates/`，一个文件一个模板。**用户自定义 = 往目录里丢自己的 .md**。

| 内容特征 | 默认模板 |
|---|---|
| 一般视频 / 推文视频 / 富媒体（默认） | `card.md`（卡片 + 全稿：讲述脉络/关键案例/结构图）|
| 长演讲 / 深度访谈 / 播客 / 课程，用户说「精读 / 详细讲讲 / 替我看完」 | `deep-read.md`（不出卡片，整篇全稿，2000~3500 字）|
| 用户说「快扫 / 值不值得看」 | `brief.md` |
| 播客视频 / 对谈 / 圆桌（多人） | `interview.md` |
| X 连推 thread / 长推文 | `thread.md` |
| how-to / 教学 / 上手演示视频 | `tutorial.md` |
| 发布会 / 新品演示 / 行业新闻视频 | `news.md` |

用户一句话可覆盖（「用快扫」「用我的 xx 模板」）。生成前读取所选模板文件，
按其规则和结构输出。**输出语言默认简体中文**（英文视频直接用中文写解读，
不产出逐字译文；用户要全译时再单独翻）。

术语处理：Agent / RAG / LLM / Prompt / Token / Transformer 等通用术语保留英文；
Embedding→嵌入、Fine-tuning→微调；其余术语首次出现附英文。

产物默认直接输出；用户要求保存时落成 markdown 文件（文件名 = 中文标题）。

---

## ④.5 输出终点（可选，配了才走）

解读产出后，除了落成本地 markdown，还可以推到别的地方。**没配就跳过，一个字都别提**——
不要因为存在这个能力就去催用户配。

| 终点 | 触发条件 | 怎么做 |
|---|---|---|
| 飞书（群卡片 / 云文档） | 环境里有 `FEISHU_WEBHOOK` 或 `FEISHU_APP_ID` | 见下 |

飞书：卡片出完后问一句「要不要推进飞书」，用户说要就跑

```bash
node scripts/push-feishu.mjs --title "<中文标题>" --file <卡片md> [--full-file <全稿md>] [--source-url <原链接>]
```

脚本自己判断走哪档（webhook 卡片 / 云文档 / 两个都推），并按 `—— 卡片 ——` /
`—— 全稿 ——` / `—— 全文中译 ——` 自动拆分：**云文档拿整篇（三层齐全），群卡片只拿卡片层
+ 讲述脉络目录**——飞书卡片 30KB 上限，装不下全文中译。

**只配了 webhook 没配云文档时**：卡片会自带一条说明告诉用户全文去哪了，你也要口头补一句
「精读和全文中译在本地 markdown 里，想在飞书里看全文需要配云文档档位」。别让用户以为解读
就只有卡片那点东西。

失败如实告知并给出 `integrations/feishu.md` 的排查位置，**不要重试第二遍**——
飞书的报错基本都是配置问题，重试解决不了。

配置方法全在 `integrations/feishu.md`，用户问「怎么接飞书」时读它。
其他终点（Notion / Obsidian / 语雀…）没有内置，那个文件同时是写新终点的模板。

---

## ⑤ 对话模式

卡片解读输出后进入问答。规则：

- 回答**只基于材料**；材料里没有的，明确说「材料中没有提到」，不编造
- 材料是降级材料（仅推文文字/仅标题简介/转写截断）时，每次回答都要提醒局限，
  不假装看过完整视频
- 引用金句尽量带时间戳（字幕/转写有时间戳时）
- 用户追问超出材料范围且需外部信息时，说明这超出本材料，问是否另行检索
  （不混入未声明的外部知识冒充材料内容）

---

## 诚实守则（所有环节共享，优先级高于模板）

1. 只写材料里真实存在的内容，不编造不外推；无法确认的标「存疑」
2. 每一级降级都显式声明，并给出原链接让用户可自行核实
3. 抓取/转写失败时如实合并报告各层原因，不猜测、不掩盖第一手错误信息
4. **画面/图片 P0 不解析**：视频转写只覆盖"说了什么"，不覆盖"画面里有什么"；
   附图只声明存在与作者 altText。绝不凭空描述没看过的画面。
5. ASR 转写产物必须标注「音频转写生成，可能存在少量听写误差」；whisper 中文同音字
   误差是实测常态（"Momenta"→"萌萌塔"、"数据驱动"→"数据去动"）：解读时按上下文
   默默纠正即可，但**引用金句、人名、产品名、数字前必须核对原视频**，核对不了就不引用
6. 推文带视频但转写失败时，材料头部必须加显式声明，防止解读稿基于推文文字脑补
   出"完整视频内容"的假象

### 降级话术模板（直接复用，不要即兴改写弱化）

- 推文带视频但转写失败：
  `【重要声明】这条推文带视频，但音频转写失败（<原因>），以上仅为推文文字，不代表视频内容。解读时请明确这一局限，不要推测视频细节。`
- 视频无字幕无转写：
  `无法获取视频字幕，音频转写也失败（<原因>），以下基于标题与简介，请自行查看原视频核实：<url>`
- 转写截断：
  `视频较长，以下为前 40 分钟转写，可能存在少量听写误差`
- 推文抓取失败：
  `推文抓取失败（<原因>）。受保护/NSFW/已删除的推文抓不到；最快：直接把推文文字粘进来。`

---

## 环境自检（首次使用或失败排查时）

| 依赖 | 检测 | 缺失时 |
|---|---|---|
| Node 18+ | `node --version` | 必需（fetch-x / transcribe-video / vtt-to-text 运行时） |
| curl | 系统自带（macOS/Linux/Win10+） | 必需（网络层，天然支持代理环境变量） |
| yt-dlp | `yt-dlp --version`（报 bad interpreter 时用 `python3 -m yt_dlp`） | YouTube/B站/推文视频转写不可用；X 纯文字推文不受影响 |
| GROQ_API_KEY | 环境变量 | 无云转写，降级本地 whisper（慢但免费） |
| faster-whisper | `python3 -c "import faster_whisper"` | 无本地兜底；若也没 Groq key，则无字幕视频只能降级标题+简介 |
| YOUTUBE_PROXY_URL | 环境变量 | 网络可直连 YouTube/X 则不需要 |
| FEISHU_WEBHOOK / FEISHU_APP_ID | 环境变量 | 无输出终点，解读只落本地 markdown（不影响任何核心能力） |
