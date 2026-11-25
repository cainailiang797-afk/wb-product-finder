/**
 * 精选采集（需求大、竞争小）
 * 用法：node scripts/select.js [数量] [--max-supply 15000] [--min-reviews 20] [--categories A,B]
 *
 * 与 collect.js 的区别：
 *   collect.js  = 按目标总量铺量采集（词池全跑，词内采满）
 *   select.js   = 逐词探测「WB 搜索结果总数(供给=竞争)」与「Top 商品评价中位(需求)」，
 *                 只保留供给低于阈值的词，按「需求/竞争」比值排序挑品，每个词最多取 2 件。
 *
 * 采完自动串联：回填四维评分 → 新店预筛 → 重生成列表页（与 collect.js 一致）。
 */
const path = require('path');
const { spawnSync } = require('child_process');
const WbDatabase = require('../src/db/database');
const { WbMarketApiClient } = require('../src/collector/wbCollector');
const WbScoring = require('../src/analyzer/scoring');
const { DEFAULT_PET_KEYWORDS } = require('../src/config/petKeywords');

const argv = process.argv.slice(2);
const numArg = argv.find((a) => /^\d+$/.test(a));
const TARGET = numArg ? parseInt(numArg, 10) : 10;
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const MAX_SUPPLY = parseInt(getOpt('--max-supply', '15000'), 10);
const MIN_REVIEWS = parseInt(getOpt('--min-reviews', '20'), 10);
// 蓝海模式：只挑评论数 < MAX_REVIEWS 的商品，才通得过「新店规则：评论数>100 排除」
const MAX_REVIEWS = parseInt(getOpt('--max-reviews', '0'), 10) || 0;
const MIN_PRICE = parseInt(getOpt('--min-price', '600'), 10);
const MAX_PRICE = parseInt(getOpt('--max-price', '6000'), 10);
const MAX_PER_KEYWORD = parseInt(getOpt('--per-keyword', '2'), 10);
const CATEGORIES = getOpt('--categories', '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT_WORDS = parseInt(getOpt('--limit-words', '0'), 10) || 0;
const PER_KEYWORD = 12;
const ROOT = path.join(__dirname, '..');

const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const dedupeKey = (title, brand, seller) => {
  const t = norm(title);
  if (norm(brand)) return 'b:' + norm(brand) + '|' + t;
  if (norm(seller)) return 's:' + norm(seller) + '|' + t;
  return '';
};

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function runStep(label, script, args = []) {
  console.log(`\n>>> ${label}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) console.log(`[警告] ${label} 失败（退出码 ${r.status}），请单独重跑 scripts/${script}`);
  return r.status === 0;
}

(async () => {
  const db = new WbDatabase().init();
  const client = new WbMarketApiClient({});
  const scoring = new WbScoring();

  // 种子词入库（幂等），保证 petKeywords.js 新增的词能参与探测
  const insKw = db.db.prepare('INSERT OR IGNORE INTO wb_keywords (keyword, category, animal_type, enabled) VALUES (?, ?, ?, 1)');
  db.db.transaction(() => DEFAULT_PET_KEYWORDS.forEach((k) => insKw.run(k.keyword, k.category, k.animalType)))();

  // 词池：优先未饱和的词（已采 >= 45 件的词在 WB 上基本被采空，探测也是浪费）
  const sqlKw = CATEGORIES.length
    ? `SELECT k.keyword, k.category, (SELECT COUNT(*) FROM wb_market_products p WHERE p.keyword=k.keyword) AS cnt
       FROM wb_keywords k WHERE k.enabled=1 AND k.category IN (${CATEGORIES.map(() => '?').join(',')}) ORDER BY k.id DESC`
    : `SELECT k.keyword, k.category, (SELECT COUNT(*) FROM wb_market_products p WHERE p.keyword=k.keyword) AS cnt
       FROM wb_keywords k WHERE k.enabled=1 ORDER BY k.id DESC`;
  const kwRows = CATEGORIES.length ? db.db.prepare(sqlKw).all(...CATEGORIES) : db.db.prepare(sqlKw).all();
  const keywords = (LIMIT_WORDS ? kwRows.slice(0, LIMIT_WORDS) : kwRows).filter((k) => k.cnt < 45);
  console.log(`词池 ${keywords.length} 个（已跳过饱和词），目标 ${TARGET} 件，供给上限 ${MAX_SUPPLY}`);

  const taskId = Number(db.db.prepare(
    "INSERT INTO wb_collection_tasks (task_type, keyword, status, total_count, started_at, finished_at) VALUES ('market_collect', 'select', 'running', ?, datetime('now'), '')"
  ).run(TARGET).lastInsertRowid);
  console.log(`批次 ID=${taskId}`);

  const seenIds = new Set(db.db.prepare('SELECT wb_nm_id FROM wb_market_products').all().map((r) => r.wb_nm_id));
  const seenKeys = new Set(db.db.prepare('SELECT title, brand, seller_name FROM wb_market_products').all().map((r) => dedupeKey(r.title, r.brand, r.seller_name)).filter(Boolean));
  const ins = db.db.prepare(`
    INSERT OR IGNORE INTO wb_market_products
      (wb_nm_id, title, category, keyword, url, image_url, price, old_price, rating, review_count, brand, seller_name, conversion_score, competition_score, sixdim_total, sixdim_missing, collect_task_id, market_supply)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // 第一步：逐词探测（供给 + 商品池），只保留竞争小的词
  const scanned = [];
  for (const k of keywords) {
    let r;
    try { r = await client.searchProducts(k.keyword, PER_KEYWORD); } catch (e) { console.log(`[失败] ${k.keyword}: ${e.message}`); continue; }
    if (!r || !r.success) continue;
    const supply = r.marketSupply || 0;
    const pool = r.products.filter((p) => p.price >= MIN_PRICE && p.price <= MAX_PRICE
      && p.reviews >= MIN_REVIEWS && (!MAX_REVIEWS || p.reviews < MAX_REVIEWS));
    const medRev = median(pool.map((p) => p.reviews));
    // 蓝海模式下只要词内有 1 件合格商品就保留（小词整体评价少是常态）
    const keep = supply > 0 && supply <= MAX_SUPPLY && pool.length > 0;
    console.log(`${keep ? '✅' : '✗ '} ${k.keyword} | 供给=${supply} | 合格${pool.length}件 | 评价中位=${medRev}`);
    if (keep) scanned.push({ ...k, supply, pool, medRev, score: 1000 / Math.log10(supply + 10) + Math.min(medRev, 90) });
    if (supply > 0) db.db.prepare('UPDATE wb_market_products SET market_supply=? WHERE keyword=?').run(supply, k.keyword);
  }

  // 第二步：按机会分挑品（每词最多 N 件，同标题/同款去重）
  scanned.sort((a, b) => b.score - a.score);
  let ok = 0;
  for (const x of scanned) {
    if (ok >= TARGET) break;
    let taken = 0;
    for (const p of [...x.pool].sort((a, b) => b.reviews - a.reviews)) {
      if (ok >= TARGET || taken >= MAX_PER_KEYWORD) break;
      if (p.reviews < MIN_REVIEWS || seenIds.has(p.nmId) || seenKeys.has(norm(p.title))) continue;
      const conversion = scoring.conversionScore(p.reviews, p.rating);
      const competition = scoring.competitionScore(x.supply);
      const res = ins.run(p.nmId, p.title, x.category, x.keyword, p.url, p.image, p.price, p.oldPrice, p.rating, p.reviews, p.brand || '', p.seller || '', conversion, competition, conversion + (competition ?? 0), 'demand,pain,improve,follow', taskId, x.supply);
      if (res.changes > 0) {
        ok++; taken++; seenIds.add(p.nmId); seenKeys.add(norm(p.title));
        console.log(`  + ${p.nmId} ₽${p.price} ★${p.rating} ${p.reviews}评 | 供给${x.supply} | ${x.keyword}`);
      }
    }
  }

  db.db.prepare("UPDATE wb_collection_tasks SET status='done', success_count=?, finished_at=datetime('now') WHERE id=?").run(ok, taskId);
  console.log(`\n=== 精选完成：新增 ${ok} 件（批次 ${taskId}）===`);

  // 自动回填四维 → 预筛 → 刷新列表（只回填本批次，避免全库扫描）
  if (ok > 0) {
    runStep('回填四维评分（本批次）', 'deepscore.js', ['--task', String(taskId)]);
    runStep('新店规则预筛', 'filter.js');
    runStep('重生成商品列表页', 'report.js');
  } else {
    console.log('本次无新增商品，跳过自动回填');
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
