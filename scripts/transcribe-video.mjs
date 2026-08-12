#!/usr/bin/env node
// 视频取全文：字幕优先 → 无字幕才下音轨本地/云转写（零 npm 依赖，Node 18+）。
// 端口自 knowledge-workbench backend/src/services/asr.js（ADR-064 云通道 + ADR-015 本地兜底）。
// 这是 watch-anything 相对 read-anything 的杀手锏：read 只把 X 当文字，watch 会把
// 无字幕视频/推文视频转写出来。
//
// 依赖（都可选，缺谁降级谁）：
//   - yt-dlp：拉字幕 + 下音轨（X / YouTube / B站）。缺失则视频路径整体不可用。
//   - GROQ_API_KEY（env）：Groq 云 whisper-large-v3-turbo，快、近乎免费、≤25MB。
//   - faster-whisper（python3）：本地兜底，零 API 费、内容不出本机（scripts/transcribe.py）。
// 优先级：字幕 > Groq 云 > 本地 whisper。每一级失败自动降级，最终失败如实上抛。
//
// 代理：yt-dlp 天然读 http_proxy/https_proxy；设了 YOUTUBE_PROXY_URL 而 shell 未配代理时
// 显式加 --proxy（X 与 YouTube 复用同一代理出口）。curl 上传 Groq 也天然走代理环境变量。
//
// 用法: node transcribe-video.mjs <url> [--full]
//   --full: ASR 兜底时转全程（默认只转前 40 分钟，够绝大多数演讲/播客/推文视频）
// 输出: JSON { ok, text, source:'captions'|'asr', engine, truncated, language, error }

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readdir, readFile, rm } from 'fs/promises';

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_AUDIO_SECONDS = 2400;   // 兜底自动转写：40 分钟
const FULL_AUDIO_SECONDS = 10800; // --full：3 小时
// 下载超时：一小时的播客/演讲，慢网络下 5 分钟真的下不完（实测踩到）。
// 给到 20 分钟，急用的人可以用 WA_DOWNLOAD_TIMEOUT_MIN 自己调小。
const DOWNLOAD_TIMEOUT = Number(process.env.WA_DOWNLOAD_TIMEOUT_MIN || 20) * 60000;
const TRANSCRIBE_TIMEOUT = 15 * 60000;

const url = (process.argv[2] || '').trim();
const full = process.argv.includes('--full');
if (!url) {
  console.log(JSON.stringify({ ok: false, error: '用法: node transcribe-video.mjs <url> [--full]' }));
  process.exit(1);
}

function proxyArgs() {
  return process.env.YOUTUBE_PROXY_URL ? ['--proxy', process.env.YOUTUBE_PROXY_URL] : [];
}

// VTT/SRT → 纯文本：去时间轴/内联标签/序号，合并 YouTube 自动字幕逐行滚动的重复。
function parseSubtitles(raw) {
  const out = [];
  let last = '';
  for (let line of raw.split(/\r?\n/)) {
    line = line.replace(/<[^>]+>/g, '').trim(); // 去 <c>/<00:00:00.000> 等内联标签
    if (!line || line === 'WEBVTT') continue;
    if (line.includes('-->')) continue;         // 时间轴行
    if (/^\d+$/.test(line)) continue;           // SRT 序号
    if (/^(Kind|Language|NOTE):/i.test(line)) continue;
    if (line === last) continue;                // 自动字幕滚动重复
    out.push(line); last = line;
  }
  return out.join('\n').trim();
}

