#!/usr/bin/env node
// 把解读产物推进飞书（可选增强，零 npm 依赖，Node 18+）。
// 端口自 knowledge-workbench backend/src/services/feishu-auth.js + feishu-docs.js，
// 去掉了工作台专属的知识库/owner 转移逻辑，只保留两条对个人用户最短的路径。
//
// 两档，配了哪档走哪档（跟转写降级链一个哲学：缺什么降什么）：
//   ① webhook 档（零门槛）：群里加「自定义机器人」拿一个 URL → 推一张卡片。30 秒配好。
//      需要：FEISHU_WEBHOOK（可选 FEISHU_WEBHOOK_SECRET，开了签名校验才要）
//   ② doc 档（5 分钟）：自建应用凭证 → 把完整 markdown 导入成飞书云文档，返回链接。
//      需要：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_OWNER_OPEN_ID
//
// 用法:
//   node push-feishu.mjs --mode card --title "标题" --file card.md [--source-url URL]
//   node push-feishu.mjs --mode doc  --title "标题" --file full.md
//   node push-feishu.mjs --mode auto --title "标题" --file card.md [--full-file full.md] [--source-url URL]
//   （--file 也可换成 --text "内容"；auto = 有 doc 凭证就建文档，再把文档链接一起推进卡片）
//   node push-feishu.mjs --get-open-id --mobile 13800138000   # 配置辅助：查自己的 open_id
// 输出: JSON { ok, mode, docUrl?, cardSent?, error? }
//
// 区域：FEISHU_BASE 默认 https://open.feishu.cn（飞书·中国）；国际版 Lark 填 https://open.larksuite.com。
// 代理：Node 18+ 的 fetch 不自动读 http_proxy。需要代理时用 NODE_OPTIONS 或在墙内直连（飞书国内直连即可）。

import { readFile } from 'fs/promises';
import { createHmac } from 'crypto';

// ---------- 参数 ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const die = (error) => { console.log(JSON.stringify({ ok: false, error })); process.exit(1); };

// ---------- 配置探测 ----------
const base = () => (process.env.FEISHU_BASE || 'https://open.feishu.cn').replace(/\/$/, '');
const hasWebhook = () => !!process.env.FEISHU_WEBHOOK;
const hasApp = () => !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);

// ---------- ① webhook 档：群自定义机器人卡片 ----------
// 签名校验（群机器人「签名校验」开关打开时才需要）：HMAC-SHA256，key = "{timestamp}\n{secret}"，空消息体。
function webhookSign(secret, timestamp) {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

// 卡片正文有 30KB 上限，长内容截断——宁可截断也别整条推失败。
function clip(s, max) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '\n\n…（内容较长已截断，完整版见文档 / 本地 markdown）';
}

// markdown → lark_md。
// 飞书卡片的 lark_md 只认 **粗体** / *斜体* / ~~删除线~~ / [文字](链接) / <font color> / 换行，
// **不认标题、引用、代码块、分隔线**——不转的话这些标记会原样显示。
// 2026-08-11 实测踩到：card.md 模板里金句是 `> ` 开头，推出去卡片上挂了一排裸 `>`。
function toLarkMd(md, title = '') {
  const out = [];
  let inFence = false;
  let quote = [];                              // 连续引用行攒起来，合成一段「」
  // 卡片头部已经显示标题了，正文首行的 H1 通常是同一句 —— 去掉，别让每张卡都重复一遍
  const norm = s => s.replace(/[\s：:·　]/g, '');
  let dropH1 = !!title;

  const flushQuote = () => {
    if (!quote.length) return;
    // card.md 的元数据行也是引用（`> 作者 | 平台 | 日期 | 来源`），套上引号会像金句 —— 按竖线认出来走纯文本
    if (quote.length === 1 && quote[0].includes('|')) out.push(quote[0]);
    // 金句用直角引号（飞书原生支持）；中英对照本来是两行，用换行连而不是空格，别揉成一句
    else out.push(`「${quote.join('\n')}」`);
    quote = [];
  };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');

    if (/^\s*```/.test(line)) { flushQuote(); inFence = !inFence; continue; }  // 去代码围栏，保内容
    if (inFence) { out.push(line); continue; }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { if (q[1].trim()) quote.push(q[1].trim()); else flushQuote(); continue; }
    flushQuote();

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(''); continue; }  // 分隔线 → 空行（卡片自带 hr）

    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const t = h[2].trim();
      // 首个 H1 若与卡片标题同义则整行丢弃（含头部标题是标题超长被截过的情况）
      if (dropH1 && h[1] === '#') {
        dropH1 = false;
        if (norm(t).startsWith(norm(title)) || norm(title).startsWith(norm(t))) continue;
      }
      out.push(`**${t}**`); continue;                                          // 其余标题 → 粗体
    }

    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) { out.push(`• ${li[1]}`); continue; }                               // 无序列表 → 圆点

    // 独占一行的分区标记（【摘要】【要点】【金句】…）自动加粗。
    // card.md 里它们是裸的 —— markdown 产物保持干净，加粗只是飞书这一侧的排版需要。
    const sec = line.match(/^\s*(【[^】]{1,12}】)\s*$/);
    if (sec) { out.push(`**${sec[1]}**`); continue; }

    out.push(line);
  }
  flushQuote();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pushCard({ title, markdown, sourceUrl, docUrl, outline = [], hasFullText = false }) {
  const url = process.env.FEISHU_WEBHOOK;
  const secret = process.env.FEISHU_WEBHOOK_SECRET;

  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: clip(toLarkMd(markdown, title), 8000) } }];
  // 讲述脉络目录：卡片装不下精读全文，但装得下它的骨架 —— 让人一眼看到覆盖了哪些段落
  if (outline.length) {
    elements.push({ tag: 'hr' });
    const shown = outline.slice(0, 12);
    const more = outline.length - shown.length;
    elements.push({ tag: 'div', text: { tag: 'lark_md', content:
      `**讲述脉络**（共 ${outline.length} 节）\n` + shown.map(t => `• ${t}`).join('\n')
      + (more > 0 ? `\n• …另 ${more} 节` : '') } });
  }

  const links = [];
  if (docUrl) links.push(`[📄 打开完整解读（精读 + 全文中译）](${docUrl})`);
  if (sourceUrl) links.push(`[🔗 看原视频](${sourceUrl})`);
  if (links.length) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: links.join('　　') } });
  }

  // 有全文却没建成文档 —— 必须说清楚它去哪了，不能让人以为解读就这么点东西
  if (hasFullText && !docUrl) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content:
      '精读与全文中译未随卡片发送：飞书卡片有 30KB 上限，长内容装不下。配好云文档档位后会自动附链接（见 integrations/feishu.md）；当前完整解读在本地 markdown 里。' }] });
  }

  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: 'watch-anything · 视频转写可能有少量误差，引用前回原视频核对' }],
  });

  const body = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title.slice(0, 100) }, template: 'blue' },
      elements,
    },
  };
  if (secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = webhookSign(secret, ts);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  // 群机器人成功返回 { code: 0 } 或 { StatusCode: 0 }（新旧两套字段都见过）
  if (j.code === 0 || j.StatusCode === 0 || j.StatusMessage === 'success') return true;
  throw new Error(`飞书群机器人推送失败(${j.code ?? j.StatusCode}): ${j.msg || j.StatusMessage || JSON.stringify(j).slice(0, 200)}`);
}

// ---------- ② doc 档：markdown → 飞书云文档 ----------
let tokenCache = { token: null, exp: 0 };

async function tenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token;
  const res = await fetch(`${base()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
  });
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`飞书鉴权失败(${j.code}): ${j.msg || '检查 FEISHU_APP_ID / FEISHU_APP_SECRET'}`);
  }
  tokenCache = { token: j.tenant_access_token, exp: now + (j.expire || 7200) * 1000 };
  return tokenCache.token;
}

