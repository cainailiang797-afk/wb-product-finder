/**
 * 第 1 步（一次性）：建立 1688 登录会话
 * 运行：node scripts/1688_login.js
 * 弹出 Chromium 窗口打开 1688 登录页；在窗口里扫码/账密登录，
 * 登录成功后【手动关闭】窗口，登录态保存在持久 profile，之后自动复用。
 */
const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = process.env.ALI1688_PROFILE || path.join(__dirname, '..', 'data', 'ali1688_profile');

(async () => {
  console.log('打开 1688 登录窗口（将弹出独立 Chromium）...');
  console.log('登录态将保存在:', PROFILE_DIR);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1360, height: 900 }
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://login.1688.com/member/signin.htm', { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('请在弹窗中扫码/登录 1688，登录成功后把窗口【手动关闭】。');
  const browser = context.browser();
  await new Promise(resolve => browser.once('disconnected', resolve));
  console.log('登录态已保存。现在可运行 node scripts/bridge1688.js --import 抓取采购成本。');
  process.exit(0);
})().catch(e => { console.error('登录脚本异常:', e.message); process.exit(1); });