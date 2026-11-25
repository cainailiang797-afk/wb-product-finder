/**
 * WB 采集脚本（Phase 1 最小验证）
 * 用法：node scripts/collect.js [目标数量]
 * 采集完成后会自动串联：抓新品评价回填四维 → 新店规则预筛 → 重生成列表页
 */
const path = require('path');
const { spawnSync } = require('child_process');
const WbDatabase = require('../src/db/database');
const { WbMarketApiClient } = require('../src/collector/wbCollector');
const { DEFAULT_PET_KEYWORDS } = require('../src/config/petKeywords');
const WbScoring = require('../src/analyzer/scoring');

const target = parseInt(process.argv[2], 10) || 300;
// 每词采集上限：必须 < 筛选规则4 的「同词相似款>50」阈值，否则整词会被规则4连带排除
const PER_KEYWORD = 45;
const ROOT = path.join(__dirname, '..');

// 同款判定键：有品牌按品牌+标题，无品牌但有卖家按卖家+标题；两者都缺则不参与去重（无法判断是否同款）
function dedupeKey(title, brand, seller) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const t = norm(title);
  if (norm(brand)) return 'b:' + norm(brand) + '|' + t;
  if (norm(seller)) return 's:' + norm(seller) + '|' + t;
  return '';
}

// 依次执行后续步骤（用子进程，保证每个脚本各自独立的库连接与日志）
function runStep(label, script, args = []) {
  console.log(`\n>>> ${label}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.log(`[警告] ${label} 失败（退出码 ${r.status}），请单独重跑 scripts/${script}`);
    return false;
  }
  return true;
}

async function main() {
  const db = new WbDatabase().init();
  // 种子词首次运行入库（幂等）
  const ins = db.db.prepare(
    'INSERT OR IGNORE INTO wb_keywords (keyword, category, animal_type, enabled) VALUES (?, ?, ?, 1)'
  );
  const tx = db.db.transaction(() => {
    DEFAULT_PET_KEYWORDS.forEach((k) => ins.run(k.keyword, k.category, k.animalType));
  });
  tx();
  // 可按类目定向采集：WB_ONLY_CATEGORY=猫用品-抓板 时只跑该类目的词（不影响其它类目），支持逗号分隔多类目
  const onlyCategory = (process.env.WB_ONLY_CATEGORY || '').split(',').map((s) => s.trim()).filter(Boolean);
  // 可按指定词采集：WB_ONLY_KEYWORDS="词1,词2" 时只跑这些词（不受类目/排序影响）
  const onlyKeywords = (process.env.WB_ONLY_KEYWORDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const keywords = onlyCategory.length
    ? db.db.prepare(`SELECT keyword, category FROM wb_keywords WHERE enabled=1 AND category IN (${onlyCategory.map(() => '?').join(',')}) ORDER BY id`).all(...onlyCategory)
    : db.db.prepare('SELECT keyword, category FROM wb_keywords WHERE enabled=1 ORDER BY id').all();
  const picked = onlyKeywords.length ? keywords.filter((k) => onlyKeywords.includes(k.keyword)) : keywords;
  console.log(`启用词 ${picked.length} 个（词库共 ${keywords.length} 个），目标 ${target} 件`);

  const client = new WbMarketApiClient({});
  const scoring = new WbScoring();
  const startCount = db.db.prepare('SELECT COUNT(*) AS c FROM wb_market_products').get().c;
  const needAdd = Math.max(0, target - startCount);
  console.log(`当前已有 ${startCount} 件，需新增 ${needAdd} 件`);
  if (needAdd === 0) {
    console.log('已达目标，无需采集');
    process.exit(0);
  }
  // 本次采集批次：写一条任务记录，商品按 collect_task_id 归属该批次（列表页按批次分组/筛选）
  const taskRes = db.db.prepare(
    "INSERT INTO wb_collection_tasks (task_type, keyword, status, total_count, started_at, finished_at) VALUES ('market_collect', '*', 'running', ?, datetime('now'), '')"
  ).run(needAdd);
  const taskId = Number(taskRes.lastInsertRowid);
  console.log(`本次采集批次 ID=${taskId}，开始时间 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  let inserted = 0;
  let dupSkipped = 0;
  // 库内已有同款（同品牌/同卖家 + 同标题）的判定键，采集时直接跳过，避免重复采集
  const seenKeys = new Set(
    db.db.prepare('SELECT title, brand, seller_name FROM wb_market_products').all()
      .map((r) => dedupeKey(r.title, r.brand, r.seller_name)).filter(Boolean)
  );
  for (const k of picked) {
    if (inserted >= needAdd) break;
    // 已饱和词跳过：采再多也只会整词触发规则4（同词相似款>50）被排除，纯浪费
    const curCnt = db.db.prepare('SELECT COUNT(*) AS c FROM wb_market_products WHERE keyword = ?').get(k.keyword).c;
    if (curCnt >= PER_KEYWORD) {
      console.log(`[跳过] "${k.keyword}" 已饱和(${curCnt}≥${PER_KEYWORD})`);
      continue;
    }
    let r;
    try {
      r = await client.searchProducts(k.keyword, PER_KEYWORD);
    } catch (e) {
      console.log(`[失败] "${k.keyword}": ${e.message}（已跳过，继续下一词）`);
      continue;
    }
    if (r.pending) {
      console.log(`[跳过] "${k.keyword}" 解析器未实现（pending），请先 npm run probe 后回填解析器`);
      break; // 解析器未就绪，无需继续空转
    }
    if (!r.success) {
      console.log(`[失败] "${k.keyword}": ${r.error}`);
      continue;
    }
    // 竞争维口径：该词在 WB 上的真实搜索结果总数（市场供给量），非本库条数
    const marketSupply = r.marketSupply || 0;
    if (marketSupply > 0) {
      // 同词旧商品同步同一供给量，保证同词竞争口径一致
      db.db.prepare('UPDATE wb_market_products SET market_supply=? WHERE keyword=?').run(marketSupply, k.keyword);
    }
    for (const p of r.products) {
      // 药品排除 + 入库（去重靠 wb_nm_id UNIQUE）
      const title = p.title || '';
      if (/лекарств|таблетк|витамин|ветеринар|от блох|от клещ|капли/i.test(title)) continue;
      // 同款去重：库内已有同品牌/同卖家且同标题的商品，不再重复采集
      const key = dedupeKey(title, p.brand, p.seller);
      if (key && seenKeys.has(key)) { dupSkipped++; continue; }
      // 采集即评分：只算有实数据的维度（转化+竞争），其余维度缺数据、标注待补
      const conversion = scoring.conversionScore(p.reviews, p.rating);
      const competition = marketSupply > 0 ? scoring.competitionScore(marketSupply) : null;
      const sixdimTotal = conversion + (competition ?? 0);
      const missingDims = 'demand,pain,improve,follow' + (competition == null ? ',competition' : '');
      try {
        const res = db.db.prepare(`
          INSERT OR IGNORE INTO wb_market_products
            (wb_nm_id, title, category, keyword, url, image_url, price, old_price, rating, review_count, brand, seller_name, conversion_score, competition_score, sixdim_total, sixdim_missing, collect_task_id, market_supply)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(p.nmId, title, k.category, k.keyword, p.url, p.image, p.price, p.oldPrice, p.rating, p.reviews, p.brand, p.seller, conversion, competition, sixdimTotal, missingDims, taskId, marketSupply);
        if (res.changes > 0) { inserted++; if (key) seenKeys.add(key); }
      } catch (e) {
        console.log('入库异常:', e.message);
      }
    }
    console.log(`"${k.keyword}" 新增 ${inserted}/${needAdd}，同款跳过 ${dupSkipped}`);
  }

  const finalCount = db.db.prepare('SELECT COUNT(*) AS c FROM wb_market_products').get().c;
  // 收尾：回填批次结果
  db.db.prepare(
    "UPDATE wb_collection_tasks SET status='done', success_count=?, finished_at=datetime('now') WHERE id=?"
  ).run(inserted, taskId);
  console.log(`=== 完成，本次新增 ${inserted} 件（同款跳过 ${dupSkipped} 件），总数 ${finalCount} 件 ===`);

  // 自动回填：把本次新增商品的需求/痛点/改造/跟卖补齐，再预筛并刷新列表页
  if (inserted > 0) {
    runStep('自动回填四维：抓取新品真实评价并重算六维', 'deepscore.js', ['--kept']);
    runStep('新店规则预筛', 'filter.js');
    runStep('重生成商品列表页', 'report.js');
  } else {
    console.log('本次无新增商品，跳过自动回填');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });