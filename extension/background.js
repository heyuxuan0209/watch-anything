// 扩展只干一件事：把当前标签页的链接 POST 进本机队列，然后立刻还你注意力。
//
// 为什么这么小：解读需要 yt-dlp 下音轨、whisper 转写，浏览器沙箱里跑不了。
// 所以这里不做解读、不做侧栏、不做渲染 —— 那些都在本机的 agent 那边。
// 这个扩展存在的唯一理由是「不打断你正在看的东西」。

const PORT = 7391;                       // 与 queue-server 的 WA_QUEUE_PORT 保持一致
const ENDPOINT = `http://127.0.0.1:${PORT}/queue`;

// 角标是唯一的反馈渠道 —— 不弹窗、不跳转、不抢焦点。2 秒后自己消失。
function flash(tabId, text, color, title) {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  if (title) chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setTitle({ title: '丢进待读队列（watch-anything）', tabId });
  }, 2500);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    return flash(tab?.id, '—', '#9AA0A6', '这个页面没有可用链接');
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url, title: tab.title || '' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '队列拒绝了这条链接');
    // 重复入队不算失败，但要让人看出区别 —— 否则连点两下会以为没生效
    flash(tab.id, data.duplicate ? '=' : '✓', data.duplicate ? '#F5A623' : '#1DB954',
      data.duplicate ? '已经在队列里了' : `已入队，待读 ${data.pending} 条`);
  } catch (err) {
    // 最常见的失败就是队列服务没起 —— 直说，别让人对着一个红点猜
    flash(tab.id, '!', '#E5484D',
      `没连上本机队列（127.0.0.1:${PORT}）。先跑：node scripts/queue-server.mjs`);
    console.error('[watch-anything]', err);
  }
});