async function api(path, { method = 'GET', query = null, body = null } = {}) {
  const token = await tenantToken();
  const url = new URL(base() + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.code != null && j.code !== 0) {
    const err = new Error(`飞书 API ${path} 失败(${j.code}): ${j.msg || ''}`);
    err.feishuCode = j.code;
    throw err;
  }
  return j.data ?? j;
}

// 上传 markdown 做导入素材。parent_type 固定 ccm_import_open（导入专用挂载点）。
// multipart 边界由 fetch 自动生成 —— 别手写 Content-Type，写了就传不上去。
async function uploadForImport(fileName, content) {
  const token = await tenantToken();
  const bytes = new TextEncoder().encode(content);
  const form = new FormData();
  form.set('file_name', fileName);
  form.set('parent_type', 'ccm_import_open');
  form.set('size', String(bytes.byteLength));
  form.set('extra', JSON.stringify({ obj_type: 'docx', file_extension: 'md' }));
  form.set('file', new Blob([bytes]), fileName);
  const res = await fetch(`${base()}/open-apis/drive/v1/medias/upload_all`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`导入素材上传失败(${j.code}): ${j.msg || ''}`);
  return j.data.file_token;
}

// 飞书转换通常 1-3s，给 20s 上限
async function waitImport(ticket) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const d = await api(`/open-apis/drive/v1/import_tasks/${ticket}`);
    const r = d?.result;
    if (r?.job_status === 0) return r;                       // { token, url, type }
    if (r?.job_status != null && r.job_status !== 1 && r.job_status !== 2) {
      throw new Error(`导入任务失败(job_status=${r.job_status}): ${r.job_error_msg || ''}`);
    }
  }
  throw new Error('导入任务超时（20s）');
}

async function createDoc({ title, markdown }) {
  const owner = process.env.FEISHU_OWNER_OPEN_ID;
  // fail fast：没配 owner 就别建 —— 建完才报错会在应用名下留一个你看不见的孤儿文档
  if (!owner) throw new Error('缺 FEISHU_OWNER_OPEN_ID：文档会建在应用名下，你自己打不开。见 integrations/feishu.md 第 3 步');

  const fileToken = await uploadForImport(`${title.slice(0, 60)}.md`, markdown);
  const task = await api('/open-apis/drive/v1/import_tasks', {
    method: 'POST',
    body: {
      file_extension: 'md', file_token: fileToken, type: 'docx',
      file_name: title.slice(0, 60),
      point: { mount_type: 1, mount_key: '' },
    },
  });
  const result = await waitImport(task.ticket);
  // owner 转给你本人，应用退为可编辑协作者 —— 不转的话文档只有应用能看见
  await api(`/open-apis/drive/v1/permissions/${result.token}/members/transfer_owner`, {
    method: 'POST', query: { type: 'docx' },
    body: { member_type: 'openid', member_id: owner },
  });
  return { url: result.url, token: result.token };
}

// ---------- 配置辅助：查自己的 open_id ----------
// doc 档必须把文档 owner 转给你本人，而 open_id 是「应用维度」的——同一个人在不同应用里 open_id 不同，
// 所以必须用你自己这个应用去查。需要权限 contact:user.id:readonly（开完记得创建版本并发布）。
async function getOpenId({ mobile, email }) {
  if (!hasApp()) throw new Error('先配 FEISHU_APP_ID / FEISHU_APP_SECRET 再查 open_id');
  const body = {};
  if (mobile) {
    const m = String(mobile).trim();
    // 国内 11 位手机号自动补国家码，飞书这个接口认 +86 前缀更稳
    body.mobiles = [/^1\d{10}$/.test(m) ? `+86${m}` : m];
  }
  if (email) body.emails = [String(email).trim()];
  if (!body.mobiles && !body.emails) throw new Error('要 --mobile 或 --email 之一');

  const d = await api('/open-apis/contact/v3/users/batch_get_id', {
    method: 'POST', query: { user_id_type: 'open_id' }, body,
  });
  const hit = (d?.user_list || []).find(u => u.user_id);
  if (!hit) {
    throw new Error('没查到 open_id：确认这个手机号/邮箱就是你登录飞书的那个，且应用已开通 contact:user.id:readonly 权限并发布了版本');
  }
  return hit.user_id;
}

