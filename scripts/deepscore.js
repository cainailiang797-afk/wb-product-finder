/**
 * 六维评分回填（补齐 需求 / 痛点 / 改造 / 跟卖 四维）
 * 用法：node scripts/deepscore.js [--force] [--limit N]
 *
 * 数据来源（全部真实，无模拟）：
 *   - 需求：同关键词样本商品的「近30天评价增量合计」→ 对数换算 0~20（代理值，页面标注）
 *   - 痛点：WB feedbacks 真实差评（1~3星）文本 → 俄语规则分类计数 → 0~20
 *   - 改造：由命中痛点映射的固定改进项数量 → 0~20
 *   - 跟卖：同关键词头部品牌评论占比（样本内）→ 0~10
 *   - 转化/竞争：沿用已有口径（评论数+评分 / 同词相似款数）
 *
 * 抓取明细落库：imt_id / review_sample / review_neg / review_recent30 / pain_json / improve_json / brand_share
 */
const WbDatabase = require('../src/db/database');
const WbScoring = require('../src/analyzer/scoring');
const { WbReviewClient } = require('../src/collector/wbReviews');
const { WbMarketApiClient } = require('../src/collector/wbCollector');
const { analyzeReviews } = require('../src/analyzer/reviewPain');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const KEPT = argv.includes('--kept'); // 只跑预筛保留（excluded=0）的商品，避免给已排除商品白花抓取
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? parseInt(argv[i + 1], 10) || 0 : 0;
})();
// 只回填指定采集批次：--task 19 或 --task 19,20,21（采集脚本自动串联时用，避免全库扫描）
const TASKS = (() => {
  const i = argv.indexOf('--task');
  if (i < 0) return [];
  return String(argv[i + 1] || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0);
})();

const CONCURRENCY = 4;
const db = new WbDatabase().init();
const scoring = new WbScoring();
const reviewClient = new WbReviewClient({});

const updReview = db.db.prepare(`
  UPDATE wb_market_products SET
    imt_id=?, brand=CASE WHEN ?!='' THEN ? ELSE brand END,
    review_sample=?, review_neg=?, review_recent30=?,
    pain_json=?, improve_json=?, review_neg_json=?, review_checked_at=datetime('now')
  WHERE id=?
`);
const updScore = db.db.prepare(`
  UPDATE wb_market_products SET
    conversion_score=?, competition_score=?, demand_score=?, pain_score=?, improve_score=?, follow_score=?,
    sixdim_total=?, sixdim_missing=?, brand_share=?, demand_proxy=?, updated_at=datetime('now')
  WHERE id=?
`);

/**
 * 新号段商品只在 wildberries.cn 静态域名上，且 basket 主机号不按 vol 线性分配。
 * 用浏览器打开一次商品页，捕获页面自身请求的 card.json 地址 → 反推号段主机并缓存。
 * 每个号段只需 1 次页面访问，后续同号段商品直接命中缓存。
 */
async function resolveBandsViaBrowser(rows) {
  const need = {};
  for (const r of rows) {
    const vol = Math.floor(r.wb_nm_id / 100000);
    if (vol <= 4565) continue; // 旧号段有静态映射表
    const band = Math.floor(vol / 1000);
    if (!reviewClient.hostBand[band] && !need[band]) need[band] = r.wb_nm_id;
  }
  const list = Object.entries(need);
  if (!list.length) return;

  console.log(`[主机] 需浏览器解析的新号段 ${list.length} 个`);
  const client = new WbMarketApiClient({});
  await client._ensureBrowser();
  const page = await client._getPage();
  let captured = null;
  page.on('response', (res) => {
    const u = res.url();
    if (/info\/ru\/card\.json/i.test(u)) captured = u;
  });

  for (const [band, nm] of list) {
    captured = null;
    try {
      await page.goto(`https://www.wildberries.ru/catalog/${nm}/detail.aspx`, { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 24 && !captured; i++) await page.waitForTimeout(500);
      if (captured) {
        const r = reviewClient.setHostFromUrl(captured);
        if (r && r.band === parseInt(band, 10)) console.log(`[主机] 号段 ${band} → ${r.hostName}`);
      }
      if (!captured) console.log(`[主机] 号段 ${band} 未捕获到 card.json（nm ${nm}）`);
    } catch (e) {
      console.log(`[主机] 号段 ${band} 解析失败: ${e.message}`);
    }
  }
}

async function phaseReviews(rows) {
  let done = 0, fail = 0, i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < rows.length) {
      const r = rows[i++];
      try {
        const res = await reviewClient.getProductReviews(r.wb_nm_id);
        if (!res.ok) { fail++; continue; }
        const fb = res.feedbacks;
        const ana = analyzeReviews(fb.reviews);
        updReview.run(
          res.imtId, res.brand, res.brand,
          ana.sample, ana.negCount, ana.recent30,
          JSON.stringify(ana.pains), JSON.stringify(ana.improves), JSON.stringify(ana.negSamples),
          r.id
        );
        done++;
      } catch (e) {
        fail++;
      }
      const total = done + fail;
      if (total % 20 === 0) console.log(`[评价] ${total}/${rows.length} 成功 ${done} 失败 ${fail}`);
    }
  });
  await Promise.all(workers);
  console.log(`[评价] 完成：成功 ${done}，失败 ${fail}`);
  return { done, fail };
}

