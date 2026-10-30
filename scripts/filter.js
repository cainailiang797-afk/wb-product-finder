/**
 * WB 新店预筛脚本：按新店铺规则给商品打「排除」标记
 * 用法：node scripts/filter.js          → 按规则打标（幂等，可反复跑）
 *       node scripts/filter.js --unset  → 清除全部排除标记
 *
 * 规则（新店铺，避开强势老卖家/高客单/竞争饱和）：
 *   1. 评论数 > 100           → 排除（新店评价少，转化打不过爆款）
 *   2. 评论数 = 0             → 排除（无任何市场验证，新店不碰）
 *   3. 售价   ≤ 500 ₽         → 排除（保留售价 > 500 ₽ 的商品）
 *   4. 同关键词相似款数 > 50   → 排除（同一搜索词下相似款 > 50 视为跟卖饱和）
 *   5. 同款重复               → 排除（同品牌+同标题 或 同卖家+同标题 只保留分数最高的一条）
 *
 * 依赖：跟卖数（同关键词相似款数）仅依赖 keyword 字段，采集即有，无需 deepscore 先行。
 */
const WbDatabase = require('../src/db/database');

// 同款判定键：有品牌按品牌+标题，无品牌但有卖家按卖家+标题；两者都缺则不参与去重（无法判断是否同款）
function dedupeKey(title, brand, seller) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const t = norm(title);
  if (norm(brand)) return 'b:' + norm(brand) + '|' + t;
  if (norm(seller)) return 's:' + norm(seller) + '|' + t;
  return '';
}

const LIMITS = {
  maxReviews: 100,  // 评论数上限（含）
  minReviews: 1,    // 评论数下限（评论数为 0 的排除）
  minPrice: 500,   // 售价下限 ₽（售价 ≤ 此值的排除，保留 >500）
  maxFollow: 50    // 同关键词相似款数上限（含）
};

const db = new WbDatabase().init();

// 清除历史标记（幂等）
db.db.prepare("UPDATE wb_market_products SET excluded=0, exclude_reason=''").run();
if (process.argv.includes('--unset')) {
  console.log('已清除全部排除标记');
  process.exit(0);
}

// 同关键词相似款数：每个搜索词下库里的条目数（反映该词的竞争饱和程度）
const followCount = {};
db.db.prepare(`
  SELECT keyword, COUNT(*) AS c
  FROM wb_market_products
  WHERE keyword != ''
  GROUP BY keyword
`).all().forEach((r) => { followCount[r.keyword] = r.c; });

const rows = db.db.prepare('SELECT id, review_count, price, keyword FROM wb_market_products').all();
const upd = db.db.prepare('UPDATE wb_market_products SET excluded=1, exclude_reason=? WHERE id=?');

let excluded = 0;
const reasonDist = {};

for (const r of rows) {
  const reasons = [];
  if (r.review_count > LIMITS.maxReviews) reasons.push('评论数>' + LIMITS.maxReviews);
  if (r.review_count < LIMITS.minReviews) reasons.push('评论为0');
  if (r.price <= LIMITS.minPrice) reasons.push('售价≤' + LIMITS.minPrice + '₽');
  if (r.keyword && (followCount[r.keyword] || 0) > LIMITS.maxFollow) reasons.push('同词相似款>' + LIMITS.maxFollow);
  if (reasons.length) {
    const reason = reasons.join(';');
    upd.run(reason, r.id);
    excluded++;
    reasonDist[reason] = (reasonDist[reason] || 0) + 1;
  }
}

console.log(`已排除 ${excluded}/${rows.length} 件`);
console.log('原因分布:', Object.entries(reasonDist).map(([k, v]) => `${k}×${v}`).join(' | '));

// 规则5：同款去重（在其余规则通过的商品里，同款只保留分最高的一条）
const survivors = db.db.prepare(
  'SELECT id, title, brand, seller_name, sixdim_total, review_count FROM wb_market_products WHERE excluded=0'
).all();
const groups = new Map();
for (const r of survivors) {
  const k = dedupeKey(r.title, r.brand, r.seller_name);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
let dupGroups = 0;
let dupExcluded = 0;
for (const list of groups.values()) {
  if (list.length < 2) continue;
  dupGroups++;
  list.sort((a, b) => (b.sixdim_total || 0) - (a.sixdim_total || 0)
    || (b.review_count || 0) - (a.review_count || 0) || a.id - b.id);
  for (const r of list.slice(1)) {
    upd.run('重复商品(同款已存在)', r.id);
    dupExcluded++;
  }
}
if (dupExcluded) {
  console.log(`同款去重：${dupGroups} 组重复，再排除 ${dupExcluded} 件（保留同款中六维分最高的一条）`);
}
console.log(`最终保留 ${survivors.length - dupExcluded} 件`);
process.exit(0);