// ---------- 主流程 ----------
async function main() {
  if (args['get-open-id']) {
    const openId = await getOpenId({ mobile: args.mobile, email: args.email });
    return { ok: true, openId, hint: `把这行加进 shell 配置：export FEISHU_OWNER_OPEN_ID="${openId}"` };
  }

  const mode = args.mode || 'auto';
  const title = (args.title || '').toString().trim();
  if (!title) die('缺 --title');

  let markdown = args.text ? String(args.text) : '';
  if (args.file) markdown = await readFile(String(args.file), 'utf8');
  if (!markdown.trim()) die('缺 --file 或 --text（要推的内容）');

  // card.md 的产物是「卡片 + 精读 + 全文中译」一个文件。
  // 分发规则（飞书卡片 30KB 上限，45 分钟视频的全文中译约 60KB，塞不进去）：
  //   云文档 ← 整篇，三层齐全，这才是交付物
  //   群卡片 ← 卡片那层 + 讲述脉络目录（当索引）+ 文档链接
  let fullMarkdown = markdown;
  let outline = [];
  if (args['full-file']) {
    fullMarkdown = await readFile(String(args['full-file']), 'utf8');
  } else {
    const m = markdown.match(/^\s*——\s*(全稿|精读)\s*——\s*$/m);
    if (m) {
      fullMarkdown = markdown;                                  // 文档拿整篇
      // 讲述脉络的 ### 小标题 → 卡片上的目录，让人一眼看到这份解读覆盖了哪些段落
      const arc = markdown.slice(m.index).match(/^##\s*讲述脉络[\s\S]*?(?=^##\s|^——|\Z)/m);
      if (arc) outline = [...arc[0].matchAll(/^###\s+(.*)$/gm)].map(x => x[1].trim());
      markdown = markdown.slice(0, m.index)                     // 卡片只拿第一层
        .replace(/^\s*——\s*卡片\s*——\s*$/m, '')
        .trimEnd();
    }
  }

  const sourceUrl = args['source-url'] ? String(args['source-url']) : null;

  if (mode === 'card') {
    if (!hasWebhook()) die('未配 FEISHU_WEBHOOK。群里加个「自定义机器人」拿 URL，见 integrations/feishu.md');
    await pushCard({ title, markdown, sourceUrl, outline, hasFullText: fullMarkdown !== markdown });
    return { ok: true, mode: 'card', cardSent: true };
  }

  if (mode === 'doc') {
    if (!hasApp()) die('未配 FEISHU_APP_ID / FEISHU_APP_SECRET，跑不了 doc 档。见 integrations/feishu.md');
    const doc = await createDoc({ title, markdown: fullMarkdown });
    return { ok: true, mode: 'doc', docUrl: doc.url };
  }

  // auto：有什么用什么。两档都有 → 先建文档，再把文档链接一起推进卡片。
  if (!hasWebhook() && !hasApp()) {
    die('飞书两档都没配（FEISHU_WEBHOOK 或 FEISHU_APP_ID/SECRET）。不配也不影响解读，见 integrations/feishu.md');
  }
  let docUrl = null;
  if (hasApp()) {
    try {
      docUrl = (await createDoc({ title, markdown: fullMarkdown })).url;
    } catch (e) {
      // 文档失败不该拖垮卡片 —— 降级如实上报，不静默吞掉
      if (!hasWebhook()) throw e;
      console.error(`[降级] 建文档失败，只推卡片：${e.message}`);
    }
  }
  let cardSent = false;
  if (hasWebhook()) {
    await pushCard({ title, markdown, sourceUrl, docUrl, outline, hasFullText: fullMarkdown !== markdown });
    cardSent = true;
  }
  return { ok: true, mode: 'auto', docUrl, cardSent };
}

main()
  .then(r => console.log(JSON.stringify(r)))
  .catch(err => {
    console.log(JSON.stringify({ ok: false, error: (err.message || String(err)).slice(0, 400) }));
    process.exit(1);
  });
