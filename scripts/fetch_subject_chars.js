/**
 * 拉取指定 subject 的合法特性清单，写入 data/wb_subject_chars.json
 * 发布时用这份缓存过滤特性，避免把玩具类特性塞进食盆/猫砂盆等类目。
 * 用法：node scripts/fetch_subject_chars.js
 */
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'wb_api_token.txt');
const OUT = path.join(__dirname, '..', 'data', 'wb_subject_chars.json');
const SUBJECTS = [731, 874, 941, 942, 1125, 1126, 1121, 3235, 726, 729, 730, 728, 735, 3318, 1007, 932,
  3263, 2911, 3241, 5799, 3480, 1071, 1118, 4626, 8540];

(async () => {
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  const out = {};
  for (const sid of SUBJECTS) {
    const res = await fetch(`https://content-api.wildberries.ru/content/v2/object/charcs/${sid}?locale=ru`, {
      headers: { Authorization: token },
    });
    const j = await res.json().catch(() => ({}));
    const list = (j.data || []).map((c) => ({ id: c.charcID, name: c.name, required: !!c.required }));
    out[sid] = list;
    console.log(`${sid}: ${list.length} 个特性，必填 ${list.filter((x) => x.required).map((x) => x.name).join(', ') || '无'}`);
    await new Promise((r) => setTimeout(r, 700));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('已写入 ' + OUT);
})();
