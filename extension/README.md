# 待读队列扩展（可选）

看到一条看不完的视频，**点一下图标就走**，接着看你正在看的东西。链接进本机队列，
你的 agent 稍后把它读完，解读落成 markdown（配了飞书就一起推过去）。

不装也完全不影响：命令行 `node scripts/queue-server.mjs --add "<url>"` 是同一件事，
直接把链接丢给 agent 也是同一件事。这个扩展省下的只有「切窗口」那几秒——但正是那几秒
让你不想收藏了。

---

## 为什么它这么小（只有一个按钮）

解读要 `yt-dlp` 下音轨、`whisper` 转写，**浏览器扩展的沙箱里跑不了这两件事**。
所以这里不做解读、不做侧栏、不做渲染——扩展只当触发器，引擎在你本机的 agent 那边。

这不是偷懒，是边界：任何声称在浏览器里就能读完无字幕视频的东西，背后都有一个本机进程。

---

## 装（30 秒）

**1. 先把队列服务跑起来**（扩展要连的就是它）：

```bash
node scripts/queue-server.mjs
```

看到 `待读队列已就绪 → http://127.0.0.1:7391` 就行。想让它常驻，加 `&` 或用你惯用的进程管理。

**2. 加载扩展**（Chrome / Edge / Arc / Brave 都一样）：

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选中本目录（`extension/`）
4. 图标钉到工具栏

**3. 试一下**：随便打开一条 YouTube / X / B站 视频，点图标。

| 角标 | 意思 |
|---|---|
| ✓ 绿 | 已入队，鼠标悬停能看到待读几条 |
| = 橙 | 这条已经在队列里了（连点两下不会读两遍）|
| ! 红 | 没连上队列服务——多半是第 1 步没跑，或者端口被占 |

---

## agent 那边怎么取

```bash
node scripts/queue-server.mjs --list          # 待处理清单
node scripts/queue-server.mjs --list --json   # 给 agent 解析用
node scripts/queue-server.mjs --done <id> --doc-url "<飞书文档链接>"
node scripts/queue-server.mjs --fail <id> "转写失败：无字幕且未装 whisper"
```

队列是明文 `~/.watch-anything/queue.jsonl`，一行一条，可以直接 `cat`、`grep`、手改。
完整的取件流程见 `PLAYBOOK.md` 的「队列模式」。

---

## 改端口

服务端 `WA_QUEUE_PORT=8000 node scripts/queue-server.mjs`，
扩展端改 `background.js` 顶部的 `PORT`——两边必须一致。

## Safari / Firefox

它们的扩展打包方式不同，这个 MV3 目录装不上。同样的效果可以用书签小工具，
把下面这段存成书签的网址，在视频页点它即可（队列服务已经放行了跨域预检）：

```
javascript:fetch('http://127.0.0.1:7391/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,title:document.title})}).then(r=>r.json()).then(d=>alert(d.ok?'已入队':'失败：'+d.error)).catch(e=>alert('没连上本机队列，先跑 queue-server'));
```

## 隐私

扩展只在**你点击的那一刻**读取当前标签页的网址和标题，发往 `127.0.0.1`。
不注入页面脚本、不常驻监听、不发往任何外部服务器——`background.js` 一共 40 行，自己看一眼就知道。
