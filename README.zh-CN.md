<div align="center">

# watch-anything · 看不完的视频，让 AI 替你看懂

**丢一个 X / YouTube / B站 视频链接进来，几分钟后拿到一张一眼看完的中文卡片
（摘要 + 要点 + 金句中英对照）+ 完整解读 + 全文中译，还能就着它追问。**

**Drop in an X / YouTube / Bilibili video link, and minutes later get a glanceable card
(summary + key points + bilingual highlights) + a full breakdown + a full Chinese translation,
all of which you can then ask questions about.**

它是 [read-anything](https://github.com/heyuxuan0209/read-anything) 的姊妹：
**read 管读文字，watch 管看视频。**

<img src="assets/demo.gif" width="820" alt="watch-anything 演示：一条带 28 分钟视频的 X 推文 → 中文卡片解读">

<sub><b>⚠️ 先说清楚上面这张图</b>：那个漂亮的浏览器侧栏是<b>我自己的知识工作台</b>，<b>不在开源里</b>。<br>
开源的 watch-anything 是一个 <b>skill</b>——你在 Claude Code / Codex 里丢链接，它抓取 + 转写 + 出中文卡片，
产物是 markdown（长什么样见下面「怎么用」里的真实例子）。<br>
所以 star 之后你拿到的是：<b>抓取 + 无字幕转写 + 中文卡片解读 + 就地追问 + 可选推飞书</b>。
拿不到的是：这个侧栏 UI、灵感库。<br>
上图演示：X 上一条带 28 分钟视频的推文（Anthropic 官方 prompt 工作坊）→ 自动下音轨转写 → 出中文卡片。</sub>

</div>

[English](README.md) · **简体中文**

---

## 这是什么

收藏夹里是不是躺着一堆「打算有空再看」的视频——四十分钟的英文技术演讲、
一条带视频的推文、一期播客对谈、一个没字幕的 B 站长视频……结果一直吃灰，
看不完也看不动。

watch-anything 是一个 **Claude Code / Agent skill**：丢一个视频链接进去，它先抓内容、
（没字幕就）把音轨转写成文字，再由你的 AI 出一张中文卡片解读，产物落成 markdown
进你自己的知识库。全程在你的 agent 里完成，不用在十几个网页工具间来回切。

## 它解决的那个具体麻烦

- **收藏了没时间看** → 几分钟给你一张「不看原视频也懂」的卡片
- **英文 / 无字幕视频，别的总结工具直接歇菜** → 自动下音轨转写，再产出中文解读
- **想追问细节** → 就着转写对话，答案只基于原文，不编造
- **看完就忘、散落各处** → 解读落成 markdown，沉淀进你自己的系统

## 杀手锏：无字幕也能看懂

大多数「视频总结」工具依赖平台**已有的字幕**，碰上没字幕的视频就歇菜。
watch-anything 的核心是一条完整的转写降级链，每一级失败自动降下一级：

```
视频字幕（快、准）  →  Groq 云 whisper（几十秒、近乎免费）  →  本地 faster-whisper（零 API 费、不出本机）
```

有字幕就用字幕；没字幕就下音轨转写。配了 `GROQ_API_KEY` 走云端，没配就本地转
（音频不出本机）。这也是它相对 read-anything 的真价值：read 现在只把 X 当**文字**抓，
**不下载转写视频**；watch 补上的正是这块。

## 为什么是 skill，不是浏览器插件

因为杀手锏「无字幕视频转写」需要 `yt-dlp` + `whisper`——**这些在浏览器插件里跑不了**。
skill 是唯一「零服务器 + 全能力」的形态：宿主 Claude Code 本身就是大模型，skill 只
负责提供抓取 / 转写脚本，翻译解读交给宿主 agent。所以它不需要你自己架后端，
克隆下来就能用。

## 让你的 coding agent 带你装

你不需要看懂任何代码，甚至不用自己敲命令行。把这段话发给 Claude Code / Codex / Cursor /
任何 coding agent：

> 帮我把这个仓库下载下来，用大白话一步一步教我安装和配置。
> https://github.com/heyuxuan0209/watch-anything

它应该会：把仓库克隆到正确的 skills 目录 → 检查 Node 18+ 并装好 `yt-dlp` →
帮你判断要走云端转写（Groq key）还是纯本地 → 拿一个真视频跑通一遍给你看。

**任何 API key 都不要贴进 AI 聊天框、源码文件、截图或公开消息里。** key 你自己写进 shell 配置，
agent 能告诉你写在哪一行，但不需要看到它的值。

想自己动手的话，往下看。

## 怎么用

**安装**（Claude Code，一条命令）：

```bash
git clone https://github.com/heyuxuan0209/watch-anything.git ~/.claude/skills/watch-anything
```

装完在任何会话里丢个视频链接说「解读一下 / 讲了啥」即可触发。更新用
`git -C ~/.claude/skills/watch-anything pull`。只装到某个项目就克隆到项目的
`.claude/skills/watch-anything`。

**用起来长这样**（以上图那条推文为例，真实链接 [x.com/Krishnasagrawal/status/2084314878576365906](https://x.com/Krishnasagrawal/status/2084314878576365906)）：

```
你：https://x.com/Krishnasagrawal/status/2084314878576365906 这条视频讲了啥
它：（fetch-x 拿推文 → 发现带 28 分钟视频 → yt-dlp 下音轨 → Groq/本地 whisper 转写 → 出卡片）
```

出来的卡片（完整版见顶部 GIF）大致是这样：

```
# Anthropic 官方 prompt 工作坊：如何真正用好 Claude Code
> Krishna Agrawal（@Krishnasagrawal）| X | 2026-08-03 | 视频转写（语音听写，可能有少量误差）

【摘要】
Anthropic 团队成员 Boris 在一场 28 分钟免费研讨会里，系统讲解如何真正用好 Claude Code
这个 Agent 化编码助手：从环境配置、代码库上下文，到让它记住特定行为、写入 CLAUDE.md……

【要点】
- 给 Claude 一个能自我检查的反馈闭环（跑测试、Puppeteer 截图），它会自动迭代，比一次成型好得多
- 通过项目里的 CLAUDE.md 共享常用命令 / MCP 工具 / 斜杠决策，把团队工具接成 MCP 供它调用
- 用好快捷键：Shift+Tab 进自动接受、Esc 随时安全中断、输入「#」让它记住特定行为
- Code CLI 可当超级智能的 Unix 工具接进管道，适合 CI 故障响应、日志分析等进阶场景

【金句】
> 得到你想要的结果的最简单办法，是让它先思考。所以，先头脑风暴想法、制定计划，然后再写代码。
> The easiest way to get what you want is asking it to think first. So, brainstorm ideas, make a plan, and only then write the code.

> 给它一个能看到自己成果的方式，它就会迭代、越做越好。
> Give it a way to see the results of its own work, and it will iterate and get much better.

—— 全稿 ——

**一句话核心**：把 Claude Code 当会自查的同事用，而不是当补全工具。

## 讲述脉络
### 开场：为什么大多数人用不好它 [00:40]
（按原片实际结构一节一节走完，还原他是怎么把这件事讲清楚的——论证过程、
为什么这么说、中间的转折和让步。这一节是全稿主体，1500~3000 字）

### 反馈闭环：让它自己看见结果 [06:12]
…

## 关键案例与细节   ## 简版结构图   ## 局限与存疑
```

**不止 Claude——任何能跑 shell 命令的 agent 都能用**（Codex / Cursor / Gemini CLI /
WorkBuddy / OpenClaw…）：核心逻辑全在 `PLAYBOOK.md`（纯 markdown 剧本）+ `scripts/`
（普通命令行工具，JSON 进出），不依赖任何 Claude 特性。接法都是**克隆 + 在你的 agent
指令文件里贴一段话**：

```bash
git clone https://github.com/heyuxuan0209/watch-anything.git ~/.agent-skills/watch-anything
```

往下面这个文件里贴这段（各家只是文件名不同）：

```markdown
## watch-anything（视频/推文 → 中文卡片解读）
当我丢 X / YouTube / B站 / 视频链接并要求「解读 / 看懂 / 讲了啥 / 转写」时，
按 ~/.agent-skills/watch-anything/PLAYBOOK.md 执行（路由、转写降级链、卡片格式、降级规则都在里面）。
```

| Agent | 指令文件 |
|---|---|
| Codex CLI | `~/.codex/AGENTS.md`（全局）或项目根 `AGENTS.md` |
| Cursor | 项目 `.cursor/rules/` 下新建规则（或旧版 `.cursorrules`） |
| Gemini CLI | `~/.gemini/GEMINI.md`（全局）或项目根 `GEMINI.md` |
| WorkBuddy / 其他 / 懒得配 | 往它的指令/规则文件贴上面那段；或每次直接说「按 ~/.agent-skills/watch-anything/PLAYBOOK.md 处理这个链接」 |

## 吃得下这些

- **X 推文 / 推文视频**：免登录抓正文 + 引用推文 + 媒体清单；带视频自动下音轨转写
- **YouTube**：字幕优先，无字幕本地/云转写
- **B站**：同上
- **其他视频链接**：yt-dlp 支持的都试

英文视频直接产出中文解读（不用先翻译再看）。图片 / 视频画面 P0 不解析——
只覆盖「说了什么」，不假装看过「画面里有什么」。

## 卡片格式（默认）+ 三种备选

默认输出**三层齐全**：

| 层 | 是什么 | 用来干嘛 |
|---|---|---|
| **卡片** | 【摘要】3 句 · 【要点】3-6 条 · 【金句】中英对照带时间戳 | 三十秒判断值不值得往下读 |
| **精读** | 【讲述脉络】按原片实际结构分小节走完 + 【关键案例与细节】+【简版结构图】+【局限与存疑】 | 不看原视频也能完整理解它 |
| **全文中译** | 逐段中译的完整内容，只译不评 | 查证、引用、搜索——根基，不能省 |

卡片是入口，精读是主体，全文中译是底座。精读长度 1500~3000 字，长视频可放宽；
材料本来就是中文（B站 / 中文播客）时，第三层直接放转写原稿，不多此一举地"翻译"一遍。

| 你想要 | 用哪个模板 |
|---|---|
| 卡片 + 完整解读（默认） | 卡片解读 `card.md` |
| **一篇能替代看原片的稿子** | **精读稿 `deep-read.md`** |
| 30 秒判断值不值得看 | 快扫 `brief.md` |
| 播客 / 对谈，按人拆观点 | 访谈拆解 `interview.md` |
| X 连推 thread / 长推文 | Thread 拆解 `thread.md` |
| how-to / 教学 / 上手视频，拆成可照做的步骤 | 教程拆解 `tutorial.md` |
| 发布会 / 新品 / 行业新闻视频 | 发布会解读 `news.md` |

**模板都能改、能加**：`templates/` 里每个 .md 都可删可改，丢一个你自己的进去就是新模板，
说一句「用我的 xx 模板」即可。这些模板是干净的通用视角，不含任何个人化 / 产品化内容——
想让解读贴合你自己的关注点（比如"对我产品的启发"），自己加一个模板就行。

## 输出终点：解读完了往哪儿放

默认落成本地 markdown。想让它顺手进别的地方，`integrations/` 里放的就是这一层。

目前内置**飞书**：一档是群机器人卡片（30 秒配好，一张卡推进群里），一档是云文档
（5 分钟配好，完整解读导入成飞书文档，能搜能改能分享）。两档都配就先建文档、
再把文档链接一起推进卡片。**不配完全不影响解读**——这是加分项，不是前置条件。

上面那三层里，**云文档拿整篇（三层齐全），群卡片只拿卡片层 + 讲述脉络目录**——
飞书卡片有 30KB 上限，装不下几万字的全文中译。只配了 webhook 的话，卡片会自己说明
全文在哪儿；想在飞书里读到全文，云文档那一档是必须的。

```bash
node scripts/push-feishu.mjs --title "标题" --file card.md --full-file full.md --source-url "原链接"
```

配置方法见 [`integrations/feishu.md`](integrations/feishu.md)（含实测踩过的坑）。

**想接 Notion / Obsidian / 语雀 / Slack？** 那个文件就是模板：脚本只干两件事——
把 markdown 变成目标平台要的形状，然后 POST 出去。照着写一个大概是一顿饭的工夫，
或者把文件和脚本一起丢给你的 coding agent，说「照这个写一个 Notion 的」。
写好了欢迎发出来，我很想看看大家把解读接到了哪儿去。

## 一个原则：看不到就说看不到

推文抓不到、音频没转成、画面没解析——都如实告诉你，绝不拿残缺材料硬编一篇
像模像样的解读。转写产物标注「可能存在听写误差」，引用金句提醒你核对原视频。
你读到的每一句都有据可查。

## 依赖

| 依赖 | 是否必需 | 用途 |
|---|---|---|
| Node.js 18+ | 必需 | 四个 mjs 脚本的运行时（零 npm 依赖） |
| curl | 必需（系统自带） | 网络层，天然支持代理环境变量 |
| yt-dlp | 视频路由必需 | 拉字幕 + 下音轨（`brew install yt-dlp`）；缺了则只能处理 X 纯文字推文 |
| GROQ_API_KEY | 可选 | Groq 云 whisper 转写（快、近乎免费、≤25MB）；[console.groq.com](https://console.groq.com) 免费领 |
| faster-whisper | 可选 | 本地转写兜底（`pip install faster-whisper`，首次自动下载 ~460MB 模型） |
| FEISHU_WEBHOOK / FEISHU_APP_ID | 可选 | 输出终点：解读推进飞书群卡片 / 云文档，见 [`integrations/feishu.md`](integrations/feishu.md) |

**转写至少需要 Groq key 或 faster-whisper 其一**；两者都没有时，无字幕视频只能
降级到标题 + 简介并**显式告知你降级了**。缺可选依赖不报错——对应内容自动降级。

国内网络访问 YouTube / X 需设置 `YOUTUBE_PROXY_URL` 环境变量（如 `http://127.0.0.1:7890`）。
Groq 上传走 `HTTPS_PROXY` / `http_proxy` 环境变量（curl 天然读）。

## 到底要花多少钱

skill 本身免费、零服务器。可能产生费用的只有两处，而且都不经我的手：

**转写。** 只有走 Groq 云端才花钱。2026-08-11 查，Groq
[语音识别文档](https://console.groq.com/docs/speech-to-text) 标 `whisper-large-v3-turbo`
**每小时音频 $0.04**：

| 视频时长 | Groq 云端花费 |
|---|---|
| 28 分钟演讲 | ≈ $0.019（约 ¥0.13） |
| 45 分钟播客 | ≈ $0.03（约 ¥0.22） |
| 2 小时对谈 | ≈ $0.08（约 ¥0.58） |

Groq 免费额度限制单文件 25MB，脚本已经按这个上限处理。**视频只要有字幕，转写这步就是零成本**——
字幕永远优先。价格会变，认真算之前请以上面那页为准。

**本地转写永久免费**，音频不出本机，代价是时间。2026-08-11 在 Apple M1 Pro 上实测，
`faster-whisper` `small` 模型 CPU int8：**443 秒音频耗时 109 秒，约 4.1 倍速实时**。
所以 45 分钟视频大约 11 分钟，2 小时的大约 30 分钟。这就是那笔交易——不要 key、不联网、
不花钱，但你得等。

**解读**由你的宿主 agent（Claude Code / Codex …）完成，用的是你本来就在付的订阅或 API，
skill 不额外调任何模型。

## 出问题了怎么办

### skill 没被触发

- 确认克隆落在 `~/.claude/skills/watch-anything`（别多套一层目录——`SKILL.md` 要直接躺在里面）
- 开一个新会话，skill 在会话启动时加载
- 直接明说：「用 watch-anything 解读这个链接」
- 非 Claude 的 agent，确认那段话贴进了它的指令文件（见上面的表）

### `yt-dlp: command not found` / `bad interpreter`

- `brew install yt-dlp`，然后 `yt-dlp --version` 验一下
- 装了却报 `bad interpreter`，是它的 shebang 指向了被删掉的 Python（homebrew 升级 Python 后常见）。
  **脚本会自己探测并降级到 `python3 -m yt_dlp`**，所以多半不用管；想彻底修就 `pip install -U yt-dlp` 重装
- 没有 yt-dlp 就只能处理纯文字推文，所有视频路由都要它

### 长视频「音频下载失败：下载超时」

- 默认给 20 分钟。一小时的演讲走 HLS 分片下载，慢网络下确实会顶到上限——
  用 `WA_DOWNLOAD_TIMEOUT_MIN=40 node scripts/transcribe-video.mjs ...` 放宽即可
- 脚本已经按 ≤64k 的低码率音轨优先 + 8 路并发拉分片（转写只吃人声，码率低不影响识别，
  一小时视频从 55MB 降到 28MB）。还是超时的话基本是网络问题，配代理试试
- 配了 `GROQ_API_KEY` 且视频超过 45 分钟时会再降到 32k（约 14MB/小时），
  好留在 Groq 的 25MB 上限内——否则一小时的演讲会退回本地 whisper，慢十倍

### 音轨下下来了，转写失败

- 既没 `GROQ_API_KEY` 也没 `faster-whisper`，就没有转写器。装一个：
  `pip install faster-whisper`（免费、本地），或去 [console.groq.com](https://console.groq.com) 免费领 key
- Groq 报 `401` = key 不对；报 `413` = 免费额度下文件超 25MB，本地兜底能接
- 首次本地转写要下载 ~460MB 模型。**它不是卡住了，是在下载**

### 转写稿里人名不对、有怪词

正常，产物里也会声明。语音识别听错专有名词是常态——这个项目自己踩过的真实案例：
自动字幕把 "Thariq Shihipar" 听成了 "Tarik Shaupar"。**基于转写的解读，里面的人名和数字
都要回原视频核对。** 卡片里永远带这条警告，你引用的时候别把它删掉。

### 推文抓不到

受保护 / NSFW / 已删除的推文免登录抓不到。最快的办法：直接把推文文字粘进来。

### YouTube / X 超时

在墙内就配 `YOUTUBE_PROXY_URL`。`yt-dlp` 也天然读 `http_proxy` / `https_proxy`，配那两个也行。

### 飞书推送失败

见 [`integrations/feishu.md`](integrations/feishu.md)，错误码和对应原因都列在那儿。
**推飞书失败不影响解读本身**——走到那一步时卡片已经出来了。

## 文件结构

```
watch-anything/
├── SKILL.md          # Claude Code 触发入口（薄壳）
├── PLAYBOOK.md       # 通用剧本：路由/转写降级链/卡片格式/诚实守则（agent 无关）★
├── templates/        # 解读模板（卡片/快扫/访谈/Thread + 你自己的）
├── integrations/     # 输出终点：feishu.md（同时是写新终点的模板）
└── scripts/          # fetch-x / transcribe-video / vtt-to-text / push-feishu（零依赖）+ transcribe.py（本地 whisper）
```

各脚本单独可跑，JSON 进出，方便你接进自己的管道。

## 有浏览器插件吗？能边看网页边讲解吗？

**暂时没有。** watch-anything 是纯 agent skill——你在 Claude Code / 别的 agent 里丢链接，
它抓取 + 转写 + 解读。顶部 GIF 里那个浏览器侧边面板，是我自己知识工作台的**内置版**
（接本机后端），**不在本 skill 里**。「装个插件、边刷网页边看讲解」的浏览器版在路线图上
（P2），做出来会另开一个仓——这里先把「零服务器 + 全能力」的 skill 版做扎实。

## 出处

从个人知识管理系统 [knowledge-workbench](https://github.com/heyuxuan0209/knowledge-workbench)
的内容采集链路（ADR-064 云转写通道）提炼——脚本里的加固点（FxTwitter 免登录抓推文、
X 视频音画合流 `bestaudio/best` 兜底、字幕 `en.*` 通配触发 429 的坑、Node fetch 不读代理
必须走 curl、whisper 中文同音字误听人名警示、推文视频转写失败的显式声明等）都来自真实
踩坑，注释里保留了原因。

---

## 🔗 关注我 · Follow me

边做 AI 产品边把一手经验和思考公开分享，欢迎关注、来聊。<br>
I build AI products in public and share the notes here — come say hi:

<table>
  <tr>
    <td align="center"><b>小红书 · Xiaohongshu</b></td>
    <td align="center"><b>公众号 · WeChat</b></td>
    <td align="center"><b>视频号 · Channels</b></td>
    <td align="center"><b>抖音 · Douyin</b></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/qr-xiaohongshu.jpg" width="200" alt="小红书 杰西卡"></td>
    <td align="center"><img src="assets/qr-wechat.jpg" width="200" alt="公众号 杰西卡聊AI"></td>
    <td align="center"><img src="assets/qr-shipinhao.jpg" width="200" alt="视频号 杰西卡"></td>
    <td align="center"><img src="assets/qr-douyin.jpg" width="200" alt="抖音 杰西卡"></td>
  </tr>
</table>

## 二创指南 · 这东西更适合被你改

**它的架构就是为了好改设计的**：核心是一个 markdown 剧本（`PLAYBOOK.md`）+ 几个零依赖的
命令行脚本。没有框架、没有构建步骤、没有服务器。你的 coding agent 读一遍就能改，
不需要你自己懂代码。

几个具体的、抄了就能动手的方向：

- **加一个你自己的解读模板**——最简单的一个。往 `templates/` 丢一个 `.md`，说一句
  「用我的 xx 模板」就生效。比如「对我做产品有什么启发」「这个观点和我上周读的那篇冲突吗」
- **换输出终点**——照着 [`integrations/feishu.md`](integrations/feishu.md) 和
  `scripts/push-feishu.mjs` 写一个 Notion / Obsidian / 语雀 / Slack 的版本。
  脚本只干两件事：把 markdown 变成目标平台要的形状，然后 POST 出去
- **加批量模式**——把收藏夹里三十条链接一次性扔进去，跑完出一个汇总
- **接更多源**——小宇宙、Apple Podcast，`yt-dlp` 能下的都可以试
- **换输出语言**——想要英文或日文解读，改模板里一句话

改完**欢迎发出来 @ 我**，我很想看看大家改成了什么样。

## License

MIT — 见 [LICENSE](LICENSE)。欢迎 **Star / Fork / Issue**，也欢迎二次开发、魔改、接进你自己的产品或工作流。**唯一的请求**：二开或转载时**注明出处**，并 **@ 一下我**（公众号 / 小红书「**杰西卡聊AI**」，主页见上）——让顺着来的人能找到源头，就是最好的感谢 🙏。

MIT licensed — see [LICENSE](LICENSE). **Star / Fork / Issues welcome**, and feel free to remix, modify, or build it into your own product or workflow. **One ask:** if you fork/remix or repost, please **credit the source and @ me** (Jessica · 杰西卡聊AI). That's the best thank-you 🙏.

