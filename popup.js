// popup.js — 纯本地采集，无 AI，结果存 chrome.storage.local

let posts = [];       // 当前已采集的全部帖子
let display = [];     // 筛选后展示的帖子
let currentUrl = '';
let geminiFilter = null;  // Gemini 过滤器实例

const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['maxPosts', 'scrollTimes', 'aiEnabled', 'apiKey', 'filterType', 'confidenceThreshold']);
  if (stored.maxPosts)    $('max-posts').value    = stored.maxPosts;
  if (stored.scrollTimes !== undefined) $('scroll-times').value = stored.scrollTimes;
  if (stored.aiEnabled)   $('ai-enable').checked = stored.aiEnabled;
  if (stored.apiKey)      $('api-key').value = stored.apiKey;
  if (stored.filterType)  $('filter-type-input').value = stored.filterType;
  if (stored.confidenceThreshold) $('confidence-threshold').value = stored.confidenceThreshold;

  // AI 设置事件监听
  setupAISettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFb = tab && /facebook\.com\/groups\//.test(tab.url);

  if (!isFb) {
    $('main').style.display  = 'none';
    $('notfb').style.display = 'block';
    return;
  }

  $('main').style.display  = 'flex';
  $('notfb').style.display = 'none';
  currentUrl = tab.url;

  if (tab.title) {
    $('gname').textContent = tab.title.replace(/\s*[-|].*Facebook.*$/i, '').trim().slice(0, 45);
  }

  // 载入该页面的缓存帖子
  const key = cacheKey(tab.url);
  const cache = await chrome.storage.local.get(key);
  if (cache[key]) {
    posts = cache[key];
    display = [...posts];
    render(display);
    setStatus('success', `已载入 ${posts.length} 条缓存帖子`);
    $('append-btn').disabled = false;
    $('export-bar').classList.add('on');
  }
});

// ── AI 设置 ────────────────────────────────────────────────────────────────
async function setupAISettings() {
  const aiEnable = $('ai-enable');
  const aiOptions = $('ai-options');
  const apiKey = $('api-key');
    const filterInput = $('filter-type-input');
    const filterHistoryList = $('filter-history');
  const confidence = $('confidence-threshold');

  // 切换 AI 开关
  aiEnable.addEventListener('change', async (e) => {
    if (e.target.checked && !apiKey.value.trim()) {
      setStatus('error', '请先输入 Gemini API 密钥');
      e.target.checked = false;
      return;
    }
    aiOptions.classList.toggle('active', e.target.checked);
    await chrome.storage.local.set({ aiEnabled: e.target.checked });
  });

  // 保存 API 密钥
  apiKey.addEventListener('change', async (e) => {
    const key = e.target.value.trim();
    await chrome.storage.local.set({ apiKey: key });
    if (key) {
      geminiFilter = new GeminiPostFilter(key);
      validateApiKey();
    }
  });

    // 保存过滤类型（用户自定义，保存历史）
    filterInput.addEventListener('change', async (e) => {
      const v = (e.target.value || '').trim();
      if (!v) return;
      // save as current filter
      await chrome.storage.local.set({ filterType: v });

      // update history
      const sto = await chrome.storage.local.get(['filterTypeHistory']);
      let history = Array.isArray(sto.filterTypeHistory) ? sto.filterTypeHistory : [];
      // remove duplicates
      history = history.filter(h => h !== v);
      history.unshift(v);
      // limit history length
      if (history.length > 10) history = history.slice(0, 10);
      await chrome.storage.local.set({ filterTypeHistory: history });
      // refresh datalist
      renderFilterHistory(history);
  });

  // 保存置信度
  confidence.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ confidenceThreshold: parseFloat(e.target.value) });
  });

  // 初始化 AI 选项显示
  if (aiEnable.checked) {
    aiOptions.classList.add('active');
    if (apiKey.value) {
      geminiFilter = new GeminiPostFilter(apiKey.value);
    }
  }
  
    // 载入历史过滤项
    const initSto = await chrome.storage.local.get(['filterTypeHistory', 'filterType']);
    const initHistory = Array.isArray(initSto.filterTypeHistory) ? initSto.filterTypeHistory : [];
    renderFilterHistory(initHistory);
    if (initSto.filterType) filterInput.value = initSto.filterType;
}

  function renderFilterHistory(history) {
    const el = document.getElementById('filter-history');
    if (!el) return;
    el.innerHTML = history.map(h => `<option value="${esc(h)}">`).join('');
  }
// 验证 API 密钥
async function validateApiKey() {
  const status = $('api-status');
  const apiKey = $('api-key');
  const key = apiKey.value.trim();

  if (!key) {
    status.textContent = '';
    return;
  }

  status.textContent = '验证中...';
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      }
    );

    if (response.ok) {
      status.className = 'api-status valid';
      status.textContent = 'API 密钥有效';
      geminiFilter = new GeminiPostFilter(key);
    } else {
      status.className = 'api-status invalid';
      status.textContent = 'API 密钥无效或超出配额';
    }
  } catch (error) {
    status.className = 'api-status invalid';
    status.textContent = '网络错误：' + error.message;
  }
}

// 应用 AI 过滤
async function applyAIFilter(postsToFilter) {
  if (!$('ai-enable').checked || !geminiFilter) return postsToFilter;

  const filterType = ($('filter-type-input').value || '').trim();
  const threshold = parseFloat($('confidence-threshold').value) || 0.7;

  try {
    setStatus('loading', `正在用 AI 分析 ${postsToFilter.length} 条帖子...`);
    const filtered = await geminiFilter.filterPosts(postsToFilter, filterType, threshold);
    setStatus('success', `AI 过滤完成：${filtered.length} 条符合条件的帖子`);
    return filtered;
  } catch (error) {
    setStatus('error', 'AI 过滤失败：' + error.message);
    return postsToFilter;
  }
}


// ── 采集（清空后重新抓） ──────────────────────────────────────────────────────
$('scrape-btn').addEventListener('click', () => runScrape(false));

// ── 追加（保留已有，继续滚动抓新帖） ─────────────────────────────────────────
$('append-btn').addEventListener('click', () => runScrape(true));

async function runScrape(append) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const maxPosts    = parseInt($('max-posts').value, 10)    || 50;
  const scrollTimes = parseInt($('scroll-times').value, 10) || 0;

  await chrome.storage.local.set({ maxPosts, scrollTimes });

  $('scrape-btn').disabled  = true;
  $('append-btn').disabled  = true;
  $('clear-btn').disabled   = true;

  try {
    // 注入 content script（已注入则 ping 通过）
    try {
      await msg(tab.id, { action: 'ping' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await sleep(400);
    }

    // 自动滚动
    if (scrollTimes > 0) {
      setStatus('loading', `自动滚动 ${scrollTimes} 次，加载更多帖子...`);
      await msg(tab.id, { action: 'autoScroll', times: scrollTimes });
    }

    setStatus('loading', '提取帖子内容...');
    const result = await msg(tab.id, { action: 'scrape', options: { maxPosts } });
    let fresh = result.posts || [];

    // 应用 AI 过滤
    if ($('ai-enable').checked && geminiFilter) {
      fresh = await applyAIFilter(fresh);
    }

    if (append && posts.length > 0) {
      // 去重合并：用 author+内容前50字 作 key
      const existing = new Set(posts.map(dedup));
      const newOnes  = fresh.filter(p => !existing.has(dedup(p)));
      posts = [...posts, ...newOnes];
      setStatus('success', `追加 ${newOnes.length} 条新帖，共 ${posts.length} 条`);
    } else {
      posts = fresh;
      setStatus('success', `采集完成：${posts.length} 条帖子`);
    }

    // 存入 chrome.storage.local
    const key = cacheKey(tab.url);
    await chrome.storage.local.set({ [key]: posts });

    display = [...posts];
    render(display);
    $('append-btn').disabled = posts.length === 0;
    if (posts.length > 0) $('export-bar').classList.add('on');

  } catch (err) {
    setStatus('error', '采集失败：' + (err.message || '未知错误'));
  } finally {
    $('scrape-btn').disabled = false;
    $('clear-btn').disabled  = false;
  }
}

// ── 清空 ──────────────────────────────────────────────────────────────────────
$('clear-btn').addEventListener('click', async () => {
  posts   = [];
  display = [];
  const key = cacheKey(currentUrl);
  await chrome.storage.local.remove(key);
  render([]);
  $('export-bar').classList.remove('on');
  $('append-btn').disabled = true;
  setStatus('idle', '已清空，点击「采集帖子」重新开始');
});

// ── 导出 ──────────────────────────────────────────────────────────────────────
$('exp-json').addEventListener('click', () => {
  dl(new Blob([JSON.stringify(posts, null, 2)], { type: 'application/json' }), 'fb_posts.json');
});

$('exp-csv').addEventListener('click', () => {
  const headers = ['作者', '时间', '正文', '点赞', '评论', '分享', '图片数', '链接'];
  const rows = posts.map(p => [
    p.author,
    p.time,
    (p.content || '').replace(/"/g, '""').replace(/\n/g, ' '),
    p.likes || 0,
    p.comments || 0,
    p.shares || 0,
    (p.images || []).length,
    p.permalink || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  dl(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), 'fb_posts.csv');
});

$('exp-txt').addEventListener('click', () => {
  const txt = posts.map((p, i) => [
    `【${i + 1}】 ${p.author}    ${p.time}`,
    p.content,
    `👍 ${p.likes || 0}  💬 ${p.comments || 0}  🔁 ${p.shares || 0}`,
    p.permalink ? `🔗 ${p.permalink}` : '',
  ].filter(Boolean).join('\n')).join('\n\n' + '─'.repeat(40) + '\n\n');
  dl(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'fb_posts.txt');
});

// ── 渲染列表 ──────────────────────────────────────────────────────────────────
function render(list) {
  const el = $('results');

  if (!list || list.length === 0) {
    el.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
      采集后的帖子将显示在这里
    </div>`;
    return;
  }

  const totalLikes    = list.reduce((a, p) => a + (p.likes    || 0), 0);
  const totalComments = list.reduce((a, p) => a + (p.comments || 0), 0);
  const totalShares   = list.reduce((a, p) => a + (p.shares   || 0), 0);

  let html = `
    <div class="summary">
      <div class="metric"><div class="mval">${list.length}</div><div class="mlbl">帖子</div></div>
      <div class="metric"><div class="mval">${fmt(totalLikes)}</div><div class="mlbl">点赞</div></div>
      <div class="metric"><div class="mval">${fmt(totalComments)}</div><div class="mlbl">评论</div></div>
      <div class="metric"><div class="mval">${fmt(totalShares)}</div><div class="mlbl">分享</div></div>
    </div>
    <div class="frow">
      <input type="text" id="kw" placeholder="搜索作者或内容..." oninput="filter()">
    </div>`;

  list.forEach((p, i) => {
    const init = (p.author || '?').replace(/\s+/g, '').slice(0, 2).toUpperCase();
    const preview = (p.content || '').slice(0, 100);
    const hasLink = !!p.permalink;
    const aiTag = p.aiFilter ? `<span class="stat" title="AI 置信度: ${(p.aiFilter.confidence * 100).toFixed(0)}%">🤖 ${(p.aiFilter.confidence * 100).toFixed(0)}%</span>` : '';

    html += `<div class="post" onclick="openLink(${i})">
      <div class="phead">
        <div class="avatar">${esc(init)}</div>
        <span class="pauthor">${esc(p.author || '未知')}</span>
        <span class="ptime">${esc(p.time || '')}</span>
      </div>
      <div class="pbody">${esc(preview)}${(p.content || '').length > 100 ? '…' : ''}</div>
      <div class="pfoot">
        <span class="stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>
          ${p.likes || 0}
        </span>
        <span class="stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${p.comments || 0}
        </span>
        <span class="stat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          ${p.shares || 0}
        </span>
        ${p.images && p.images.length ? `<span class="stat">🖼 ${p.images.length}</span>` : ''}
        ${aiTag}
        ${hasLink ? `<span class="permalink" onclick="event.stopPropagation();openLink(${i})">跳转 ↗</span>` : ''}
      </div>
    </div>`;
  });

  el.innerHTML = html;
}

// ── 搜索筛选 ──────────────────────────────────────────────────────────────────
window.filter = function () {
  const kw = (($('kw') || {}).value || '').toLowerCase();
  display = posts.filter(p =>
    !kw ||
    (p.author  || '').toLowerCase().includes(kw) ||
    (p.content || '').toLowerCase().includes(kw)
  );
  render(display);
  if ($('kw')) $('kw').value = kw;
};

// ── 跳转帖子 ──────────────────────────────────────────────────────────────────
window.openLink = function (i) {
  const p = display[i];
  if (p && p.permalink) chrome.tabs.create({ url: p.permalink });
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function cacheKey(url) {
  // 用 group URL 作为 storage key（截断查询参数）
  return 'posts:' + (url || '').split('?')[0].replace(/\/$/, '');
}

function dedup(p) {
  return ((p.author || '') + (p.content || '').slice(0, 50)).replace(/\s/g, '');
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setStatus(kind, text) {
  const el = $('status');
  el.className = 'status ' + kind;
  if (kind === 'loading') {
    el.innerHTML = `<div class="dots"><span></span><span></span><span></span></div><span>${esc(text)}</span>`;
  } else {
    const ico = {
      idle:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>',
      success: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
      error:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9 9 15M9 9l6 6"/></svg>',
      warn:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
    };
    el.innerHTML = (ico[kind] || '') + `<span>${esc(text)}</span>`;
  }
}

function msg(tabId, data) {
  return new Promise((res, rej) => {
    chrome.tabs.sendMessage(tabId, data, r => {
      chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r);
    });
  });
}

function dl(blob, name) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: name, saveAs: true });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
