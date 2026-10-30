/**
 * WB 页面结构探测脚本
 * 用法：node scripts/probe.js [关键词]
 * 目的：实测 Wildberries 搜索页/商品卡的真实 DOM，
 *      为 wbCollector._parseCards 提供准确选择器（避免硬编码猜测）。
 *
 * 前置：用带调试端口的 Chrome 打开任意 wildberries.ru 页面：
 *   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug-profile" https://www.wildberries.ru
 */
const { WbMarketApiClient } = require('../src/collector/wbCollector');

const keyword = process.argv[2] || 'когтеточка';

async function main() {
  const client = new WbMarketApiClient({});
  if (!client.isAvailable()) {
    console.log('❌ playwright 未安装。请 npm install && npx playwright install chromium');
    process.exit(1);
  }
  await client._ensureBrowser();
  const page = await client._getPage();
  page.setDefaultTimeout(20000);

  const url = client.options.searchUrl + encodeURIComponent(keyword);
  console.log('打开搜索页:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  console.log('=== 最终 URL ===');
  console.log(page.url());
  console.log('=== 页面标题 ===');
  console.log(await page.title());

  // 尝试滚动触发懒加载
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 2000).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 候选商品卡容器（WB 常用结构探针，多候选输出供回填）
  const candidates = [
    'article',
    '.product-card',
    '.product-card__wrapper',
    '.j-card-item',
    '.card-list .card',
    '.product-card-list .product-card',
    '[data-card-index]'
  ];
  for (const sel of candidates) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) console.log(`候选容器 ${sel}: ${n} 个`);
  }

  // 取第一个候选 article 的 HTML 摘要，帮助判断字段结构
  const articleCount = await page.locator('article').count().catch(() => 0);
  if (articleCount > 0) {
    const first = page.locator('article').first();
    // 纯文本（快速看清价格/评论/评分等字段值）
    const text = await first.innerText().catch(() => '');
    console.log('\n=== 首个 <article> innerText ===');
    console.log(text.slice(0, 1200));

    // 常见价格/评论选择器探针
    const fieldSelectors = {
      '价格 .price__lower-price': '.price__lower-price',
      '原价 .price__old': '.price__old',
      '价格 ins': 'ins.price',
      '评分 .product-card__rating': '.product-card__rating',
      '评论 .product-card__count': '.product-card__count',
      '品牌 .product-card__brand': '.product-card__brand',
      '卖家 .seller-info': '.seller-info',
      '评分a .j-card-item .rating': '.rating',
      '卡片文本容器 .product-card__wrapper': '.product-card__wrapper'
    };
    console.log('\n=== 字段选择器在首卡内的命中情况 ===');
    for (const [name, sel] of Object.entries(fieldSelectors)) {
      const n = await first.locator(sel).count().catch(() => 0);
      if (n > 0) {
        const t = await first.locator(sel).first().innerText().catch(() => '');
        console.log(`  ${name} (${sel}): ${n} 个 | 文本: ${t.trim().slice(0, 60)}`);
      }
    }

    const html = await first.evaluate((el) => el.outerHTML).catch(() => '');
    console.log('\n=== 首个 <article> HTML（截断 4000 字符）===');
    console.log(html.slice(0, 4000));
  } else {
    console.log('\n(未找到 <article>，页面正文标题/容器如下)');
    const body = await page.locator('body').innerText().catch(() => '');
    console.log(body.slice(0, 1500));
  }

  console.log('\n=== 完成：请把上述结构贴给开发者以回填 _parseCards ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });