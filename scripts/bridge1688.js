/**
 * WB ← 1688 货源桥接（半自动）
 *
 * 用法：
 *   ① node scripts/bridge1688.js --list [N]
 *      生成 TOP N 件（尚未匹配采购成本）商品的「俄文标题→中文关键词→1688搜索URL」清单，
 *      写入 data/1688_need_match.json 并打印，供你在 1688 里找货。
 *
 *   ② 你（或脚本）把找到的 1688 商品 URL 填入 data/1688_match.json：
 *       [{ "wb_nm_id": 123456, "url": "https://detail.1688.com/offer/xxxx.html" }, ...]
 *
 *   ③ node scripts/bridge1688.js --import
 *      逐条用登录态 Playwright 打开详情页 → 解析采购价 → 写回 wb_market_products.purchase_cost
 *      （含 1688 运费写入 shipping_cost），全程只落真实解析值，解析失败则跳过并告示。
 */
const path = require('path');
const fs = require('fs');
const WbDatabase = require('../src/db/database');
const Ali1688Client = require('../src/api/ali1688Client');
const { fetchProductPlaywright, close } = require('../src/api/ali1688Playwright');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NEED_FILE = path.join(DATA_DIR, '1688_need_match.json');
const MATCH_FILE = path.join(DATA_DIR, '1688_match.json');

async function main() {
  const mode = process.argv[2] || '--list';
  if (mode === '--import') return importAll();
  if (mode === '--import-data') return importData(process.argv[3], process.argv[4]);
  return list(parseInt(process.argv[3], 10) || 15);
}

function list(n) {
  const db = new WbDatabase().init();
  const rows = db.db.prepare(`
    SELECT wb_nm_id, title, category, price, review_count
    FROM wb_market_products
    WHERE purchase_cost = 0
    ORDER BY review_count DESC
    LIMIT ?
  `).all(n);

  const client = new Ali1688Client();
  const need = rows.map(r => {
    const s = client.buildSearchUrl(r.title);
    return {
      wb_nm_id: r.wb_nm_id,
      title: r.title,
      category: r.category,
      price_rub: r.price,
      review_count: r.review_count,
      cn_keyword: s.keyword,
      search_url: s.search_url,
      image_search_url: s.image_search_url
    };
  });

  const json = JSON.stringify(need, null, 2);
  fs.writeFileSync(NEED_FILE, json, 'utf8');

  console.log(`=== 待匹配 1688 货源清单（TOP ${need.length}，按评论数降序）===`);
  console.log('');
  for (const it of need) {
    console.log(`[${it.wb_nm_id}] ${it.category || '未分类'} | 评论 ${it.review_count} | ₽${it.price_rub}`);
    console.log(`  标题: ${it.title}`);
    console.log(`  中文关键词: ${it.cn_keyword || '(未匹配到，需人工补关键词)'}`);
    console.log(`  1688搜索: ${it.search_url}`);
    console.log('');
  }
  console.log(`已写入 ${NEED_FILE}`);
  console.log('');
  console.log('下一步：');
  console.log('  1. node scripts/1688_login.js （扫码登录 1688 一次）');
  console.log('  2. 用上面的搜索链接在 1688 找到同款，复制详情页 offer URL');
  console.log('  3. 把结果填进 data/1688_match.json： [{"wb_nm_id":123,"url":"https://detail.1688.com/offer/xxxx.html"}]');
  console.log('  4. node scripts/bridge1688.js --import');
}

async function importAll() {
  if (!fs.existsSync(MATCH_FILE)) {
    console.error('找不到 ' + MATCH_FILE + '。请先按 --list 找到货并填好匹配文件。');
    process.exit(1);
  }
  const matches = JSON.parse(fs.readFileSync(MATCH_FILE, 'utf8'));
  if (!Array.isArray(matches) || matches.length === 0) {
    console.error('匹配文件为空或格式错误，应为数组 [{ "wb_nm_id", "url" }]');
    process.exit(1);
  }

  const db = new WbDatabase().init();
  const getRow = db.db.prepare('SELECT id, wb_nm_id, title FROM wb_market_products WHERE wb_nm_id = ?');
  const update = db.db.prepare('UPDATE wb_market_products SET purchase_cost = ?, shipping_cost = ?, updated_at = datetime(\'now\') WHERE id = ?');

  let ok = 0, fail = 0, needLogin = false;
  for (const m of matches) {
    const row = getRow.get(Number(m.wb_nm_id));
    if (!row) {
      console.log(`[跳过] nmID ${m.wb_nm_id} 不在库中`);
      fail++;
      continue;
    }
    if (!m.url) {
      console.log(`[跳过] nmID ${m.wb_nm_id} 未提供 1688 URL`);
      fail++;
      continue;
    }
    process.stdout.write(`[抓取] #${row.id} nmID ${m.wb_nm_id} ${m.url}\n`);
    const r = await fetchProductPlaywright(m.url);
    if (!r.success) {
      if (r.needLogin) needLogin = true;
      console.log(`  ✗ 失败: ${r.error || '未知错误'}`);
      fail++;
      continue;
    }
    const cost = Math.round((r.source_price || 0) * 100) / 100;
    const freight = Math.round((r.source_freight || 0) * 100) / 100;
    if (cost <= 0) {
      console.log(`  ✗ 解析出的采购价为 0，跳过（source_price=${r.source_price}）`);
      fail++;
      continue;
    }
    update.run(cost, freight, row.id);
    console.log(`  ✓ 采购价 ¥${cost}${freight > 0 ? ' + 运费 ¥' + freight : ''} | 1688: ${r.source_title || ''}`);
    if (r.source_supplier) console.log(`    供应商: ${r.source_supplier}`);
    ok++;
  }

  await close();
  console.log('');
  console.log(`=== 完成：成功 ${ok} 件，失败 ${fail} 件 ===`);
  if (needLogin) {
    console.log('检测到需登录，请先运行 node scripts/1688_login.js 扫码登录后再重试 --import');
  }
  process.exit(0);
}

/**
 * 导入用户工具采集的 1688 商品数据（路线 C：手动以图搜图找到同款 + 工具导出 JSON）
 * 用法：
 *   node scripts/bridge1688.js --import-data <wb_nm_id> [file.json]
 *   - 提供 file.json 时读文件；否则从 stdin 读（粘贴 JSON 后按 Ctrl+Z 再回车）
 * 只落采购成本：purchase_cost = 单价 + 运费；shipping_cost = 运费。
 */
function importData(nmIdArg, fileArg) {
  const nmId = Number(nmIdArg);
  if (!nmId) {
    console.error('用法：node scripts/bridge1688.js --import-data <wb_nm_id> [file.json]');
    process.exit(1);
  }

  let raw;
  try {
    if (fileArg) raw = fs.readFileSync(path.resolve(fileArg), 'utf8');
    else {
      process.stdout.write('请粘贴 1688 商品 JSON，结束后按 Ctrl+Z 再回车：\n');
      raw = fs.readFileSync(0, 'utf8');
    }
  } catch (e) {
    console.error('读取失败:', e.message);
    process.exit(1);
  }

  let body;
  try { body = JSON.parse(raw); } catch (e) {
    console.error('JSON 解析失败:', e.message);
    process.exit(1);
  }

  const { normalize1688Data, saveToProduct } = require('../src/api/ali1688Import');
  const norm = normalize1688Data(body);
  const db = new WbDatabase().init();
  const result = saveToProduct(db, nmId, norm, body);

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  const row = result.row, n = result.norm;
  console.log('');
  console.log('=== 已落采购成本 ===');
  console.log('WB 商品: [' + row.wb_nm_id + '] ' + row.title);
  console.log('1688 标题: ' + n.title);
  console.log('采购价: ¥' + n.unitPrice + (n.freight > 0 ? ' + 运费 ¥' + n.freight + ' = ¥' + n.total : ''));
  console.log('重量/尺寸: ' + (n.weight ? n.weight + 'g' : '—') + (n.len || n.wid || n.hei ? ' / ' + n.len + '*' + n.wid + '*' + n.hei + 'cm' : ''));
  console.log('1688 offer: ' + (n.offerId ? 'https://detail.1688.com/offer/' + n.offerId + '.html' : (n.sourceUrl || '—')));
  console.log('');
  console.log('purchase_cost=' + n.total + '，shipping_cost=' + n.freight + '，规格 ' + n.weight + 'g / ' + n.len + '*' + n.wid + '*' + n.hei + 'cm');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });