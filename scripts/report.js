/**
 * WB 选品工具 - 商品列表页面生成脚本
 * 用法：node scripts/report.js
 * 从 wb_market_products 读取数据，生成自包含的可排序/可筛选 HTML 列表页，
 * 每件商品带「粘贴1688」按钮：弹框粘贴工具导出的 JSON → POST 到本地服务落库采购成本。
 * 注意：粘贴落库需要本地服务运行（node scripts/server.js），请通过 http://localhost:8901 访问本页。
 */
const WbDatabase = require('../src/db/database');
const { fitName } = require('../src/api/wbPublish');
const path = require('path');
const fs = require('fs');

const db = new WbDatabase().init();
const rows = db.db.prepare(`
  SELECT wb_nm_id, title, category, keyword, url, image_url, price, old_price, rating, review_count, brand, seller_name,
         purchase_cost, shipping_cost, source_weight, source_length, source_width, source_height,
         conversion_score, competition_score, demand_score, pain_score, improve_score, follow_score,
         sixdim_total, sixdim_missing, review_sample, review_neg, review_recent30, brand_share, demand_proxy, pain_json,
         head_leg_cny, ogl_channel, suggest_price, suggest_margin,
         collect_task_id, market_supply,
         datetime(created_at, '+8 hours') AS collected_at,
         (SELECT datetime(t.started_at, '+8 hours') FROM wb_collection_tasks t WHERE t.id = wb_market_products.collect_task_id) AS batch_at
  FROM wb_market_products
  WHERE excluded = 0
  ORDER BY review_count DESC
`).all();

const excludedCount = db.db.prepare('SELECT COUNT(*) AS c FROM wb_market_products WHERE excluded = 1').get().c;

const total = rows.length;
const avgPrice = total ? (rows.reduce((s, r) => s + (r.price || 0), 0) / total) : 0;
const avgRating = total ? (rows.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0;
const hasDiscount = rows.filter(r => r.old_price > r.price).length;

const data = rows.map(r => ({
  id: r.wb_nm_id,
  title: r.title,
  cat: r.category || '',
  kw: r.keyword || '',
  url: r.url || '',
  img: r.image_url || '',
  price: r.price || 0,
  old: r.old_price || 0,
  disc: (r.old_price && r.old_price > r.price) ? Math.round((1 - r.price / r.old_price) * 100) : 0,
  rating: r.rating || 0,
  reviews: r.review_count || 0,
  brand: r.brand || '',
  seller: r.seller_name || '',
  cost: r.purchase_cost || 0,
  // WB 卡名（≤60 字符，发布/表格导入时用这个，不再用采集标题）
  cardName: fitName(r.title, r.source_length, r.source_width, r.source_height),
  ship: r.shipping_cost || 0,
  sweight: r.source_weight || 0,
  sixdim: r.sixdim_total || 0,
  conversion: r.conversion_score || 0,
  competition: r.competition_score || 0,
  demand: r.demand_score || 0,
  pain: r.pain_score || 0,
  improve: r.improve_score || 0,
  follow: r.follow_score || 0,
  headLeg: r.head_leg_cny || 0,
  channel: r.ogl_channel || '',
  sug: r.suggest_price || 0,
  margin: r.suggest_margin || 0,
  sixdimMissing: r.sixdim_missing || '',
  reviewSample: r.review_sample || 0,
  reviewNeg: r.review_neg || 0,
  recent30: r.review_recent30 || 0,
  demandProxy: r.demand_proxy || 0,
  brandShare: r.brand_share || 0,
  at: r.collected_at || '',
  supply: r.market_supply || 0,
  batchId: r.collect_task_id || 0,
  batchAt: r.batch_at || '',
  pains: (() => {
    try { return JSON.parse(r.pain_json || '[]').slice(0, 4).map(p => p.label + '(' + p.count + ')'); }
    catch (e) { return []; }
  })()
}));

const categories = [...new Set(data.map(d => d.cat).filter(Boolean))].sort();

// 采集批次：每次采集单独成组（批次号 + 开始时间）；无批次号的老数据按采集日期归为「历史批次」
data.forEach((d) => {
  d.batchKey = d.batchId > 0 ? 'T' + d.batchId : 'L' + d.at.slice(0, 10);
  d.batchLabel = d.batchId > 0
    ? '批次#' + d.batchId + ' · ' + (d.batchAt ? d.batchAt.slice(0, 16) : '—')
    : '历史批次 · ' + d.at.slice(0, 10);
});
const batchMap = new Map();
data.forEach((d) => {
  if (!batchMap.has(d.batchKey)) {
    batchMap.set(d.batchKey, { key: d.batchKey, label: d.batchLabel, at: d.batchAt || d.at, count: 0 });
  }
  batchMap.get(d.batchKey).count++;
});
const batches = [...batchMap.values()].sort((a, b) => b.at.localeCompare(a.at));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WB</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #fff; --border: #e3e6ea; --muted: #7d8590;
    --accent: #cb11ab; --accent2: #2f80ed;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: #1f2328; }
  header {
    position: sticky; top: 0; z-index: 10; background: #fff;
    border-bottom: 1px solid var(--border); padding: 14px 20px;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
  }
  header h1 { margin: 0 0 10px; font-size: 20px; }
  .stats { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .stats b { color: #1f2328; font-size: 15px; }
  .toolbar {
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    padding: 12px 20px;
  }
  .toolbar input, .toolbar select {
    padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
    font-size: 13px; background: #fff; outline: none;
  }
  .toolbar input { flex: 1; min-width: 220px; }
  .toolbar input:focus, .toolbar select:focus { border-color: var(--accent); }
  .count { color: var(--muted); font-size: 13px; margin-left: auto; }
  table { width: 100%; border-collapse: collapse; background: var(--card); }
  thead th {
    position: sticky; top: 118px; background: #fafbfc; text-align: left;
    font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .02em;
    padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer;
    user-select: none; white-space: nowrap;
  }
  thead th:hover { color: var(--accent); }
  thead th .arrow { font-size: 10px; margin-left: 3px; }
  thead th.nosort { cursor: default; }
  thead th.nosort:hover { color: var(--muted); }
  tbody td { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
  tbody tr:hover { background: #faf7fc; }
  .t-img { width: 140px; }
  .t-img img { width: 130px; height: 130px; object-fit: cover; border-radius: 8px; background: #eee; display: block; }
  .t-title { max-width: 380px; }
  .t-title a { color: #1f2328; text-decoration: none; font-weight: 500; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .t-title a:hover { color: var(--accent); }
  .t-title .brand { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .price { font-weight: 700; color: #1f2328; }
  .old { text-decoration: line-through; color: var(--muted); font-size: 12px; display: block; }
  .disc { color: #e0357a; font-weight: 700; }
  .rating { font-weight: 600; }
  .reviews { color: var(--muted); font-size: 12px; display: block; white-space: nowrap; }
  .cat-pill { display: inline-block; padding: 3px 9px; background: #f0e9fb; color: #6b3fb0; border-radius: 20px; font-size: 11px; white-space: nowrap; }
  .khw { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .note { font-size: 12px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
  .empty { text-align: center; padding: 60px; color: var(--muted); }

  /* ———— 1688 粘贴导入 ———— */
  .btn1688 { padding: 5px 10px; border-radius: 8px; border: 1px solid var(--accent); background: #fff; color: var(--accent); cursor: pointer; font-size: 12px; white-space: nowrap; }
  .btn1688:hover { background: #fbebf7; }
  .btn1688.has { background: #efe7fb; color: #6b3fb0; border-color: #d9c5ef; }
  /* 卡名复制（WB 名称上限 60 字符） */
  .btnCard { margin-top: 4px; padding: 2px 8px; border-radius: 6px; border: 1px dashed #c9c9d6; background: #fafafd; color: #4a4a63; cursor: pointer; font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btnCard:hover { border-color: var(--accent2); color: var(--accent2); }
  #modal { display: none; position: fixed; inset: 0; z-index: 100; align-items: center; justify-content: center; }
  #modal.show { display: flex; }
  .modal-mask { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
  .modal-box { position: relative; background: #fff; border-radius: 12px; width: min(720px, 92vw); padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,.3); display: flex; flex-direction: column; gap: 12px; }
  .modal-box h3 { margin: 0; font-size: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .modal-box h3 .mt { color: var(--muted); font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .modal-close { cursor: pointer; border: none; background: none; font-size: 22px; line-height: 1; color: var(--muted); }
  #mInput { width: 100%; height: 220px; border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-family: Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.5; resize: vertical; outline: none; }
  #mInput:focus { border-color: var(--accent); }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; }
  .modal-actions button { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: #fff; cursor: pointer; font-size: 13px; }
  #mSave { background: var(--accent); color: #fff; border-color: var(--accent); }
  #mSave:disabled { opacity: .6; cursor: default; }
  .msg { font-size: 12px; margin: 0; min-height: 16px; }
  .msg.ok { color: #0a8f4d; }
  .msg.err { color: #d0342c; }

  /* ———— WB 发布 ———— */
  .btnPub { padding: 5px 10px; border-radius: 8px; border: 1px solid var(--accent2); background: #fff; color: var(--accent2); cursor: pointer; font-size: 12px; white-space: nowrap; }
  .btnPub:hover { background: #eaf3ff; }
  .btnPub.done { background: #eaf3ff; color: #1a63c0; }
  #pubModal { display: none; position: fixed; inset: 0; z-index: 100; align-items: center; justify-content: center; }
  #pubModal.show { display: flex; }
  #pubModal .modal-box { width: min(860px, 94vw); max-height: 90vh; }
  #pubPreview { background: #0f1419; color: #d7e2ee; border-radius: 8px; padding: 14px; font-family: Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 52vh; overflow: auto; margin: 0; }
  .pub-note { font-size: 12px; color: var(--muted); margin: 0; }
</style>
</head>
<body>
<header>
  <h1>WB</h1>
  <div class="stats">
    <span>商品总数 <b>${total}</b></span>
    <span>采集批次 <b>${batches.length}</b></span>
    <span>已排除 <b>${excludedCount}</b></span>
    <span>平均评分 <b>${avgRating.toFixed(2)}</b></span>
    <span>平均售价 <b>₽${avgPrice.toFixed(0)}</b></span>
    <span>有折扣 <b>${hasDiscount}</b></span>
  </div>
  <div class="note">六维分（满分100）= 需求 + 转化 + 竞争 + 痛点 + 改造 + 跟卖｜需求为<b>代理值</b>（同关键词近30天评价增量，非搜索量）；竞争为 <b>WB 该词搜索结果总数</b>（真实供给量）；痛点/改造来自 WB 真实差评（规则分类）；跟卖为同词头部品牌评论占比。</div>
</header>

<div class="toolbar">
  <input id="q" type="text" placeholder="搜索标题 / 品牌 / 卖家 / nmID ...">
  <select id="catSel"><option value="">全部类目</option>${categories.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
  <select id="batchSel"><option value="">全部批次</option>${batches.map(b => `<option value="${b.key}">${b.label}（${b.count}件）</option>`).join('')}</select>
  <span class="count" id="cnt"></span>
</div>

<table>
  <thead>
    <tr>
      <th></th>
      <th data-key="title">标题 <span class="arrow"></span></th>
      <th data-key="price" class="num">价格 <span class="arrow"></span></th>
      <th data-key="disc" class="num">折扣 <span class="arrow"></span></th>
      <th data-key="rating" class="num">评分 <span class="arrow"></span></th>
      <th data-key="reviews" class="num">评论数 <span class="arrow"></span></th>
      <th data-key="cat">类目 <span class="arrow"></span></th>
      <th data-key="kw">关键词 <span class="arrow"></span></th>
      <th data-key="at" class="num">采集时间 <span class="arrow"></span></th>
      <th data-key="pain" class="num">痛点 <span class="arrow"></span></th>
      <th data-key="sixdim" class="num">六维分 <span class="arrow"></span></th>
      <th data-key="headLeg" class="num">头程 <span class="arrow"></span></th>
      <th data-key="sug" class="num">建议售价 <span class="arrow"></span></th>
      <th class="nosort">1688 货源</th>
      <th class="nosort">发布</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>
<div class="empty" id="empty" style="display:none">未找到匹配商品</div>

<!-- 1688 粘贴导入弹框 -->
<div id="modal">
  <div class="modal-mask" id="mMask"></div>
  <div class="modal-box">
    <h3>
      <span>粘贴 1688 商品数据</span>
      <span class="mt" id="mTitle"></span>
      <button class="modal-close" id="mClose" title="关闭">×</button>
    </h3>
    <textarea id="mInput" placeholder="把 1688 采集工具导出的商品 JSON 粘贴到这里（含 title / cost / packagingInfo / sourceUrl）"></textarea>
    <div class="modal-actions">
      <span class="msg" id="mMsg"></span>
      <button id="mCancel">取消</button>
      <button id="mSave">保存并落库</button>
    </div>
  </div>
</div>

<!-- WB 发布预览弹框 -->
<div id="pubModal">
  <div class="modal-mask" id="pmMask"></div>
  <div class="modal-box">
    <h3>
      <span>发布到 WB（预览）</span>
      <span class="mt" id="pmTitle"></span>
      <button class="modal-close" id="pmClose" title="关闭">×</button>
    </h3>
    <p class="pub-note" id="pmNote"></p>
    <pre id="pubPreview"></pre>
    <div class="modal-actions">
      <span class="msg" id="pmMsg"></span>
      <button id="pmCancel">取消</button>
      <button id="pmUpload">一键发布到 WB</button>
    </div>
  </div>
</div>

<script>
  const DATA = ${JSON.stringify(data)};
  let sortKey = 'pinned', sortDir = -1;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function render() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const cat = document.getElementById('catSel').value;
    const batch = document.getElementById('batchSel').value;
    let list = DATA.filter(d => {
      if (cat && d.cat !== cat) return false;
      if (batch && d.batchKey !== batch) return false;
      if (q) {
        const hay = (d.title + ' ' + d.brand + ' ' + d.seller + ' ' + d.id).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      // 默认排序（pinned）：已算出建议售价的商品置顶，组内按评论数从多到少
      if (sortKey === 'pinned') {
        const pa = a.sug > 0 ? 1 : 0;
        const pb = b.sug > 0 ? 1 : 0;
        return (pb - pa) || (b.reviews - a.reviews);
      }
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });

    const tbody = document.getElementById('tbody');
    document.getElementById('cnt').textContent = '显示 ' + list.length + ' / ' + DATA.length + ' 件';
    document.getElementById('empty').style.display = list.length ? 'none' : 'block';

    tbody.innerHTML = list.map(d => {
      const disc = d.disc > 0 ? '<span class="disc">-' + d.disc + '%</span>' : '<span class="disc" style="color:var(--muted)">—</span>';
      const img = d.img
        ? '<img src="' + d.img + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility=\\'hidden\\'">'
        : '';
      const brand = d.brand ? '<span class="brand">' + d.brand + (d.seller ? ' · ' + d.seller : '') + '</span>' : '';
      const url = d.url || 'https://www.wildberries.ru/catalog/' + d.id + '/detail.aspx';
      const painTop = (d.pains && d.pains.length) ? d.pains.slice(0, 2).join('、') : '';
      const painTitle = d.reviewSample > 0
        ? '评价样本 ' + d.reviewSample + ' 条｜差评(1~3星) ' + d.reviewNeg + ' 条｜近30天新增评价 ' + d.recent30 + ' 条'
        : '未抓到评价数据（card/feedbacks 未命中）';
      const miss = (d.sixdimMissing || '').split(',').filter(Boolean);
      const dv = (k, v) => (miss.indexOf(k) >= 0 ? '待补' : v);
      const sixTitle = '六维明细（满分100）' + NL
        + '需求 ' + dv('demand', d.demand) + (miss.indexOf('demand') >= 0 ? '' : '（代理：同词近30天评价 ' + d.demandProxy + ' 条）') + NL
        + '转化 ' + dv('conversion', d.conversion) + ' / 15' + NL
        + '竞争 ' + dv('competition', d.competition) + ' / 15（WB 搜索供给 ' + (d.supply ? d.supply.toLocaleString('ru-RU') + ' 件' : '未取到') + '）' + NL
        + '痛点 ' + dv('pain', d.pain) + ' / 20' + NL
        + '改造 ' + dv('improve', d.improve) + ' / 20' + NL
        + '跟卖 ' + dv('follow', d.follow) + ' / 10（头部品牌占比 ' + (d.brandShare ? Math.round(d.brandShare * 100) : 0) + '%）';
      const actBtn = d.cost > 0
        ? '<button class="btn1688 has" data-id="' + d.id + '" title="已导入采购成本，点击可覆盖">¥' + d.cost + ' 已采</button>'
        : '<button class="btn1688" data-id="' + d.id + '">粘贴1688</button>';
      const cardCopy = d.cost > 0
        ? '<button class="btnCard" data-card="' + esc(d.cardName) + '" title="WB 名称（≤60 字符），点一下复制：' + esc(d.cardName) + '">卡名 ' + d.cardName.length + ' 字符 ⧉ 复制</button>'
        : '';
      return '<tr>' +
        '<td class="t-img">' + img + '</td>' +
        '<td class="t-title"><a href="' + url + '" target="_blank" rel="noopener">' + d.title + '</a>' + brand + cardCopy + '</td>' +
        '<td class="num"><span class="price">₽' + d.price.toLocaleString('ru-RU') + '</span>' + (d.old > d.price ? '<span class="old">₽' + d.old.toLocaleString('ru-RU') + '</span>' : '') + '</td>' +
        '<td class="num">' + disc + '</td>' +
        '<td class="num"><span class="rating">' + (d.rating ? d.rating.toFixed(1) : '—') + '</span></td>' +
        '<td class="num"><span class="reviews">' + d.reviews.toLocaleString('ru-RU') + '</span></td>' +
        '<td><span class="cat-pill">' + (d.cat || '—') + '</span></td>' +
        '<td class="khw">' + d.kw + '</td>' +
        '<td class="num khw" title="' + esc(d.batchLabel) + '">' + (d.at ? d.at.slice(5, 16) : '—') + (d.batchId > 0 ? '<span class="reviews">批次#' + d.batchId + '</span>' : '<span class="reviews">历史</span>') + '</td>' +
        '<td class="num" title="' + esc(painTitle) + '">' + (d.pain > 0 ? '<b>' + d.pain + '</b>' : '—') + (painTop ? '<span class="reviews">' + esc(painTop) + '</span>' : '') + '</td>' +
        '<td class="num" title="' + esc(sixTitle) + '">' + (d.sixdim > 0 ? '<b>' + d.sixdim + '</b>' : '—') + (miss.length ? '<span class="reviews" title="缺失:' + esc(d.sixdimMissing) + '">／待补</span>' : '') + '</td>' +
        '<td class="num" title="DPX 头程 / 档位 / 计费重">' + (d.headLeg > 0 ? '<b>¥' + d.headLeg + '</b><span class="reviews">' + esc(d.channel || '') + '</span>' : '—') + '</td>' +
        '<td class="num" title="按目标毛利率反推的建议售价">' + (d.sug > 0 ? '<b>₽' + d.sug.toLocaleString('ru-RU') + '</b><span class="reviews">毛利 ' + Math.round((d.margin || 0) * 100) + '%</span>' : '—') + '</td>' +
        '<td class="t-act">' + actBtn + '</td>' +
        '<td class="t-act"><button class="btnPub" data-id="' + d.id + '">生成发布信息</button></td>' +
        '</tr>';
    }).join('');
  }

  document.querySelectorAll('thead th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (sortKey === k) { sortDir *= -1; } else { sortKey = k; sortDir = (k === 'title' || k === 'cat' || k === 'kw') ? 1 : -1; }
      document.querySelectorAll('thead th .arrow').forEach(a => a.textContent = '');
      th.querySelector('.arrow').textContent = sortDir === 1 ? '▲' : '▼';
      render();
    });
  });

  document.getElementById('q').addEventListener('input', render);
  document.getElementById('catSel').addEventListener('change', render);
  document.getElementById('batchSel').addEventListener('change', render);

  // ———— 1688 粘贴导入 ————
  const modal = document.getElementById('modal');
  const mInput = document.getElementById('mInput');
  const mMsg = document.getElementById('mMsg');
  const mTitle = document.getElementById('mTitle');
  const mSave = document.getElementById('mSave');
  let curId = null;

  function open1688(id) {
    curId = id;
    const item = DATA.find(d => String(d.id) === String(id));
    mTitle.textContent = item ? ('[' + item.id + '] ' + item.title) : '';
    mInput.value = '';
    mMsg.className = 'msg'; mMsg.textContent = '';
    modal.classList.add('show');
    mInput.focus();
  }
  function close1688() { modal.classList.remove('show'); curId = null; }

  document.getElementById('tbody').addEventListener('click', (e) => {
    const card = e.target.closest('.btnCard');
    if (card) {
      const txt = card.dataset.card || '';
      const done = () => { const old = card.textContent; card.textContent = '已复制：' + txt.slice(0, 24) + (txt.length > 24 ? '…' : ''); setTimeout(() => { card.textContent = old; }, 1200); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
      else done();
      return;
    }
    const btn = e.target.closest('.btn1688');
    if (btn) open1688(btn.dataset.id);
  });
  document.getElementById('mCancel').addEventListener('click', close1688);
  document.getElementById('mMask').addEventListener('click', close1688);
  document.getElementById('mClose').addEventListener('click', close1688);

  mSave.addEventListener('click', () => {
    const raw = mInput.value.trim();
    if (!raw) { mMsg.className = 'msg err'; mMsg.textContent = '请先粘贴 1688 商品 JSON'; return; }
    let data;
    try { data = JSON.parse(raw); } catch (e) { mMsg.className = 'msg err'; mMsg.textContent = 'JSON 格式错误：' + e.message; return; }
    mSave.disabled = true; mSave.textContent = '保存中...';
    fetch('/api/1688/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nm_id: curId, data })
    })
    .then(r => r.json())
    .then(res => {
      mSave.disabled = false; mSave.textContent = '保存并落库';
      if (res.ok) {
        const n = res.norm || {};
        const p = res.pricing || {};
        mMsg.className = 'msg ok';
        let msg = '已落库：采购 ¥' + n.total + '，重量 ' + (n.weight || 0) + 'g，尺寸 ' + (n.len || 0) + '*' + (n.wid || 0) + '*' + (n.hei || 0) + 'cm';
        if (p.ok) msg += '；头程 ¥' + p.headLegCny + '（' + p.channel + '），建议售价 ₽' + p.suggestPriceRub + '（毛利 ' + Math.round((p.margin || 0) * 100) + '%）';
        mMsg.textContent = msg;
        const btn = document.querySelector('.btn1688[data-id="' + curId + '"]');
        if (btn) { btn.classList.add('has'); btn.textContent = '¥' + n.total + ' 已采'; }
        const item = DATA.find(d => String(d.id) === String(curId));
        if (item) {
          item.cost = n.total; item.sweight = n.weight;
          if (p.ok) { item.headLeg = p.headLegCny; item.channel = p.channel; item.sug = p.suggestPriceRub; item.margin = p.margin; }
        }
        render();
      } else {
        mMsg.className = 'msg err'; mMsg.textContent = res.error || '导入失败';
      }
    })
    .catch(err => {
      mSave.disabled = false; mSave.textContent = '保存并落库';
      mMsg.className = 'msg err'; mMsg.textContent = '请求失败：' + err.message + '（请确认本地服务已启动 node scripts/server.js）';
    });
  });

  // ———— WB 发布 ————
  const pubModal = document.getElementById('pubModal');
  const pubPreview = document.getElementById('pubPreview');
  const pmMsg = document.getElementById('pmMsg');
  const pmTitle = document.getElementById('pmTitle');
  const pmNote = document.getElementById('pmNote');
  const pmUpload = document.getElementById('pmUpload');
  let pubId = null;
  const NL = String.fromCharCode(10);

  function openPublish(id) {
    pubId = id;
    const item = DATA.find(d => String(d.id) === String(id));
    pmTitle.textContent = item ? ('[' + item.id + '] ' + item.title) : '';
    pmNote.textContent = '图片：采集主图 1 张（视频留空）。请核对俄文标题/描述/特性后点发布。';
    pmMsg.className = 'msg'; pmMsg.textContent = '生成中...';
    pubPreview.textContent = '';
    pmUpload.disabled = true;
    pubModal.classList.add('show');
    fetch('/api/wb/publish/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nm_id: id })
    })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        const d = res.draft;
        const vs = Array.isArray(d.variants) ? d.variants : [];
        const v = vs[0] || {};
        const dim = v.dimensions || {};
        const imgs = v.images || [];
        const chars = v.characteristics || [];
        const num = (x) => (x != null ? x : '—');
        pmMsg.className = 'msg'; pmMsg.textContent = '';
        pubPreview.textContent = '标题：' + d.title + NL + NL + '描述：' + NL + d.description + NL + NL +
          '规格数：' + (d.variantCount || vs.length) + NL +
          '尺寸：' + num(dim.length) + '×' + num(dim.width) + '×' + num(dim.height) + 'cm' + NL +
          '图片：' + (imgs.length ? imgs.length + ' 张（采集主图）' : '无') + NL +
          '特性（' + chars.length + ' 项）：' + NL +
          chars.map(c => '  · ' + c.id + ' → ' + JSON.stringify(c.value)).join(NL);
        pmUpload.disabled = false;
      } else {
        pmMsg.className = 'msg err'; pmMsg.textContent = res.error || '生成失败';
      }
    })
    .catch(err => { pmMsg.className = 'msg err'; pmMsg.textContent = '请求失败：' + err.message; });
  }
  function closePublish() { pubModal.classList.remove('show'); pubId = null; }

  pmUpload.addEventListener('click', () => {
    if (!pubId) return;
    pmUpload.disabled = true; pmUpload.textContent = '发布中...';
    pmMsg.className = 'msg'; pmMsg.textContent = '正在提交到 WB...';
    fetch('/api/wb/publish/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nm_id: pubId })
    })
    .then(r => r.json())
    .then(res => {
      pmUpload.disabled = false; pmUpload.textContent = '一键发布到 WB';
      if (res.ok) {
        pmMsg.className = 'msg ok'; pmMsg.textContent = '发布成功：' + JSON.stringify(res.body || res);
        const btn = document.querySelector('.btnPub[data-id="' + pubId + '"]');
        if (btn) { btn.classList.add('done'); btn.textContent = '已发布'; }
      } else {
        pmMsg.className = 'msg err'; pmMsg.textContent = '发布失败：' + (res.error || JSON.stringify(res.body || res)).slice(0, 400);
      }
    })
    .catch(err => {
      pmUpload.disabled = false; pmUpload.textContent = '一键发布到 WB';
      pmMsg.className = 'msg err'; pmMsg.textContent = '请求失败：' + err.message;
    });
  });

  document.getElementById('tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('.btnPub');
    if (btn) openPublish(btn.dataset.id);
  });
  document.getElementById('pmCancel').addEventListener('click', closePublish);
  document.getElementById('pmMask').addEventListener('click', closePublish);
  document.getElementById('pmClose').addEventListener('click', closePublish);

  render();
</script>
</body>
</html>`;

const outPath = path.join(__dirname, '../WB商品列表.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('已生成:', outPath);
console.log('商品数:', total, '| 平均评分:', avgRating.toFixed(2), '| 平均售价: ₽' + avgPrice.toFixed(0));