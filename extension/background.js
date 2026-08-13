// 扩展只干一件事：把当前标签页的链接 POST 进本机队列，然后立刻还你注意力。
//
// 为什么这么小：解读需要 yt-dlp 下音轨、whisper 转写，浏览器沙箱里跑不了。
// 所以这里不做解读、不做侧栏、不做渲染 —— 那些都在本机的 agent 那边。
// 这个扩展存在的唯一理由是「不打断你正在看的东西」。

const PORT = 7391;                       // 与 queue-server 的 WA_QUEUE_PORT 保持一致
const ENDPOINT = `http://127.0.0.1:${PORT}/queue`;

// 页面右上角飘一条 1.8 秒的提示。
// 为什么需要它：只有工具栏角标的话，人根本看不出自己点没点上——第一次真机测试就是这么翻车的。
// 但也只做到这一步：不插按钮、不开侧栏、不暂停视频、鼠标穿透，2 秒后自己消失得干干净净。
// 只在你点击的那一刻注入（activeTab 授权），不常驻。
function toast(tabId, text, bg) {
  chrome.scripting.executeScript({
    target: { tabId },
    args: [text, bg],
    func: (text, bg) => {
      const el = document.createElement('div');
      el.textContent = text;
      Object.assign(el.style, {
        position: 'fixed', top: '18px', right: '18px', zIndex: '2147483647',
        padding: '10px 16px', borderRadius: '10px', background: bg, color: '#fff',
        font: '500 14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,.28)', pointerEvents: 'none',
        opacity: '0', transition: 'opacity .18s ease',
      });
      document.documentElement.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 1800);
    },
  }).catch(() => { /* 有些页面（商店页、PDF 阅读器）注入不了，角标兜底，不报错打扰人 */ });
}

// 角标：给页面提示做备份，也让人回头还能看见状态。2 秒后自己消失。
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
    if (data.duplicate) {
      flash(tab.id, '=', '#F5A623', '已经在队列里了');
      toast(tab.id, '这条已经在待读队列里了', '#B26A00');
    } else {
      flash(tab.id, '✓', '#1DB954', `已入队，待读 ${data.pending} 条`);
      toast(tab.id, `✓ 已加入待读队列 · 待读 ${data.pending} 条`, '#111');
    }
  } catch (err) {
    // 最常见的失败就是队列服务没起 —— 直说，别让人对着一个红点猜
    flash(tab.id, '!', '#E5484D',
      `没连上本机队列（127.0.0.1:${PORT}）。先跑：node scripts/queue-server.mjs`);
    toast(tab.id, `没连上本机队列（127.0.0.1:${PORT}）—— 先跑 queue-server`, '#C62828');
    console.error('[watch-anything]', err);
  }
});
