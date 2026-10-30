/**
 * 1688 登录态抓取（WB 独立版，路线 B）
 * 用 Playwright 持久 profile 保持 1688 登录态：
 *   - 第 1 次：运行 scripts/1688_login.js 弹出浏览器，手动扫码/账密登录，关闭浏览器
 *   - 之后：bridge1688.js 的 --import 调用本模块，用同一 profile 打开详情页，
 *           执行后取页面 HTML，喂给 ali1688Client.parseDetailHtml
 */
const path = require('path');
const { chromium } = require('playwright');
const Ali1688Client = require('./ali1688Client');

// 持久 profile 存放到项目 data 下，避免与默认 Chrome 冲突
const PROFILE_DIR = process.env.ALI1688_PROFILE || path.join(__dirname, '..', '..', 'data', 'ali1688_profile');
const HEADLESS = process.env.ALI1688_HEADLESS === '1';

let _ctx = null;

async function _getContext() {
  if (_ctx) return _ctx;
  _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1360, height: 900 },
    locale: 'zh-CN'
  });
  return _ctx;
}

function _isLoginPage(html) {
  return /login\.1688\.com|_____tmd_____|x5secdata|_config_.{0,80}"action"\s*:\s*"login"/i.test(html || '');
}

/**
 * 用持久 profile 打开 1688 详情页，等待渲染后取页面 HTML。
 * 已登录时能拿到真实价格/重量/尺寸。
 */
async function openDetailHtml(url) {
  const context = await _getContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    let html = await page.content();
    if (_isLoginPage(html)) {
      await page.waitForTimeout(3500);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2500);
      html = await page.content();
    }
    return { needLogin: _isLoginPage(html), html, url };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 抓取 1688 详情页并解析出采购成本/标题/重量/尺寸
 * @returns {Promise<{success:boolean, needLogin?:boolean, error?:string, offer_id?:string, ...info}>}
 */
async function fetchProductPlaywright(url) {
  const offerId = (String(url).match(/\/offer\/(\d+)/) || [])[1] || '';
  const r = await openDetailHtml(url);
  if (r.needLogin) {
    return { success: false, needLogin: true, offer_id: offerId, url, error: '尚未登录 1688。请先运行 node scripts/1688_login.js 扫码登录一次，再重试' };
  }
  const client = new Ali1688Client();
  const info = client.parseDetailHtml(r.html || '');
  if (!info.source_title && !info.source_price) {
    return { success: false, offer_id: offerId, url, error: '页面已打开但未能解析出价格（可能需登录或页面结构变化）' };
  }
  return { success: true, ...info, offer_id: offerId, source_url: url, source_type: '1688' };
}

async function close() { if (_ctx) { await _ctx.close().catch(() => {}); _ctx = null; } }

module.exports = { fetchProductPlaywright, openDetailHtml, PROFILE_DIR, close };