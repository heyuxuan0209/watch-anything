#!/usr/bin/env node
// 待读队列：浏览器点一下 → 链接进队列 → agent 后台取走解读（零 npm 依赖，Node 18+）。
//
// 为什么需要它：杀手锏「无字幕视频转写」要 yt-dlp 下音轨 + whisper 转写，**这两件事在浏览器
// 扩展的沙箱里跑不了**。所以扩展只能当触发器，引擎必须在本机。这个服务就是那道门：
// 扩展 POST 一个 URL 进来，你接着看你的视频，agent 稍后把它读完。
//
// 只监听 127.0.0.1 —— 它没有鉴权，也不该有：一旦对外网开放，任何人都能往你机器上塞链接。
//
// 用法:
//   node queue-server.mjs                     # 起服务（前台；后台跑加 & 或用 nohup）
//   node queue-server.mjs --list [--json]     # 看待处理的
//   node queue-server.mjs --add <url>         # 命令行也能塞（不装扩展照样能用）
//   node queue-server.mjs --done <id> [--doc-url <url>]
//   node queue-server.mjs --fail <id> "<原因>"
//
// 队列文件: ~/.watch-anything/queue.jsonl（一行一条，人可读、可手改、可 grep）
// 端口: WA_QUEUE_PORT，默认 7391

import { createServer } from 'http';
import { mkdir, readFile, writeFile, appendFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const PORT = Number(process.env.WA_QUEUE_PORT || 7391);
const DIR = join(homedir(), '.watch-anything');
const FILE = join(DIR, 'queue.jsonl');

async function load() {
  try {
    const raw = await readFile(FILE, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function add({ url, title = '', note = '' }) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('不是一个 http(s) 链接');
  await mkdir(DIR, { recursive: true });
  const items = await load();
  // 同一条链接还没处理完就别重复排队 —— 连点两下图标是常态，不该变成解读两遍
  const dup = items.find(i => i.url === url && i.status === 'pending');
  if (dup) return { ...dup, duplicate: true };
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url, title, note, status: 'pending', addedAt: new Date().toISOString(),
  };
  await appendFile(FILE, JSON.stringify(item) + '\n', 'utf8');
  return item;
}

// 状态更新走「整表重写」：队列是几十条量级的东西，为省这点 IO 引入数据库不划算，
// 而 jsonl 明文可手改的好处在排查时值回票价。
async function update(id, patch) {
  const items = await load();
  const hit = items.find(i => i.id === id || i.id.startsWith(id));
  if (!hit) throw new Error(`队列里没有 id=${id}`);
  Object.assign(hit, patch, { updatedAt: new Date().toISOString() });
  await writeFile(FILE, items.map(i => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  return hit;
}

// ---------- HTTP ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  // Chrome 的 Private Network Access：https 页面上的书签小工具往 127.0.0.1 发请求时要它，
  // 否则预检直接被拦。扩展自己有 host_permissions，用不到这条，但书签方案要。
  'Access-Control-Allow-Private-Network': 'true',
};
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
};

function serve() {
  createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    try {
      if (url.pathname === '/health') {
        return json(res, 200, { ok: true, service: 'watch-anything-queue', port: PORT });
      }
      if (url.pathname === '/queue' && req.method === 'GET') {
        const items = await load();
        const status = url.searchParams.get('status');
        return json(res, 200, { ok: true, items: status ? items.filter(i => i.status === status) : items });
      }
      if (url.pathname === '/queue' && req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const item = await add(body);
        const pending = (await load()).filter(i => i.status === 'pending').length;
        process.stdout.write(`[queue] + ${item.url}${item.duplicate ? '（已在队列，未重复添加）' : ''}\n`);
        return json(res, 200, { ok: true, id: item.id, duplicate: !!item.duplicate, pending });
      }
      return json(res, 404, { ok: false, error: '只有 /health 和 /queue' });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }).listen(PORT, '127.0.0.1', () => {
    process.stdout.write(
      `待读队列已就绪 → http://127.0.0.1:${PORT}\n` +
      `队列文件：${FILE}\n` +
      `浏览器里点扩展图标塞链接；agent 用 \`node scripts/queue-server.mjs --list\` 取。\n`);
  }).on('error', (e) => {
    const hint = e.code === 'EADDRINUSE'
      ? `端口 ${PORT} 已被占用 —— 多半是队列服务已经在跑了，别开第二个（换端口用 WA_QUEUE_PORT）`
      : e.message;
    process.stderr.write(`启动失败：${hint}\n`);
    process.exit(1);
  });
}

// 轮询心跳。**「loop 死了」和「队列本来就空」在外部看是同一副样子**（都没有新卡片出现），
// 所以每一轮无论有没有活都要留一行痕迹：日志停止增长 = 轮询挂了，noop 行在长 = 轮询活着但没活干。
// 判据来自 ~/.claude/METHOD-多agent状态同步.md 第三节：失败时和成功时同形的信号是废信号。
const TICK_LOG = join(DIR, 'loop.log');
async function tick(note = '') {
  await mkdir(DIR, { recursive: true });
  const pending = (await load()).filter(i => i.status === 'pending');
  const line = `${new Date().toISOString()} | pending=${pending.length} | ${note || (pending.length ? 'has-work' : 'noop')}\n`;
  await appendFile(TICK_LOG, line, 'utf8');
  return { ok: true, pending: pending.length, items: pending.map(i => ({ id: i.id, url: i.url, title: i.title })) };
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] || true) : null; };

if (argv.includes('--tick')) {
  console.log(JSON.stringify(await tick(typeof flag('--tick') === 'string' ? String(flag('--tick')) : '')));
} else if (argv.includes('--list')) {
  const items = (await load()).filter(i => i.status === 'pending');
  if (argv.includes('--json')) console.log(JSON.stringify({ ok: true, items }));
  else if (!items.length) console.log('队列是空的。');
  else items.forEach(i => console.log(`${i.id}  ${i.addedAt.slice(0, 16).replace('T', ' ')}  ${i.title || ''}\n          ${i.url}`));
} else if (flag('--add')) {
  const item = await add({ url: String(flag('--add')), title: String(flag('--title') || '') });
  console.log(JSON.stringify({ ok: true, id: item.id, duplicate: !!item.duplicate }));
} else if (flag('--done')) {
  const hit = await update(String(flag('--done')), { status: 'done', docUrl: flag('--doc-url') || null });
  console.log(JSON.stringify({ ok: true, id: hit.id, status: 'done' }));
} else if (flag('--fail')) {
  const hit = await update(String(flag('--fail')), { status: 'failed', error: String(argv[argv.indexOf('--fail') + 2] || '未说明原因') });
  console.log(JSON.stringify({ ok: true, id: hit.id, status: 'failed' }));
} else {
  serve();
}
