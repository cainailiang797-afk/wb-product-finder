/**
 * WB 市场商品采集客户端（Playwright + CDP）
 *
 * 采集模式（借鉴 Ozon marketApiClient 的反爬方案）：
 *  1. CDP 模式（推荐）：连接用户已打开的 Chrome（默认 --remote-debugging-port=9222）
 *     Ozon 工具占 9223（独立 profile），两个 Chrome 可同时运行；可用环境变量 WB_CDP_PORT 覆盖本工具端口
 *  2. 直连模式（备用，易被反爬）
 *
 * ⚠️ 诚实声明：WB 搜索页/商品卡的 DOM 结构与字段（价格/评论/品牌/卖家）尚未实测，
 *  本文件只提供「CDP 连接 + 搜索导航 + 解析钩子」框架，
 *  具体选择器由 scripts/probe.js 实测后回填（见 _parseCards 内 TODO）。
 *  在解析器确认前，不硬编码猜测的选择器，避免采集到错误数据。
 */
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  console.warn('[WbAPI] playwright 未安装：npm install playwright && npx playwright install chromium');
}

const http = require('http');

// 约定：Chrome 一律由用户手动启动，采集器只接管已存在的调试端口，绝不自行拉起浏览器

// 🆕 药品/保健品排除正则（沿用 Ozon 工具的既定决策：不采药品）
const MEDICINE_RE = /лекарств|таблетк|капсул|витамин|антибиотик|препарат|бад\b|ветеринар|антигельминт|антипаразит|противопаразит|дегельминт|суспензи|хондропротектор|кормовая добавка|биодобавк|пробиотик|омега[- ]?3|лососевое масло|рыбий жир|инъекц|шприц|пипетк|капли|от блох|от клещ|от паразит|от гельминт/i;

