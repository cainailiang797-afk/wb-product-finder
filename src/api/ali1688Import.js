/**
 * 1688 工具导出数据 → WB 商品落库（公共逻辑）
 * 供 CLI（scripts/bridge1688.js）与 Web 服务（scripts/server.js）复用，
 * 保证「normalize → 落库」字段口径一致。
 */

// 工具导出字段常被反引号包裹、价格是字符串，这里统一清洗
function clean(s) { return String(s || '').replace(/^`|`$/g, '').trim(); }
function num(v) { const n = parseFloat(clean(v)); return isFinite(n) ? n : 0; }

/**
 * 规范化 1688 工具导出的 JSON（title/cost/packagingInfo/sourceUrl）
 * @returns {{title:string, unitPrice:number, freight:number, total:number,
 *            weight:number, len:number, wid:number, hei:number,
 *            offerId:string, sourceUrl:string}}
 */
function normalize1688Data(body) {
  const cost = (body && body.cost) || {};
  const unitPrice = num(cost.unitPrice) || num(body && body.unitPrice);
  const freight = num(cost.freight) || num(body && body.freight);
  const total = num(cost.total) || (unitPrice + freight);

  const pkg = Array.isArray(body && body.packagingInfo) ? body.packagingInfo[0] : null;
  const weight = pkg ? num(pkg['重量(g)'] || pkg['重量']) : 0;
  const len = pkg ? num(pkg['长(cm)'] || pkg['长']) : 0;
  const wid = pkg ? num(pkg['宽(cm)'] || pkg['宽']) : 0;
  const hei = pkg ? num(pkg['高(cm)'] || pkg['高']) : 0;
  const offerId = (String((body && body.sourceUrl) || '').match(/\/offer\/(\d+)/) || [])[1] || '';

  return {
    title: clean(body && body.title),
    unitPrice, freight, total,
    weight, len, wid, hei,
    offerId,
    sourceUrl: clean(body && body.sourceUrl)
  };
}

/**
 * 将规范化结果写入指定 WB 商品（按 nmID 定位），只落采购成本 + 物理规格
 * @param {WbDatabase} db - 已 init 的数据库实例
 * @param {number|string} nmId
 * @param {object} norm - normalize1688Data 的返回
 * @returns {{ok:true, row:object, norm:object} | {ok:false, error:string}}
 */
function saveToProduct(db, nmId, norm, rawBody) {
  if (!norm || norm.total <= 0) {
    return { ok: false, error: '未解析出有效采购价（unitPrice/freight/total 均为空）' };
  }
  const row = db.db.prepare(
    'SELECT id, wb_nm_id, title FROM wb_market_products WHERE wb_nm_id = ?'
  ).get(Number(nmId));
  if (!row) {
    return { ok: false, error: 'WB 库中不存在 nmID=' + nmId + ' 的商品' };
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const round1 = (v) => Math.round(v * 10) / 10;
  // 保存完整原始 JSON（含 attributes/images），供后续发布建卡读取
  const srcJson = rawBody ? JSON.stringify(rawBody) : '';
  db.db.prepare(
    "UPDATE wb_market_products SET purchase_cost = ?, shipping_cost = ?, source_weight = ?, source_length = ?, source_width = ?, source_height = ?, source_1688_json = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    round2(norm.total), round2(norm.freight),
    round1(norm.weight), round1(norm.len), round1(norm.wid), round1(norm.hei),
    srcJson,
    row.id
  );
  return { ok: true, row, norm };
}

module.exports = { normalize1688Data, saveToProduct, clean, num };