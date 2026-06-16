// content.js — 注入到 Facebook Group 页面，负责 DOM 抓取

(function () {
  // 防止重复注入
  if (window.__fbScraperInjected) return;
  window.__fbScraperInjected = true;

  // ── 消息监听 ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === 'scrape') {
      const result = scrapePosts(msg.options || {});
      sendResponse(result);
      return;
    }
    if (msg.action === 'autoScroll') {
      autoScroll(msg.times || 3, sendResponse);
      return true; // 异步
    }
  });

  // ── 核心抓取函数 ──────────────────────────────────────
  function scrapePosts({ maxPosts = 50 } = {}) {
    const posts = [];
    const seen = new Set();

    // Facebook 帖子容器选择器（多种布局兼容）
    const feedItems = document.querySelectorAll([
      '[data-pagelet^="FeedUnit"]',
      '[data-pagelet="GroupFeed"] > div > div',
      'div[role="feed"] > div',
    ].join(','));

    feedItems.forEach((item) => {
      if (posts.length >= maxPosts) return;

      try {
        const post = extractPost(item);
        if (!post || !post.content) return;

        // 去重（用内容前40字）
        const key = (post.author + post.content.slice(0, 40)).replace(/\s/g, '');
        if (seen.has(key)) return;
        seen.add(key);

        posts.push(post);
      } catch (_) {
        // 跳过解析失败的单元
      }
    });

    return {
      posts,
      total: posts.length,
      url: location.href,
      groupName: getGroupName(),
      scrapedAt: new Date().toISOString(),
    };
  }

  function extractPost(el) {
    // ── 作者 ──
    let author = '';
    const authorEl =
      el.querySelector('h2 a[role="link"]') ||
      el.querySelector('a[aria-label]') ||
      el.querySelector('strong a') ||
      el.querySelector('span[dir="auto"] a');
    if (authorEl) author = authorEl.innerText.trim();

    // ── 时间 ──
    let time = '';
    const timeEl =
      el.querySelector('a[href*="permalink"] span') ||
      el.querySelector('abbr[data-utime]') ||
      el.querySelector('span[id*="jsc"] a span') ||
      el.querySelector('a[aria-label*="ago"]') ||
      el.querySelector('a[aria-label*="前"]');
    if (timeEl) {
      time =
        timeEl.getAttribute('aria-label') ||
        timeEl.getAttribute('title') ||
        timeEl.innerText.trim();
    }

    // ── 正文 ──
    let content = '';
    const contentCandidates = [
      el.querySelector('[data-ad-comet-preview="message"]'),
      el.querySelector('[data-ad-preview="message"]'),
      el.querySelector('div[dir="auto"][style*="text-align"]'),
      el.querySelector('div[data-testid="post_message"]'),
      el.querySelector('div[class*="userContent"]'),
    ].filter(Boolean);

    if (contentCandidates.length) {
      content = contentCandidates[0].innerText.trim();
    } else {
      // fallback：取最长的 dir=auto 文本块
      let maxLen = 0;
      el.querySelectorAll('div[dir="auto"]').forEach((d) => {
        const t = d.innerText.trim();
        if (t.length > maxLen && t.length > 20) {
          maxLen = t.length;
          content = t;
        }
      });
    }

    if (!content || content.length < 5) return null;

    // ── 互动数 ──
    const statsText = el.innerText;
    const likes = parseCount(statsText, /(\d[\d,.]*)\s*(个?人?(赞|Likes?|reactions?|❤|👍))/i) ||
                  parseCount(statsText, /(赞|Likes?)\s*(\d[\d,.]*)/i, 2);
    const comments = parseCount(statsText, /(\d[\d,.]*)\s*(条?评论|Comments?)/i) ||
                     parseCount(statsText, /(评论|Comments?)\s*(\d[\d,.]*)/i, 2);
    const shares = parseCount(statsText, /(\d[\d,.]*)\s*(次?分享|Shares?)/i) ||
                   parseCount(statsText, /(分享|Shares?)\s*(\d[\d,.]*)/i, 2);

    // ── 图片 ──
    const images = [];
    el.querySelectorAll('img[src*="scontent"]').forEach((img) => {
      const src = img.src;
      if (src && !images.includes(src) && img.naturalWidth > 100) {
        images.push(src);
      }
    });

    // ── 帖子链接 ──
    let permalink = '';
    const linkEl = el.querySelector('a[href*="/posts/"], a[href*="permalink"], a[href*="?story_fbid"]');
    if (linkEl) permalink = linkEl.href;

    return {
      author,
      time,
      content,
      likes: likes || 0,
      comments: comments || 0,
      shares: shares || 0,
      images: images.slice(0, 4),
      permalink,
      rawLength: content.length,
    };
  }

  function parseCount(text, regex, group = 1) {
    const m = text.match(regex);
    if (!m) return 0;
    const raw = m[group].replace(/[,，]/g, '');
    return parseInt(raw, 10) || 0;
  }

  function getGroupName() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.innerText.trim() : document.title.replace(/- Facebook.*/, '').trim();
  }

  // ── 自动滚动（加载更多帖子）──────────────────────────
  function autoScroll(times, callback) {
    let count = 0;
    const interval = setInterval(() => {
      window.scrollBy(0, window.innerHeight * 1.8);
      count++;
      if (count >= times) {
        clearInterval(interval);
        // 等待内容渲染
        setTimeout(() => callback({ done: true }), 1800);
      }
    }, 1200);
  }
})();