function phaseScores() {
  const rows = db.db.prepare(`
    SELECT id, wb_nm_id, keyword, rating, review_count, brand, review_sample, review_neg,
           pain_json, improve_json, review_recent30, review_checked_at, market_supply
    FROM wb_market_products
  `).all();

  // 关键词维度聚合：需求代理（近30天评价增量合计）+ 跟卖（头部品牌评论占比）
  const kw = {};
  for (const r of rows) {
    if (!r.keyword) continue;
    const k = kw[r.keyword] || (kw[r.keyword] = { recent30: 0, sample: 0, reviews: 0, brandRev: {}, totalRev: 0 });
    k.recent30 += r.review_recent30 || 0;
    k.sample += r.review_sample || 0;
    k.reviews += 1;
    if (r.brand) {
      k.brandRev[r.brand] = (k.brandRev[r.brand] || 0) + (r.review_count || 0);
      k.totalRev += r.review_count || 0;
    }
  }
  const brandShareOf = (keyword) => {
    const k = kw[keyword];
    if (!k || k.totalRev <= 0) return null;
    const top = Math.max(...Object.values(k.brandRev));
    return top / k.totalRev;
  };

  let done = 0;
  const tx = db.db.transaction(() => {
    for (const r of rows) {
      const conversion = scoring.conversionScore(r.review_count, r.rating);
      // 竞争维：用 WB 真实搜索结果总数（market_supply），未取到则记缺失
      const competition = (r.market_supply || 0) > 0 ? scoring.competitionScore(r.market_supply) : null;

      const recent30 = r.keyword && kw[r.keyword] && kw[r.keyword].sample > 0 ? kw[r.keyword].recent30 : null;
      const demand = recent30 == null ? null : scoring.demandScoreByProxy(recent30);

      const pains = r.pain_json ? JSON.parse(r.pain_json) : null;
      const improves = r.improve_json ? JSON.parse(r.improve_json) : null;
      const hasReviewData = (r.review_sample || 0) > 0;
      const pain = hasReviewData ? scoring.painScore(pains) : null;
      const improve = hasReviewData ? scoring.improveScore(improves) : null;

      const share = r.keyword ? brandShareOf(r.keyword) : null;
      const follow = share == null ? null : scoring.followScore(share);

      const six = scoring.sixDimFromParts({ demand, conversion, competition, pain, improve, follow });
      updScore.run(
        conversion, competition, demand, pain, improve, follow,
        six.total, six.missing.join(','), share == null ? 0 : share, recent30 == null ? 0 : recent30,
        r.id
      );
      done++;
    }
  });
  tx();
  return done;
}

(async () => {
  const conds = ['wb_nm_id > 0'];
  if (!FORCE) conds.push("review_checked_at = ''");
  if (KEPT) conds.push('excluded = 0');
  const params = [];
  if (TASKS.length) {
    conds.push(`collect_task_id IN (${TASKS.map(() => '?').join(',')})`);
    params.push(...TASKS);
  }
  const all = db.db.prepare(`
    SELECT id, wb_nm_id FROM wb_market_products
    WHERE ${conds.join(' AND ')}
    ORDER BY review_count DESC
  `).all(...params);
  const rows = LIMIT ? all.slice(0, LIMIT) : all;
  console.log(`待抓评价商品 ${rows.length} 件（总库 ${all.length}）`);
  // --scores-only：只按已入库的评价重算六维（不重新抓评价，用于评分阶段中断后的补算）
  if (rows.length && !argv.includes('--scores-only')) {
    await resolveBandsViaBrowser(rows).catch((e) => console.log('[主机] 浏览器解析跳过:', e.message));
    await phaseReviews(rows);
  }
  const n = phaseScores();
  console.log(`六维重算完成：${n} 件`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