// 解析可用的 yt-dlp 调用方式，结果缓存。
// homebrew 升级 Python 后，yt-dlp 的 shebang 会指向已删掉的解释器，二进制还在但一跑就
// 「bad interpreter」——2026-08-12 在本机实测到。这种情况下 `python3 -m yt_dlp` 通常仍然可用，
// 所以先探二进制、坏了就落模块调用，别让一个坏 shebang 把整条视频路由废掉。
let ytdlpCmd = null;
async function ytdlp() {
  if (ytdlpCmd) return ytdlpCmd;
  for (const cand of [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']]]) {
    try {
      await pexec(cand[0], [...cand[1], '--version'], { timeout: 20000 });
      ytdlpCmd = cand;
      if (cand[0] !== 'yt-dlp') process.stderr.write('[yt-dlp] 二进制不可用，已降级到 python3 -m yt_dlp\n');
      return ytdlpCmd;
    } catch { /* 试下一个 */ }
  }
  throw new Error('未安装可用的 yt-dlp（brew install yt-dlp；若报 bad interpreter 用 pip install -U yt-dlp 重装），无法处理视频');
}

// yt-dlp 拉字幕（含自动字幕）。命中返回纯文本，无字幕/失败返回 null（不阻断，落 ASR）。
async function fetchCaptions(workDir) {
  const args = [
    '--skip-download', '--write-subs', '--write-auto-subs',
    // 精确语言列表：不用 en.* 通配（会连带拉自动翻译版触发 429），只补几个常见变体
    '--sub-langs', 'zh-Hans,zh-Hant,zh,en,en-orig',
    '--sub-format', 'vtt/srt/best', '--no-playlist',
    '-o', join(workDir, 'sub.%(ext)s'), ...proxyArgs(), url,
  ];
  try {
    const [cmd, pre] = await ytdlp();
    await pexec(cmd, [...pre, ...args], { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    process.stderr.write(`[captions] 拉取失败：${(err.stderr || err.message || '').toString().slice(0, 120)}\n`);
    return null;
  }
  const files = (await readdir(workDir)).filter(f => /\.(vtt|srt)$/i.test(f));
  if (!files.length) return null;
  // 优先中文字幕（含自动），其次英文
  const pick = files.sort((a, b) => (/(zh|Hans|Hant)/i.test(b) ? 1 : 0) - (/(zh|Hans|Hant)/i.test(a) ? 1 : 0))[0];
  const text = parseSubtitles(await readFile(join(workDir, pick), 'utf-8'));
  return text.length >= 40 ? text : null;
}

// 下载带单次重试：B站/X 对高频 IP 会临时限速，隔 5 秒重试一次能消化大部分瞬时限速。
async function execWithRetry(cmd, args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await pexec(cmd, args, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('未安装 yt-dlp（brew install yt-dlp），无法下载视频音轨');
      if (attempt >= 1) {
        const reason = err.killed
          ? '下载超时（可能被平台临时限速，稍后再试）'
          : (err.stderr || err.message || '').toString().trim().slice(0, 120);
        throw new Error(`音频下载失败：${reason}`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// yt-dlp 下音轨。转写只吃人声，whisper 内部还会重采样到 16kHz 单声道，**码率越低越好**：
// 2026-08-12 实测一条 60 分钟的 X 视频，bestaudio 挑到 128k（55MB，HLS 逐段下），5 分钟超时
// 拉不完；同一条的 32k 音轨只有 13.7MB，转写质量没差别。所以按码率从低到高挑：
// 64k 以内优先 → 退 bestaudio → 最后才 best（X 有些是音画合流 mp4，没有独立音轨）。
// 顺带 -N 8 并发拉 HLS 分片：m3u8 是几百个小段，串行下载才是长视频真正的瓶颈。
// 副作用是文件更小，Groq 免费档 25MB 上限也更难撞到。
async function downloadAudio(workDir) {
  const [cmd, pre] = await ytdlp();
  await execWithRetry(cmd, [
    ...pre, '-f', 'bestaudio[abr<=64]/bestaudio/best', '-N', '8',
    '-o', join(workDir, 'audio.%(ext)s'),
    '--no-playlist', ...proxyArgs(), url,
  ]);
  const files = await readdir(workDir, { recursive: true });
  const audio = files.find(f => /\.(m4a|webm|mp3|wav|opus|mp4)$/i.test(f));
  if (!audio) throw new Error('音频下载完成但未找到音频文件');
  return join(workDir, audio);
}

// Groq 云转写：curl 上传 multipart（天然走代理环境变量），verbose_json 拿分段。
// 免费档单文件上限 25MB（bestaudio 约 1MB/分钟，够短视频/中短播客）；超限直接抛，走本地。
async function transcribeViaGroq(audioFile) {
  const { stat } = await import('fs/promises');
  const size = (await stat(audioFile)).size;
  if (size > 24 * 1024 * 1024) {
    throw new Error(`音频 ${(size / 1048576).toFixed(0)}MB 超过 Groq 免费档上限（25MB）`);
  }
  const { stdout } = await pexec('curl', [
    '-sS', '--max-time', '120',
    'https://api.groq.com/openai/v1/audio/transcriptions',
    '-H', `Authorization: Bearer ${process.env.GROQ_API_KEY}`,
    '-F', 'model=whisper-large-v3-turbo',
    '-F', 'response_format=verbose_json',
    '-F', `file=@${audioFile}`,
  ], { maxBuffer: 32 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error).slice(0, 150));
  if (!data.text || data.text.trim().length < 20) {
    throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
  }
  return {
    text: data.text.trim(),
    language: data.language || null,
    truncated: false, // Groq 整文件转写，无本地管道的 maxSeconds 截断
    engine: 'groq',
  };
}

// 本地 whisper 兜底：scripts/transcribe.py（faster-whisper，零 API 费、不出本机）
async function transcribeLocal(audioFile, maxSeconds) {
  const timeout = Math.max(TRANSCRIBE_TIMEOUT, Math.ceil(maxSeconds / 60) * 60000);
  const { stdout } = await pexec('python3', [
    join(__dirname, 'transcribe.py'), audioFile, '--max-seconds', String(maxSeconds),
  ], { timeout, maxBuffer: 64 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.error) throw new Error(result.error);
  if (!result.text || result.text.length < 20) {
    throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
  }
  return { text: result.text, language: result.language || null, truncated: !!result.truncated, engine: 'local' };
}

async function runTranscriber(audioFile, maxSeconds) {
  // Groq 云优先（快、近乎免费），失败/超限/无 key → 本地 whisper 兜底，渐进增强不硬依赖。
  if (process.env.GROQ_API_KEY) {
    try {
      return await transcribeViaGroq(audioFile);
    } catch (err) {
      process.stderr.write(`[asr] Groq 云转写失败（${(err.message || '').slice(0, 150)}），降级本地 whisper\n`);
    }
  }
  return await transcribeLocal(audioFile, maxSeconds);
}

const workDir = join(tmpdir(), 'watch-anything', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
await mkdir(workDir, { recursive: true });
try {
  const captions = await fetchCaptions(workDir).catch(() => null);
  if (captions) {
    console.log(JSON.stringify({ ok: true, text: captions, source: 'captions', truncated: false, language: null }));
  } else {
    const audioFile = await downloadAudio(workDir);
    const maxSeconds = full ? FULL_AUDIO_SECONDS : MAX_AUDIO_SECONDS;
    const asr = await runTranscriber(audioFile, maxSeconds);
    console.log(JSON.stringify({ ok: true, source: 'asr', ...asr }));
  }
} catch (err) {
  const reason = (err.stderr || err.message || '').toString().trim().slice(0, 400);
  console.log(JSON.stringify({ ok: false, error: reason }));
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