class WbMarketApiClient {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 45000,
      maxProducts: options.maxProducts || 30,
      cdpPort: options.cdpPort || Number(process.env.WB_CDP_PORT) || 9222,
      cdpHost: options.cdpHost || '127.0.0.1',
      useCDP: options.useCDP !== false,
      // WB 搜索页 URL 模板（Phase 1：参数 search= 待探测确认）
      searchUrl: options.searchUrl || 'https://www.wildberries.ru/catalog/0/search.aspx?search=',
      // 排序参数：pricedown=价格从高到低（用于定向抓高客单款），默认沿用 WB 热度排序
      sort: options.sort != null ? options.sort : (process.env.WB_SORT || ''),
      // 价格区间过滤，WB 单位为「分」（120000 = ₽1200），格式 "120000;400000"
      priceU: options.priceU != null ? options.priceU : (process.env.WB_PRICE_U || ''),
      priceMin: options.priceMin != null ? options.priceMin : 150,
      priceMax: options.priceMax != null ? options.priceMax : 10000
    };
    this.browser = null;
    this._cdpConnected = false;
  }

  isAvailable() {
    return !!playwright;
  }

  _isCDPPortReachable() {
    return new Promise((resolve) => {
      const req = http.get({
        hostname: this.options.cdpHost,
        port: this.options.cdpPort,
        path: '/json/version',
        timeout: 2000
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve(!!JSON.parse(data).webSocketDebuggerUrl); }
          catch (e) { resolve(false); }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  async _ensureBrowser() {
    if (this.browser) {
      try { this.browser.contexts(); } catch (e) { this.browser = null; this._cdpConnected = false; }
    }
    if (this.browser) return;
    if (!playwright) throw new Error('playwright 未安装');

    if (this.options.useCDP) {
      if (await this._isCDPPortReachable()) {
        try {
          this.browser = await playwright.chromium.connectOverCDP(
            `http://${this.options.cdpHost}:${this.options.cdpPort}`,
            { timeout: 120000 }
          );
          this._cdpConnected = true;
          console.log('[WbAPI] ✅ CDP 连接成功，接管已打开的 Chrome');
          return;
        } catch (e) {
          console.warn('[WbAPI] CDP 连接失败:', e.message);
          this.browser = null;
          this._cdpConnected = false;
        }
      }
    }

    // 不自动启动 Chrome：调试端口不可达时直接报错，由用户手动打开浏览器后再采集
    throw new Error(
      `无法连接 Chrome 调试端口 ${this.options.cdpHost}:${this.options.cdpPort}。\n` +
      '请先手动打开 Chrome（不要用自动化脚本启动）：\n' +
      `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${this.options.cdpPort} --user-data-dir="C:\\wb-debug-profile" "https://www.wildberries.ru/"\n` +
      '打开后确认端口可用，再重新运行采集。'
    );
  }

  async _getPage() {
    if (this._cdpConnected) {
      const ctx = this.browser.contexts()[0];
      const pages = ctx.pages();
      const wbPage = pages.find((p) => p.url().includes('wildberries.ru'));
      if (wbPage) {
        try { await wbPage.bringToFront(); } catch (e) {}
        return wbPage;
      }
      return await ctx.newPage();
    }
    const ctx = await this.browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'ru-RU'
    });
    return await ctx.newPage();
  }

  /**
   * 搜索某关键词，返回商品列表
   * 解析逻辑待 probe.js 实测 WB 页面后填充
   */
  async searchProducts(keyword, limit) {
    if (!this.isAvailable()) return { success: false, error: 'playwright 未安装', products: [] };
    const maxCount = limit || this.options.maxProducts;
    console.log(`[WbAPI] 搜索关键词: "${keyword}" (目标${maxCount}个)`);

    await this._ensureBrowser();
    const page = await this._getPage();
    page.setDefaultTimeout(this.options.timeout);

    const url = this.options.searchUrl + encodeURIComponent(keyword)
      + (this.options.priceU ? `&priceU=${encodeURIComponent(this.options.priceU)}` : '')
      + (this.options.sort ? `&sort=${this.options.sort}` : '');
    // 真实市场供给量：WB 搜索页自身的内部接口（__internal/u-search）会返回该词的搜索结果总数，
    // 直接 fetch 会被 403，只能监听页面自身响应抓取（resultset=filters 那条）
    let marketSupply = 0;
    const onResponse = async (res) => {
      const u = res.url();
      if (!/\/__internal\/u-search\/exactmatch\//.test(u) || !/resultset=filters/.test(u)) return;
      try {
        const j = await res.json();
        const t = j && j.data && j.data.total;
        if (typeof t === 'number' && t > 0) marketSupply = t;
      } catch (e) { /* 忽略非 JSON 响应 */ }
    };
    page.on('response', onResponse);
    // 导航重试：ERR_ABORTED / 超时多为反爬瞬时波动，重试可恢复
    for (let attempt = 1; ; attempt++) {
      try {
        if (attempt > 1) console.log(`[WbAPI] 导航重试 ${attempt} ...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await page.waitForTimeout(3000);
      }
    }
    // 等待反爬验证/首次引导页过去（实测约 8~9 秒后才出现商品卡）
    await page.waitForTimeout(8000);

    const result = await this._parseCards(page, keyword, maxCount);
    page.off('response', onResponse);
    result.marketSupply = marketSupply;
    if (marketSupply) console.log(`[WbAPI] "${keyword}" 市场供给 ${marketSupply} 件`);
    return result;
  }

  /**
   * 解析商品卡（已按 scripts/probe.js 实测的 WB DOM 回填）
   * 字段映射（2026-10 实测）：
   *   nmID      <- article[data-nm-id] 的 data-nm-id 属性
   *   标题       <- a[href*="detail"] 的 aria-label
   *   详情URL    <- a[href*="detail"] 的 href
   *   图片       <- img 的 src
   *   现价       <- ins 标签文本（956 ₽）
   *   原价       <- del 标签文本（1 181 ₽）
   *   评分/评论  <- span 内含 «оцен» 的文本（4,9 · 9 382 оценки）
   * 注：brand/seller 暂未从卡片精确提取，留空（诚实，后续从详情页补）。
   */
  /**
   * 滚动加载更多商品卡（WB 搜索页为无限滚动/懒加载）
   * 逐屏向下滚动，直到商品卡数达到 target，或连续多轮无新增（视为到底）。
   */
  async _scrollLoad(page, target, maxRounds = 15) {
    const cardLoc = page.locator('article[data-nm-id]');
    let lastCount = -1;
    let noGainRounds = 0;
    for (let r = 0; r < maxRounds; r++) {
      const cur = await cardLoc.count().catch(() => 0);
      if (cur >= target) break;
      if (cur === lastCount) {
        noGainRounds++;
        if (noGainRounds >= 3) break; // 连续 3 轮无新增，视为到底
      } else {
        noGainRounds = 0;
      }
      lastCount = cur;
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
      await page.waitForTimeout(2000);
    }
    return await cardLoc.count().catch(() => 0);
  }

  async _parseCards(page, keyword, maxCount) {
    await page.waitForSelector('article[data-nm-id]', { timeout: 15000 }).catch(() => {});
    await this._scrollLoad(page, maxCount);
    const cardLoc = page.locator('article[data-nm-id]');
    const total = await cardLoc.count().catch(() => 0);
    if (total === 0) {
      const bodyTxt = await page.locator('body').innerText().catch(() => '');
      return { success: true, products: [], count: 0, note: '无商品卡：' + bodyTxt.slice(0, 120) };
    }

    const collectN = Math.min(total, maxCount);
    const products = [];

    const parsePrice = (t) => {
      if (!t) return 0;
      const m = t.replace(/[\s\u00A0]/g, '').match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    for (let i = 0; i < collectN; i++) {
      const info = await cardLoc.nth(i).evaluate((node) => {
        const nmId = node.getAttribute('data-nm-id');
        const link = node.querySelector('a[href*="detail"]') || node.querySelector('a.j-card-link');
        const img = node.querySelector('img');
        const insEl = node.querySelector('ins');
        const delEl = node.querySelector('del');
        const ratingSpan = [...node.querySelectorAll('span')].find((s) => /оцен/i.test(s.textContent || ''));
        return {
          nmId, title: link ? (link.getAttribute('aria-label') || '') : '',
          url: link ? link.href : '',
          imgUrl: img ? (img.getAttribute('src') || img.getAttribute('data-src-pb') || '') : '',
          insText: insEl ? insEl.textContent : '',
          delText: delEl ? delEl.textContent : '',
          ratingText: ratingSpan ? ratingSpan.textContent : ''
        };
      }).catch(() => null);
      if (!info) continue;

      let rating = 0, reviews = 0;
      if (info.ratingText) {
        // WB 有两种文案："4,9· 46 оценок" 和 "5· 11 оценок"（满分为整数，无小数点）
        // 先剥掉评价数段，避免把 11 当成评分
        const head = info.ratingText.replace(/[·•]\s*[\d\s\u00A0]+\s*оцен\S*/i, '').trim();
        const dec = head.match(/(\d+)[.,](\d+)/);
        if (dec) rating = parseFloat(dec[1] + '.' + dec[2]);
        else {
          const int = head.match(/(?:^|\s)([1-5])(?:\s|$)/);
          if (int) rating = parseFloat(int[1]);
        }
        const rc = info.ratingText.match(/([\d\s\u00A0]+)\s*оцен/i);
        if (rc) reviews = parseInt(rc[1].replace(/[\s\u00A0]/g, ''), 10) || 0;
      }

      // 药品/保健品排除（沿用既定决策）
      if (MEDICINE_RE.test(info.title)) continue;

      products.push({
        nmId: parseInt(info.nmId, 10) || 0,
        title: info.title,
        url: info.url,
        image: info.imgUrl,
        price: parsePrice(info.insText),
        oldPrice: parsePrice(info.delText),
        rating,
        reviews,
        brand: '',
        seller: ''
      });
    }

    return { success: true, products, count: products.length };
  }
}

module.exports = { WbMarketApiClient, MEDICINE_RE };