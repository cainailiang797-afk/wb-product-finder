/**
 * WB 商品列表本地服务
 * 用法：node scripts/server.js
 * 启动后浏览器访问 http://localhost:8901 打开列表页，
 * 点击每件商品的「粘贴1688」按钮，弹框粘贴工具导出的 JSON，落库采购成本。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WbDatabase = require('../src/db/database');
const { normalize1688Data, saveToProduct } = require('../src/api/ali1688Import');
const { computePricing } = require('../src/api/wbPricing');
const { buildDraft, submit, setPrice, setStock, getToken, PUBLISH_DEFAULTS } = require('../src/api/wbPublish');

const PORT = Number(process.env.PORT) || 8901;
const HTML_PATH = path.join(__dirname, '..', 'WB商品列表.html');

const db = new WbDatabase().init();

// 数据落库后重生成列表页 HTML（防抖 400ms），刷新页面即可看到最新头程/建议售价
let regenTimer = null;
function scheduleRegen() {
  if (regenTimer) clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    regenTimer = null;
    spawn(process.execPath, [path.join(__dirname, 'report.js')], { stdio: 'ignore' }).unref();
  }, 400);
}

// 新建卡同步最长 30 分钟，这期间价格/库存会写不进去：发布后后台每分钟重试，最长 40 分钟
function retryPriceStock(nmId, opts, sku, priceRes, stockRes) {
  if (!nmId) return;
  let needPrice = opts.priceCny > 0 && !(priceRes && priceRes.ok);
  let needStock = Boolean(sku) && opts.stock > 0 && !(stockRes && stockRes.ok);
  if (!needPrice && !needStock) return;
  const endAt = Date.now() + 40 * 60 * 1000;
  const tick = async () => {
    try {
      if (needPrice) {
        const r = await setPrice(getToken(), nmId, opts.priceCny, opts.discount);
        if (r.ok) needPrice = false;
      }
      if (needStock) {
        const r = await setStock(getToken(), opts.warehouseId || PUBLISH_DEFAULTS.warehouseId, sku, opts.stock);
        if (r.ok) needStock = false;
      }
    } catch (e) {}
    if ((needPrice || needStock) && Date.now() < endAt) setTimeout(tick, 60 * 1000).unref();
  };
  setTimeout(tick, 60 * 1000).unref();
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/1688/import') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const payload = JSON.parse(raw || '{}');
        const nmId = payload.nm_id;
        let data = payload.data;
        if (typeof data === 'string') data = JSON.parse(data);
        const norm = normalize1688Data(data);
        const result = saveToProduct(db, nmId, norm, data);
        if (result.ok) {
          // 按 WB-DPX 物流规则（实际重量 g，100g 向上取整）算头程，再按目标毛利率反推建议售价
          const cfg = db.getCostConfig();
          const pricing = computePricing({
            purchaseCostCny: norm.total,
            weightG: norm.weight > 0 ? norm.weight : 0,
            config: cfg,
          });
          if (pricing.ok) {
            db.db.prepare(
              "UPDATE wb_market_products SET head_leg_cny = ?, ogl_channel = ?, suggest_price = ?, suggest_margin = ?, updated_at = datetime('now') WHERE wb_nm_id = ?"
            ).run(pricing.headLegCny, pricing.channel, pricing.suggestPriceRub, pricing.margin, Number(nmId));
          }
          result.pricing = pricing;
          scheduleRegen();
        }
        res.end(JSON.stringify(result));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: '解析失败：' + e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/wb/publish/preview') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const payload = JSON.parse(raw || '{}');
        res.end(JSON.stringify(buildDraft(db, payload.nm_id)));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/wb/publish/upload') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const payload = JSON.parse(raw || '{}');
        const d = buildDraft(db, payload.nm_id);
        if (!d.ok) { res.end(JSON.stringify(d)); return; }
        // 建议售价是卢布，WB 店铺币种是 CNY：按成本配置汇率折算；折前价 = 折后价 × 1.3（23% 折扣）
        const row = db.db.prepare('SELECT suggest_price FROM wb_market_products WHERE wb_nm_id = ?').get(Number(payload.nm_id));
        const cfg = db.getCostConfig();
        const rate = cfg && cfg.currencyRate > 0 ? cfg.currencyRate : 12;
        const saleCny = row && row.suggest_price > 0 ? Math.round(row.suggest_price / rate) : 0;
        const opts = {
          priceCny: saleCny > 0 ? Math.round(saleCny * PUBLISH_DEFAULTS.markup) : 0,
          discount: PUBLISH_DEFAULTS.discount,
          warehouseId: PUBLISH_DEFAULTS.warehouseId,
          stock: PUBLISH_DEFAULTS.stock,
        };
        const result = await submit(d.draft, opts);
        // 建卡异步同步期内价格/库存可能写入失败，失败时交给后台重试
        retryPriceStock(result.nmID, opts, result.sku, result.price, result.stock);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(HTML_PATH, 'utf8', (err, html) => {
      if (err) { res.statusCode = 500; res.end('读取列表页失败：' + err.message); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    });
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('WB 列表服务已启动: http://localhost:' + PORT);
  console.log('打开后点击每件商品的「粘贴1688」按钮导入采购成本（Ctrl+C 停止）');
});