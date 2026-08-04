#!/usr/bin/env node
// X / 推特 单条推文抓取（零 npm 依赖，Node 18+ / 系统 curl）。
// 端口自 knowledge-workbench backend/src/services/content-ingestion.js 的 ingestX()（ADR-064）。
//
// 公开推文不需要登录：FxTwitter 镜像 API（免 key、纯 JSON，须带 UA 否则 401）
// 拿正文 + 作者 + 引用推文 + 媒体清单（图片 alt / 视频时长）。本脚本只负责"取文字与
// 媒体清单"；带视频时由 PLAYBOOK 再调 transcribe-video.mjs 下音轨转写（wan 分工）。
//
// 网络层用 curl 子进程而非 Node fetch：curl 天然读 http_proxy/https_proxy 环境变量，
// Node fetch（undici）不读——FxTwitter 与 X/YouTube 同属需代理平台，国内几乎都挂代理，
// fetch 直连会被重置（asr.js / content-ingestion.js 同款踩坑，注释保留原因）。
//
// 视觉诚实（沿用工作台 ADR-021）：图片/视频画面 P0 不解析，但如实声明其存在，
// 附上作者提供的 altText（如有），绝不让解读层凭空脑补图片/视频内容。
//
// 用法: node fetch-x.mjs <tweet_url>
// 输出: JSON { ok, text, author, publishedAt, sourceUrl, quote, photos, videos, error }
//   videos[].needsTranscribe=true 提示 PLAYBOOK：这条要下音轨转写才有视频内容

import { execFile } from 'child_process';
import { promisify } from 'util';

const pexec = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const url = (process.argv[2] || '').trim();
if (!url) {
  console.log(JSON.stringify({ ok: false, error: '用法: node fetch-x.mjs <tweet_url>' }));
  process.exit(1);
}

const statusId = url.match(/status(?:es)?\/(\d+)/)?.[1];
if (!statusId) {
  console.log(JSON.stringify({
    ok: false,
    error: '这个 X 链接里没有推文 ID（个人主页/搜索页暂不支持），请粘贴具体某条推文的链接。',
  }));
  process.exit(1);
}

try {
  const { stdout } = await pexec('curl', [
    '-sS', '--max-time', '15', '-A', UA,
    `https://api.fxtwitter.com/i/status/${statusId}`,
  ], { maxBuffer: 8 * 1024 * 1024 });

  let data;
  try { data = JSON.parse(stdout); } catch { data = null; }
  const tweet = data?.tweet;
  if (!tweet) {
    throw new Error(data?.message || 'FxTwitter 未返回推文数据');
  }

  const photos = (tweet.media?.photos || []).map((p, i) => ({
    index: i + 1,
    altText: p.altText?.trim() || null,
  }));

  // 动图（gif）无音轨，标记 needsTranscribe=false；真实视频才需要下音轨转写
  const videos = (tweet.media?.videos || []).map(v => ({
    type: v.type,
    durationSec: v.duration || null,
    durationMin: v.duration ? Math.round(v.duration / 60) : null,
    needsTranscribe: v.type !== 'gif',
  }));

  const quote = tweet.quote?.text?.trim()
    ? {
        text: tweet.quote.text.trim(),
        author: tweet.quote.author
          ? `${tweet.quote.author.name}（@${tweet.quote.author.screen_name}）`
          : null,
      }
    : null;

  console.log(JSON.stringify({
    ok: true,
    text: tweet.text?.trim() || '',
    author: tweet.author ? `${tweet.author.name}（@${tweet.author.screen_name}）` : null,
    publishedAt: tweet.created_timestamp
      ? new Date(tweet.created_timestamp * 1000).toISOString().slice(0, 10)
      : null,
    sourceUrl: tweet.url || url,
    quote,
    photos,
    videos,
  }));
} catch (err) {
  const reason = (err.stderr || err.message || '').toString().trim().slice(0, 300);
  console.log(JSON.stringify({
    ok: false,
    error: `推文抓取失败（${reason}）。受保护/NSFW/已删除的推文抓不到；最快：直接把推文文字粘进来。`,
  }));
  process.exit(1);
}
