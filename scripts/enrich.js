/**
 * WB 详情页批量补全脚本：抓取 brand（品牌）+ seller_name（卖家）
 * 用法：node scripts/enrich.js
 * 只处理 brand/seller_name 为空的记录（支持断点续跑）。
 * 字段映射（2026-10 实测）：
 *   品牌 <- a[href*="/brands/"] 的 textContent
 *   卖家 <- h2[class*="sellerAndBrandItemName"] 的 textContent
 */
const WbDatabase = require('../src/db/database');
const { WbMarketApiClient } = require('../src/collector/wbCollector');

async function main() {
  const db = new WbDatabase().init();
  const rows = db.db.prepare(`
    SELECT id, wb_nm_id, url FROM wb_market_products
    WHERE wb_nm_id > 0 AND (brand = '' OR seller_name = '')
  `).all();
  console.log(`待补全 ${rows.length} 件`);

  const upd = db.db.prepare("UPDATE wb_market_products SET brand=?, seller_name=?, updated_at=datetime('now') WHERE id=?");

  const client = new WbMarketApiClient({});
  await client._ensureBrowser();
  const page = await client._getPage();
  page.setDefaultTimeout(30000);

  const extract = () => page.evaluate(() => ({
    brand: ((document.querySelector('a[href*="/brands/"]') || {}).textContent || '').trim(),
    seller: ((document.querySelector('h2[class*="sellerAndBrandItemName"]') || {}).textContent || '').trim()
  })).catch(() => ({ brand: '', seller: '' }));

  let ok = 0, empty = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const url = r.url || `https://www.wildberries.ru/catalog/${r.wb_nm_id}/detail.aspx`;
    let brand = '', seller = '';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      let info = await extract();
      brand = info.brand; seller = info.seller;
      if (!brand && !seller) {
        await page.waitForTimeout(4000);
        info = await extract();
        brand = info.brand; seller = info.seller;
      }
      upd.run(brand, seller, r.id);
      if (brand || seller) ok++; else empty++;
    } catch (e) {
      empty++;
      if ((i + 1) % 30 === 0) console.log(`[进度] ${i + 1}/${rows.length} 异常: ${e.message}`);
    }
    if ((i + 1) % 20 === 0) {
      console.log(`[进度] ${i + 1}/${rows.length}，成功 ${ok}，空 ${empty}`);
    }
  }

  const done = db.db.prepare("SELECT COUNT(*) AS c FROM wb_market_products WHERE brand != '' OR seller_name != ''").get().c;
  console.log(`=== 完成：本次成功 ${ok}，空 ${empty}，累计已补全 ${done}/${rows.length} 条 ===`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });