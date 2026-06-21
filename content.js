// content.js

(function () {
  if (window.__fbScraperInjected) return;
  window.__fbScraperInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') { sendResponse({ ok: true }); return; }
    if (msg.action === 'scrape') { sendResponse(scrapePosts(msg.options || {})); return; }
    if (msg.action === 'autoScroll') { autoScroll(msg.times || 3, sendResponse); return true; }
  });

  // ── 找时间元素（新选择器）────────────────────────────
  function findTimeEl(el) {
    // Facebook Group 帖子的时间链接：href 含 /posts/ 或 permalink，aria-label 是时间文字
    return (
      el.querySelector('a[href*="/posts/"][aria-label]') ||
      el.querySelector('a[href*="permalink"][aria-label]') ||
      el.querySelector('a[href*="story_fbid"][aria-label]') ||
      el.querySelector('abbr[data-utime]') ||
      el.querySelector('a[href*="permalink"] span') ||
      el.querySelector('a[aria-label*="ago"]') ||
      el.querySelector('a[aria-label*="前"]')
    );
  }

  // ── 判断是否在三天内 ──────────────────────────────────
  function isWithinThreeDays(timeEl) {
    if (!timeEl) return false;

    // data-utime（Unix 秒）
    const utime = timeEl.getAttribute('data-utime');
    if (utime) {
      return (Date.now() - parseInt(utime, 10) * 1000) <= 3 * 24 * 60 * 60 * 1000;
    }

    const label = (
      timeEl.getAttribute('aria-label') ||
      timeEl.getAttribute('title') ||
      timeEl.innerText || ''
    ).trim();

    if (!label) return false;
    return parseTimeLabel(label);
  }

  function parseTimeLabel(label) {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // ── 纯数字+单位（无"前"字）：如 "5小时" "1天" "3天" ──
    const cnShort = label.match(/^(\d+)\s*(分钟|小时|天)$/);
    if (cnShort) {
      const val = parseInt(cnShort[1], 10);
      const unit = cnShort[2];
      let ms = 0;
      if (unit === '分钟') ms = val * 60 * 1000;
      else if (unit === '小时') ms = val * 60 * 60 * 1000;
      else if (unit === '天')   ms = val * 24 * 60 * 60 * 1000;
      return ms <= THREE_DAYS_MS;
    }

    // ── 带"前"的相对时间：如 "3天前" "5小时前" ──
    const cnFull = label.match(/(\d+)\s*(分钟|小时|天)前/);
    if (cnFull) {
      const val = parseInt(cnFull[1], 10);
      const unit = cnFull[2];
      let ms = 0;
      if (unit === '分钟') ms = val * 60 * 1000;
      else if (unit === '小时') ms = val * 60 * 60 * 1000;
      else if (unit === '天')   ms = val * 24 * 60 * 60 * 1000;
      return ms <= THREE_DAYS_MS;
    }

    // ── 刚刚 / just now ──
    if (/^(刚刚|just now|a few seconds?)$/i.test(label)) return true;

    // ── 英文相对时间：如 "2 hours ago" "1 day ago" ──
    const enRel = label.match(/(\d+)\s*(minute|hour|day|min|hr)/i);
    if (enRel) {
      const val = parseInt(enRel[1], 10);
      const unit = enRel[2].toLowerCase();
      let ms = 0;
      if (unit.startsWith('min')) ms = val * 60 * 1000;
      else if (unit.startsWith('h'))  ms = val * 60 * 60 * 1000;
      else if (unit.startsWith('d'))  ms = val * 24 * 60 * 60 * 1000;
      return ms <= THREE_DAYS_MS;
    }

    // ── 绝对日期：如 "6月12日10:16" ──
    const cnDate = label.match(/(\d{1,2})月(\d{1,2})日/);
    if (cnDate) {
      const year = new Date().getFullYear();
      const d = new Date(year, parseInt(cnDate[1], 10) - 1, parseInt(cnDate[2], 10));
      return (now - d.getTime()) <= THREE_DAYS_MS;
    }

    // ── 年份绝对日期：如 "2025年9月5日"（肯定超三天）──
    if (/\d{4}年/.test(label)) {
      const m = label.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
        return (now - d.getTime()) <= THREE_DAYS_MS;
      }
      return false;
    }

    // ── new Date() 兜底（英文绝对日期）──
    const parsed = new Date(label);
    if (!isNaN(parsed.getTime())) {
      return (now - parsed.getTime()) <= THREE_DAYS_MS;
    }

    // 实在解析不了：放行，不丢数据
    return true;
  }

  // ── 核心抓取 ──────────────────────────────────────────
  function scrapePosts({ maxPosts = 50 } = {}) {
    const posts = [];
    const seen = new Set();

    const feedItems = document.querySelectorAll([
      '[data-pagelet^="FeedUnit"]',
      '[data-pagelet="GroupFeed"] > div > div',
      'div[role="feed"] > div',
    ].join(','));

    feedItems.forEach((item) => {
      if (posts.length >= maxPosts) return;
      try {
        const timeEl = findTimeEl(item);
        if (!isWithinThreeDays(timeEl)) return;

        const post = extractPost(item, timeEl);
        if (!post || !post.content) return;
        if (isFilteredPost(post.content)) return;

        const key = (post.author + post.content.slice(0, 40)).replace(/\s/g, '');
        if (seen.has(key)) return;
        seen.add(key);

        posts.push(post);
      } catch (_) {}
    });

    return {
      posts,
      total: posts.length,
      url: location.href,
      groupName: getGroupName(),
      scrapedAt: new Date().toISOString(),
    };
  }

  function extractPost(el, timeEl) {
    let author = '';
    const authorEl =
      el.querySelector('h2 a[role="link"]') ||
      el.querySelector('a[aria-label]') ||
      el.querySelector('strong a') ||
      el.querySelector('span[dir="auto"] a');
    if (authorEl) author = authorEl.innerText.trim();

    let time = '';
    if (timeEl) {
      time =
        timeEl.getAttribute('aria-label') ||
        timeEl.getAttribute('title') ||
        timeEl.innerText.trim();
    }

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
      let maxLen = 0;
      el.querySelectorAll('div[dir="auto"]').forEach((d) => {
        const t = d.innerText.trim();
        if (t.length > maxLen && t.length > 20) { maxLen = t.length; content = t; }
      });
    }

    if (!content || content.length < 5) return null;
    if (isFilteredPost(content)) return null;

    const statsText = el.innerText;
    const likes    = parseCount(statsText, /(\d[\d,.]*)\s*(个?人?(赞|Likes?|reactions?|❤|👍))/i) ||
                     parseCount(statsText, /(赞|Likes?)\s*(\d[\d,.]*)/i, 2);
    const comments = parseCount(statsText, /(\d[\d,.]*)\s*(条?评论|Comments?)/i) ||
                     parseCount(statsText, /(评论|Comments?)\s*(\d[\d,.]*)/i, 2);
    const shares   = parseCount(statsText, /(\d[\d,.]*)\s*(次?分享|Shares?)/i) ||
                     parseCount(statsText, /(分享|Shares?)\s*(\d[\d,.]*)/i, 2);

    const images = [];
    el.querySelectorAll('img[src*="scontent"]').forEach((img) => {
      if (img.src && !images.includes(img.src) && img.naturalWidth > 100) images.push(img.src);
    });

    let permalink = '';
    const linkEl = el.querySelector('a[href*="/posts/"], a[href*="permalink"], a[href*="?story_fbid"]');
    if (linkEl) permalink = linkEl.href;

    return { author, time, content, likes: likes || 0, comments: comments || 0,
             shares: shares || 0, images: images.slice(0, 4), permalink, rawLength: content.length };
  }

  function parseCount(text, regex, group = 1) {
    const m = text.match(regex);
    if (!m) return 0;
    return parseInt(m[group].replace(/[,，]/g, ''), 10) || 0;
  }

  function isFilteredPost(content) {
    const banned = Array.isArray(window.FB_SCRAPER_FILTER_KEYWORDS)
      ? window.FB_SCRAPER_FILTER_KEYWORDS
      : (typeof FB_SCRAPER_FILTER_KEYWORDS !== 'undefined' && Array.isArray(FB_SCRAPER_FILTER_KEYWORDS)
          ? FB_SCRAPER_FILTER_KEYWORDS
          : []);
    const normalized = content.toLowerCase();
    return banned.some((word) => typeof word === 'string' && normalized.includes(word.toLowerCase()));
  }

  function getGroupName() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.innerText.trim() : document.title.replace(/- Facebook.*/, '').trim();
  }

  function autoScroll(times, callback) {
    let count = 0;
    const interval = setInterval(() => {
      window.scrollBy(0, window.innerHeight * 1.8);
      count++;
      if (count >= times) {
        clearInterval(interval);
        setTimeout(() => callback({ done: true }), 1800);
      }
    }, 1200);
  }
})();