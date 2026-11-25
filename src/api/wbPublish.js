/**
 * WB 卖家 API 发布（Content API，content-api.wildberries.ru）
 * - 认证：Header `Authorization: <token>`（裸 token，不带 Bearer）
 * - 满分卡模板参考：data/wb_card_template_1947074699.json（subjectID 731 Игрушки для животных）
 * - buildDraft(db, nmId)：读「采集标题/主图 + 1688 完整 JSON」→ 生成建卡草稿。
 *   1688 的 packagingInfo 多规格只取体积最大的「大号」→ 单变体（WB 宠物玩具类目无尺寸规格维度，大/中/小无法合并）。
 * - submit(draft)：POST /content/v2/cards/upload 真正建卡（WB 已废弃 v3，会 404 path not found）
 *
 * 图片规则（用户约定）：暂只放一张「采集的商品主图」，视频留空；后续再替换为干净图。
 */
const fs = require('fs');
const path = require('path');

const HOST = 'https://content-api.wildberries.ru';
const PRICE_HOST = 'https://discounts-prices-api.wildberries.ru';
const MARKET_HOST = 'https://marketplace-api.wildberries.ru';
// 发布后自动补价格/库存的默认值（郑州仓库，库存 99；折扣前价 = 折后价 × 1.3，即 23% 折扣）
const PUBLISH_DEFAULTS = { warehouseId: 2307282, stock: 99, discount: 23, markup: 1.3 };
const TOKEN_FILE = path.join(__dirname, '..', '..', 'data', 'wb_api_token.txt');
const SUBJECT_ID = 731; // 兜底类目：Игрушки для животных

// ---------- 类目（subjectID）映射 ----------
// 所有 subjectID 均经 /content/v2/object/all 实测确认；判定顺序：俄文标题 → 中文标题 → 采集类目
const SUBJECT_RULES = [
  [/коврик для лотк/i, 2911],                                  // Коврики для лотков
  [/коврик под миск/i, 3241],                                  // Коврики под миску
  [/намордник/i, 1007],                                        // Намордники для животных
  [/шлейк|шлея/i, 730],                                        // Шлейки
  [/поводок|рулетк/i, 729],                                    // Поводки
  [/ошейник/i, 728],                                           // Ошейники
  [/пеленк/i, 932],                                            // Пеленки для животных
  [/комбинезон|костюм|куртк|платье|свитер|футболк|жилет|ботинк|носочк|шапк|дождевик/i, 735], // Комбинезоны
  [/переноск|рюкзак|сумка/i, 726],                             // Переноски для животных
  [/вольер|клетк|манеж|загон/i, 3318],                         // Вольеры
  [/лоток|туалет/i, 1125],                                     // Лотки для животных
  [/поилк|фонтан/i, 3235],                                     // Поилки для животных
  [/миск|чашк/i, 1126],                                        // Миски для животных
  [/кормушк/i, 1121],                                          // Кормушки для животных
  [/когтеточк|столбик для когтей|точилк/i, 874],               // Когтеточки
  [/домик/i, 942],                                             // Домики для животных
  [/лежанк|диван|кровать|пуф|кресл|матрас|гамак|бассейн|подстилк/i, 941], // Лежаки для животных
  [/когтерез/i, 1071],                                         // Когтерезки
  [/груминг|набор.*уход/i, 4626],                              // Наборы для груминга
  [/фурминатор|пуходерк|расческ|щетк|щётк|колтунорез|перчатк|рукавиц/i, 3480], // Расчески для животных
  [/игрушк|мяч|мышк|дразнилк|удочк|лазер|тоннель|канат/i, 731], // Игрушки для животных
];

// 中文标题兜底（采集商品的原始 1688 标题）
const CN_SUBJECT_RULES = [
  [/猫砂盆|猫厕所|砂盆|尿垫托|便盆/, 1125],
  [/猫抓板|抓柱|磨爪|猫爬架/, 874],
  [/牵引|胸背|项圈|嘴套|脖圈/, 728],
  [/猫包|背包|外出包|航空箱|推车|手提包/, 726],
  [/衣服|服装|雨衣|马甲|卫衣|棉衣/, 735],
  [/围栏|笼子|笼具|产房/, 3318],
  [/梳|刷|剪刀|指甲钳|剃毛|去毛|浮毛/, 3480],
  [/碗|食盆|餐台|饮水|水盆/, 1126],
  [/窝|垫|床|沙发|躺椅|睡垫/, 941],
  [/玩具|逗猫|球|老鼠|抓球/, 731],
];

// 采集类目兜底
const CATEGORY_SUBJECT = {
  '猫用品-抓板': 874, '狗用品-抓板': 874,
  '猫用品-玩具': 731, '狗用品-玩具': 731,
  '猫用品-窝': 941, '狗用品-窝': 941, '猫用品-沙发': 941,
  '猫用品-餐具': 1126, '狗用品-餐具': 1126,
  '猫用品-清洁': 1125, '宠物-厕所': 1125,
  '宠物-喂食器': 1121, '宠物-饮水': 3235,
  '猫用品-出行': 726, '狗用品-出行': 726,
  '狗用品-服饰': 735,
  '狗用品-项圈': 728,
  '宠物-笼具': 3318,
  '猫用品-护理': 3480, '狗用品-美容': 3480,
};

function resolveSubject(ruTitle, category, cnTitle) {
  const ru = String(ruTitle || '');
  for (const [re, sid] of SUBJECT_RULES) if (re.test(ru)) return sid;
  const cn = String(cnTitle || '');
  for (const [re, sid] of CN_SUBJECT_RULES) if (re.test(cn)) return sid;
  return CATEGORY_SUBJECT[category] || SUBJECT_ID;
}

// ---------- 各 subject 合法特性缓存（scripts/fetch_subject_chars.js 生成） ----------
let SUBJECT_CHARS = null;
function loadSubjectChars() {
  if (SUBJECT_CHARS) return SUBJECT_CHARS;
  try {
    SUBJECT_CHARS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'wb_subject_chars.json'), 'utf8'));
  } catch (e) {
    SUBJECT_CHARS = {};
  }
  return SUBJECT_CHARS;
}

// 过滤掉该 subject 不支持的字段（如把「Вид игрушки」塞进猫砂盆类目会导致无效字段）
function filterChars(chars, subjectID) {
  const allowed = loadSubjectChars()[subjectID];
  if (!allowed || !allowed.length) return chars;
  const ids = new Set(allowed.map((c) => c.id));
  return chars.filter((c) => ids.has(c.id));
}

// 尺寸量纲归一：1688 常把 mm 写成「345」这类值，最大边 ≥200 视为毫米，统一转 cm
function normalizeDims(length, width, height) {
  const arr = [Number(length) || 0, Number(width) || 0, Number(height) || 0];
  const max = Math.max(...arr);
  const converted = max >= 200 ? arr.map((x) => x / 10) : arr;
  return converted.map((x) => Math.round(x * 10) / 10);
}

// ---------- 中文 → 俄文 词库（猫用品垂直品类） ----------
const CN_RU = [
  // 颜色（值必须与 WB 颜色字典完全一致：小写、无 ё）
  ['复古', 'Ретро'], ['白色', 'белый'], ['黑色', 'черный'], ['蓝色', 'синий'],
  ['粉色', 'розовый'], ['绿色', 'зеленый'], ['红色', 'красный'], ['黄色', 'желтый'],
  ['灰色', 'серый'], ['棕色', 'коричневый'], ['米色', 'бежевый'], ['紫色', 'фиолетовый'],
  ['橙色', 'оранжевый'], ['橘色', 'оранжевый'], ['咖啡色', 'коричневый'], ['米白', 'бежевый'],
  ['藏青', 'синий'], ['天蓝', 'голубой'], ['湖蓝', 'бирюзовый'], ['酒红', 'красный'],
  ['墨绿', 'зеленый'], ['豹纹', 'коричневый'],
  // 材质（1688「材质/材料/手柄材质/顶部装饰材质」等字段与标题都会扫）
  ['瓦楞纸', 'Гофрокартон'], ['硬纸板', 'Картон'], ['纸质', 'Бумага'], ['剑麻', 'Сизаль'],
  ['毛绒', 'Плюш'], ['珊瑚绒', 'Плюш'], ['摇粒绒', 'Плюш'], ['天鹅绒', 'Велюр'],
  ['硅胶', 'Силикон'], ['塑料', 'Пластик'], ['木材', 'Дерево'], ['实木', 'Дерево'], ['松木', 'Дерево'],
  ['棉', 'Хлопок'], ['皮革', 'Экокожа'], ['生态皮革', 'Экокожа'], ['麻绳', 'Джут'],
  ['不锈钢', 'Нержавеющая сталь'], ['金属', 'Металл'], ['合金', 'Металл'], ['铁', 'Металл'], ['铝', 'Алюминий'],
  ['尼龙', 'Нейлон'], ['涤纶', 'Полиэстер'], ['牛津布', 'Оксфорд'], ['帆布', 'Холст'],
  ['亚克力', 'Акрил'], ['橡胶', 'Резина'], ['乳胶', 'Латекс'], ['陶瓷', 'Керамика'], ['玻璃', 'Стекло'],
  ['海绵', 'Поролон'], ['藤', 'Ротанг'], ['竹', 'Бамбук'], ['羽毛', 'Перо'], ['冰丝', 'Вискоза'],
  // 动物/对象
  ['猫', 'Кошка'], ['小猫', 'Котёнок'], ['猫咪', 'Кошка'], ['狗', 'Собака'], ['宠物', 'Питомец'],
  // 玩具类型
  ['猫抓板', 'Когтеточка'], ['猫抓柱', 'Когтеточка-столбик'], ['逗猫棒', 'Дразнилка'],
  ['猫棒', 'Дразнилка'], ['球', 'Мячик'], ['玩具', 'Игрушка'], ['互动玩具', 'Интерактивная игрушка'],
  ['猫薄荷', 'Мята кошачья'], ['老鼠', 'Мышка'], ['铃铛', 'Колокольчик'],
  // 用途/特点
  ['磨爪', 'Точить когти'], ['互动', 'Интерактивная игра'], ['自嗨', 'Самостоятельная игра'],
  ['休息', 'Отдых'], ['躺床', 'Лежанка'], ['保护家具', 'Защита мебели'], ['折叠', 'Складная'],
  ['套装', 'Набор'], ['组合', 'Набор'], ['大', 'Крупный'], ['小', 'Малый'], ['中', 'Средний'],
].map(([cn, ru]) => ({ cn, ru })).sort((a, b) => b.cn.length - a.cn.length);

function getToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) { return ''; }
}

// 中文文本 → 俄语词集（最长词优先命中，去重）
function translateCn(cnText) {
  if (!cnText) return [];
  const out = [];
  const used = new Set();
  const lower = String(cnText);
  for (const { cn, ru } of CN_RU) {
    if (lower.includes(cn) && !used.has(ru)) { out.push(ru); used.add(ru); }
  }
  return out;
}

function pickAttr(attributes, key) {
  if (!attributes) return '';
  const k = Object.keys(attributes).find((x) => x === key || x.includes(key));
  return k ? attributes[k] : '';
}

// WB 颜色字典里的合法基础色（必须小写、无 ё；取错值会被拒「无效字段：颜色」）
const LEGAL_COLORS = ['белый', 'черный', 'синий', 'розовый', 'зеленый', 'красный', 'желтый', 'серый', 'коричневый', 'бежевый', 'фиолетовый', 'оранжевый', 'голубой', 'бирюзовый', 'мятный', 'прозрачный'];

// 从 1688 属性/标题提取颜色（只返回合法颜色，否则兜底 белый）
function extractColor(attrs, cnTitle) {
  const src = String(pickAttr(attrs, '颜色') || '').replace(/[「」"`]/g, '');
  const fromAttr = translateCn(src).find((w) => LEGAL_COLORS.includes(w));
  if (fromAttr) return fromAttr;
  const fromTitle = translateCn(cnTitle).find((w) => LEGAL_COLORS.includes(w));
  return fromTitle || 'белый';
}

// 材质词白名单（用于从 1688 字段里过滤，避免把颜色/动物等词混进材质）
const MATERIAL_RU = new Set([
  'Гофрокартон', 'Картон', 'Бумага', 'Сизаль', 'Плюш', 'Велюр', 'Силикон', 'Пластик', 'Дерево',
  'Хлопок', 'Экокожа', 'Джут', 'Нержавеющая сталь', 'Металл', 'Алюминий', 'Нейлон', 'Полиэстер',
  'Оксфорд', 'Холст', 'Акрил', 'Резина', 'Латекс', 'Керамика', 'Стекло', 'Поролон', 'Ротанг',
  'Бамбук', 'Перо', 'Вискоза', 'ABS',
]);

// 拉丁文材质缩写（1688 常直接写 ABS/PP/PC/PVC 等）
const LATIN_MATERIALS = [
  [/\bABS\b/i, 'ABS'],
  [/\bPP\b/i, 'ПП'],
  [/\bPC\b/i, 'ПК'],
  [/\bPVC\b/i, 'ПВХ'],
  [/\bTPR\b/i, 'ТПР'],
  [/\bTPE\b/i, 'ТПЭ'],
  [/\bEVA\b/i, 'EVA'],
  [/\bPET\b/i, 'ПЭТ'],
];

// 从 1688 属性/标题提取材质（返回多个标签：如 ['ABS', 'Нержавеющая сталь']）
function extractMaterial(attrs, cnTitle) {
  const tags = [];
  const push = (ru) => { if (ru && !tags.includes(ru)) tags.push(ru); };

  // 1) 扫所有带「材质/材料」的属性字段（含「手柄材质」「顶部装饰材质」这类子字段）
  const parts = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (/材质|材料/.test(k)) parts.push(String(v));
  }
  // 2) 兜底把标题和其余属性也扫一遍（很多 1688 货源只把材质写在标题/规格里）
  parts.push(String(cnTitle || ''));
  for (const v of Object.values(attrs || {})) parts.push(String(v));

  for (const text of parts) {
    // 中文材质词
    for (const { cn, ru } of CN_RU) {
      if (MATERIAL_RU.has(ru) && text.includes(cn)) push(ru);
    }
    // 拉丁材质缩写
    for (const [re, ru] of LATIN_MATERIALS) {
      if (re.test(text)) push(ru);
    }
  }

  // 3) 1688 完全没有材质信息时，按商品类型兜底（不再统一写死瓦楞纸）
  if (!tags.length) {
    const t = String(cnTitle || '');
    if (/猫砂盆|猫厕所|砂盆|厕所/.test(t)) push('ABS');
    else if (/抓板|抓柱|磨爪|瓦楞/.test(t)) push('Гофрокартон');
    else if (/碗|餐台|喂食器|饮水/.test(t)) push('Пластик');
    else if (/尿垫|导尿|隔尿/.test(t)) push('Силикон');
    else if (/窝|垫|床|沙发|躺/.test(t)) push('Плюш');
    else push('Пластик');
  }
  return tags.slice(0, 4);
}

// HS 编码（ТН ВЭД）：只能从类目 731 的合法编码列表里选，按材质匹配，兜底塑料制品
const TNVED_BY_MATERIAL = [
  ['Пластик', '3926909709'],
  ['Силикон', '3926909709'],
  ['Дерево', '4421999000'],
  ['Джут', '5609000000'],
  ['Сизаль', '5609000000'],
  ['Плюш', '6307909800'],
  ['Хлопок', '6307909800'],
  ['Экокожа', '6307909800'],
];

function pickTnved(material) {
  const m = String(material || '');
  const hit = TNVED_BY_MATERIAL.find(([k]) => m.includes(k));
  return hit ? hit[1] : '3926909709';
}

// 玩具类型判定
function detectToyType(cnTitle) {
  const t = translateCn(cnTitle);
  if (t.includes('Когтеточка-столбик')) return 'Когтеточка-столбик';
  if (t.includes('Когтеточка')) return 'Когтеточка';
  if (t.includes('Дразнилка')) return 'Дразнилка';
  if (t.includes('Мячик')) return 'Мячик';
  return 'Игрушка';
}

// 尺寸表达式（兼容 51*35*h35 / 51x36x34 / 51×36×34 см 等采集标题写法）
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*[хxX×*]\s*(\d+(?:[.,]\d+)?)\s*[хxX×*]\s*h?\s*(\d+(?:[.,]\d+)?)\s*(?:см|cm|мм|mm)?/gi;

// 介系词（重复名词被删时一并清理，避免留下「для」之类的悬空词）
const PREPS = new Set(['для', 'с', 'из', 'от', 'на', 'по', 'в', 'у', 'к', 'о', 'об']);

// 词的比较键：小写去标点；4 字母以上再压掉元音/软音符号，兼容 кошек/кошки 这类同词变形
function wordKey(w) {
  const base = String(w || '').toLowerCase().replace(/[^а-яёa-z0-9-]/g, '');
  if (!base) return '';
  if (base.length >= 4) return base.replace(/[аеёиоуыэюяьй]/g, '') || base;
  return base;
}

// 去掉重复单词（WB 评分项：名称含重复单词会扣分）。只处理小写俄文普通词，避免误删品牌名
function dedupeWords(title) {
  const tokens = String(title || '').split(/\s+/).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const raw of tokens) {
    const bare = raw.replace(/[.,!?;:]+$/, '');
    const isRuLower = /^[а-яё][а-яё-]*$/i.test(bare) && bare[0] === bare[0].toLowerCase();
    const key = wordKey(bare);
    const dup = isRuLower && key.length >= 3 && seen.has(key);
    if (dup) {
      const prev = out.length ? out[out.length - 1].replace(/[.,!?;:]+$/, '').toLowerCase() : '';
      if (PREPS.has(prev)) out.pop();
      continue;
    }
    if (key.length >= 3) seen.add(key);
    out.push(raw);
  }
  return out.join(' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;·-]+$/g, '')
    .trim();
}

// 剥掉标题里所有旧尺寸（含 * 分隔、h 前缀的写法），清理多余标点与重复单词
function stripSize(ruTitle) {
  const cleaned = String(ruTitle || '')
    .replace(/[`「」"]/g, '')
    .replace(SIZE_RE, '')
    .replace(/\s*,\s*(?=[,.;])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;·-]+$/g, '')
    .replace(/^[\s,;·-]+/g, '')
    .trim();
  return dedupeWords(cleaned);
}

// 标题尺寸归一化：剥掉旧尺寸后只补一次 1688 实测尺寸，避免标题里出现两个尺寸
function normalizeSizeInTitle(ruTitle, length, width, height) {
  const L = Math.round(Number(length) || 0);
  const W = Math.round(Number(width) || 0);
  const H = Math.round(Number(height) || 0);
  if (!ruTitle) return ruTitle;
  const base = stripSize(ruTitle) || 'Товар для животных';
  if (!L || !W || !H) return base;
  return base + ', ' + L + '×' + W + '×' + H + ' см';
}

// 去掉数字尾部多余的 0（24.50 → 24.5，55.00 → 55）
function fmtNum(n) {
  const x = Number(n);
  if (!isFinite(x)) return '0';
  return String(Math.round(x * 100) / 100);
}

// WB 卡名（名称字段）最长 60 字符（宠物用品/宠物玩具等类目平台校验）
const NAME_MAX = 60;

// 生成 ≤60 字符的卡名：剥掉旧尺寸，塞得下就补一次 1688 实测尺寸，塞不下就按空格边界截断
function fitName(ruTitle, length, width, height) {
  const L = Math.round(Number(length) || 0);
  const W = Math.round(Number(width) || 0);
  const H = Math.round(Number(height) || 0);
  const dim = L && W && H ? L + '×' + W + '×' + H + ' см' : '';
  let t = stripSize(ruTitle) || 'Товар для животных';
  if (dim && (t + ', ' + dim).length <= NAME_MAX) return t + ', ' + dim;
  if (t.length <= NAME_MAX) return t;
  t = t.slice(0, NAME_MAX).trim();
  const sp = t.lastIndexOf(' ');
  return (sp > 20 ? t.slice(0, sp) : t).replace(/[\s,;·-]+$/g, '');
}

function buildDraft(db, nmId) {
  const row = db.db.prepare(`
    SELECT wb_nm_id, title, image_url, category, keyword,
           source_1688_json, source_weight, source_length, source_width, source_height
    FROM wb_market_products WHERE wb_nm_id = ?
  `).get(Number(nmId));
  if (!row) return { ok: false, error: '库中不存在 nmID=' + nmId };

  let src = {};
  try { src = row.source_1688_json ? JSON.parse(row.source_1688_json) : {}; } catch (e) { src = {}; }

  const cnTitle = String((src && src.title) || '').replace(/[`「」]/g, '');
  const attrs = (src && src.attributes) || {};

  // 俄文标题：优先采集的俄文标题（本来就俄文）；没有才用 1688 标题翻译兜底
  const ruTitle = (row.title || '').trim() || 'Товар для животных';

  // ---- 规格解析：从 1688 packagingInfo 取，只发体积最大的「大号」 ----
  let specs = [];
  const packaging = Array.isArray(src.packagingInfo) ? src.packagingInfo : [];
  for (const p of packaging) {
    const len = Number(p['长(cm)'] || p['长'] || 0);
    const wid = Number(p['宽(cm)'] || p['宽'] || 0);
    const hei = Number(p['高(cm)'] || p['高'] || 0);
    const wei = Number(p['重量(g)'] || p['重量'] || 0);
    if (!len || !wid || !hei) continue; // 跳过无效规格
    specs.push({ name: String(p['颜色'] || p['规格'] || '').trim(), length: len, width: wid, height: hei, weight: wei });
  }
  // 无 packagingInfo 时兜底到单一 source_* 字段
  if (specs.length === 0) {
    specs.push({ name: '', length: row.source_length || 0, width: row.source_width || 0, height: row.source_height || 0, weight: row.source_weight || 0 });
  }
  // 量纲归一：避免 1688 的毫米值（345）被当成 345 cm 发出去
  specs = specs.map((s) => {
    const [L, W, H] = normalizeDims(s.length, s.width, s.height);
    return { ...s, length: L, width: W, height: H };
  });
  // WB 各宠物类目无「尺寸规格」变体维度，大/中/小无法合并成一张卡 → 只发体积最大的「大号」
  specs.sort((a, b) => (b.length * b.width * b.height) - (a.length * a.width * a.height));
  specs = [specs[0]];

  const materialTags = extractMaterial(attrs, cnTitle);
  // HS 编码（跨境清关必填，UI 上的「填写 HS」提示），按材质选择合法编码
  const tnved = pickTnved(materialTags.join(', '));
  const toyType = detectToyType(cnTitle);
  // 动物类型按 1688 标题判定，没有中文标题时看俄文标题（狗用品不再一律写「Кошка」）
  const animalType = /狗|犬/.test(cnTitle) || /собак/i.test(ruTitle) ? 'Собака' : 'Кошка';
  const animalGenitive = animalType === 'Собака' ? 'собак' : 'кошек';
  // 类目按「俄文标题 → 中文标题 → 采集类目」判定，不再一律挂到 731 玩具
  const subjectID = resolveSubject(ruTitle, row.category, cnTitle);

  // 标题：把尺寸归一到 1688 实测值（只发大号，单变体）
  const commonTitle = normalizeSizeInTitle(ruTitle, specs[0].length, specs[0].width, specs[0].height);
  // 卡名单独生成：WB 名称字段上限 60 字符，超长会被平台拒绝
  const cardName = fitName(ruTitle, specs[0].length, specs[0].width, specs[0].height);

  // 「Назначение игрушки」(125575) 只有玩具类目支持，其余类目交给 filterChars 过滤
  const isToySubject = subjectID === 731 || subjectID === 874;
  const purpose = subjectID === 874
    ? ['Точить когти, отдых ' + animalGenitive]
    : (subjectID === 731 ? ['Активная игра для ' + animalGenitive] : []);

  // 「Особенности товара для животных」(115027) 按类目给出贴合的描述，避免所有卡都写「玩具」
  const SUBJECT_FEATURES = {
    1125: 'Туалет для ' + animalGenitive + ', легко мыть',
    1126: 'Кормление, для воды и корма',
    1121: 'Кормление, для сухого корма',
    3235: 'Питье, для воды',
    941: 'Отдых и сон, мягкая лежанка',
    942: 'Отдых и сон, закрытый домик',
    726: 'Перевозка ' + animalGenitive,
    728: 'Прогулка и дрессировка',
    729: 'Прогулка и дрессировка',
    730: 'Прогулка и дрессировка',
    735: 'Защита от холода, одежда для ' + animalGenitive,
    3318: 'Содержание, вольер для ' + animalGenitive,
    1007: 'Дрессировка, намордник',
    932: 'Гигиена, впитывающие пеленки',
    3480: 'Уход за шерстью',
    1071: 'Уход за когтями',
    4626: 'Груминг и уход',
    2911: 'Гигиена, коврик для лотка',
    3241: 'Защита пола под миску',
  };
  const features = [SUBJECT_FEATURES[subjectID] || purpose[0] || (toyType + ' для ' + animalGenitive)];
  const kit = translateCn(cnTitle).includes('Набор') ? [commonTitle + ', в наборе'] : [commonTitle];

  // 描述：单变体单行尺寸/重量（玩具类写玩法，其余写用途，避免猫砂盆被描述成玩具）
  const descBase = [
    'Товар для ' + animalGenitive + ', безопасный материал, '
      + (isToySubject ? 'подходит для активной игры и отдыха питомца.' : 'удобен в ежедневном использовании.'),
  ];
  const descSize = [
    'Размер: ' + fmtNum(specs[0].length) + '×' + fmtNum(specs[0].width) + '×' + fmtNum(specs[0].height) + ' см, вес: ' + (specs[0].weight / 1000).toFixed(2) + ' кг.'
  ];
  // 描述首行用「无尺寸」商品名：尺寸只在下面「Размер」行出现一次，避免重复
  const descTitle = stripSize(ruTitle) || cardName;
  const commonDescription = [
    descTitle + '.',
    ...descBase,
    ...descSize,
    'Доставка из Китая. Срок доставки смотрите в карточке товара.',
  ].join('\n');

  const singleColor = extractColor(attrs, cnTitle);

  const variants = specs.map((s, i) => {
    const L = Math.round(s.length * 10) / 10 || 0;
    const W = Math.round(s.width * 10) / 10 || 0;
    const H = Math.round(s.height * 10) / 10 || 0;
    const WT = Math.round(s.weight) || 0;
    const vColor = singleColor;

    // 只保留当前类目支持的字段（252454 Вид грызуна 仅鼠类适用，不再写入）
    const characteristics = filterChars([
      { id: 89008, value: WT },                                    // Вес товара без упаковки (г)
      { id: 90673, value: W },                                     // Ширина предмета (см)
      { id: 90652, value: L },                                     // Глубина предмета (см)
      { id: 90630, value: H },                                     // Высота предмета (см)
      { id: 14177449, value: [vColor] },                           // Цвет（多变体时作规格区分）
      { id: 12285, value: [animalType] },                          // Вид животного
      { id: 125045, value: [toyType] },                            // Вид игрушки（仅玩具类目）
      { id: 17596, value: materialTags },                          // Материал изделия（多个标签按 1688 数据分开填）
      { id: 14177451, value: ['Китай'] },                          // Страна производства
      { id: 15001405, value: ['20'] },                             // Ставка НДС
      // 品名：玩具类目用 15003169「Полное наименование」，多数非玩具类目只认 15000000「Наименование」
      { id: 15000000, value: [commonTitle] },
      { id: 15003169, value: [commonTitle] },                      // Полное наименование
      { id: 15000001, value: [tnved] },                            // ТНВЭД（HS 编码）
      { id: 15004139, value: [tnved] },                            // Код ТН ВЭД（跨境 HS 字段）
      { id: 378533, value: kit },                                  // Комплектация
      { id: 125575, value: purpose },                              // Назначение（仅玩具类目）
      { id: 115027, value: features },                             // Особенности
    ].filter((c) => !Array.isArray(c.value) || c.value.length > 0), subjectID);

    return {
      vendorCode: 'wb-' + nmId + '-' + (i + 1) + '-' + Date.now().toString().slice(-6),
      title: cardName,
      description: commonDescription,
      images: row.image_url ? [row.image_url] : [],
      video: '',
      dimensions: {
        length: L,
        width: W,
        height: H,
        // WB 以 dimensions.weightBrutto（毛重 kg）作为后台「重量」字段；缺它会被判“未填写重量”
        weightBrutto: WT / 1000,
      },
      characteristics,
      sizes: [{ techSize: '0', wbSize: '', skus: [] }],
      _specName: s.name,
    };
  });

  const draft = {
    subjectID: subjectID,
    brand: '',
    currencyIsoCode4217: 'RUB',
    // 顶层保留通用字段供前端预览展示；真正提交走 variants
    title: cardName,
    description: commonDescription,
    variantCount: variants.length,
    variants,
    _sourceNmId: Number(nmId),
    _sourceTitle: row.title,
    _cnTitle: cnTitle,
  };

  return { ok: true, draft, row: { nmId: row.wb_nm_id, title: row.title, category: row.category } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 按 vendorCode 查已建好的卡片（建卡是异步的，需要轮询等它出现在列表里）
async function listCards(token, cursor) {
  const res = await fetch(HOST + '/content/v2/get/cards/list', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { cursor: Object.assign({ limit: 100 }, cursor || {}), filter: { withPhoto: -1 } } }),
  });
  if (!res.ok) return { cards: [], cursor: {} };
  const json = await res.json();
  return { cards: json.cards || [], cursor: json.cursor || {} };
}

async function findCardByVendorCode(token, vendorCode) {
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await listCards(token, cursor);
    const hit = r.cards.find((c) => c.vendorCode === vendorCode);
    if (hit) return hit;
    if (r.cards.length < 100 || !r.cursor.updatedAt) return null;
    cursor = { updatedAt: r.cursor.updatedAt, nmID: r.cursor.nmID };
  }
  return null;
}

// 采集图外链写进 images 不会被 WB 收录，必须走 media 接口上传到 WB 存储
async function uploadPhoto(token, nmId, photoNumber, url) {
  const dl = await fetch(url);
  if (!dl.ok) return { ok: false, photoNumber, url, error: '下载图片失败 HTTP ' + dl.status };
  const type = (dl.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const buf = Buffer.from(await dl.arrayBuffer());
  const fd = new FormData();
  fd.append('uploadfile', new Blob([buf], { type }), photoNumber + '.' + ext);
  const res = await fetch(HOST + '/content/v3/media/file', {
    method: 'POST',
    headers: { 'Authorization': token, 'X-Nm-Id': String(nmId), 'X-Photo-Number': String(photoNumber) },
    body: fd,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  const failed = (json && json.error) || res.status >= 300;
  return { ok: !failed, status: res.status, photoNumber, url, error: failed ? ((json && json.errorText) || text) : '' };
}

async function attachImages(token, nmId, urls) {
  const list = (urls || []).filter(Boolean);
  const results = [];
  for (let i = 0; i < list.length; i++) {
    try {
      results.push(await uploadPhoto(token, nmId, i + 1, list[i]));
    } catch (e) {
      results.push({ ok: false, photoNumber: i + 1, url: list[i], error: e.message });
    }
  }
  return results;
}

// 设置售价（Prices API，账号币种 CNY；price 为折前价，discount 为百分比）
async function setPrice(token, nmId, price, discount) {
  const res = await fetch(PRICE_HOST + '/api/v2/upload/task', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ nmID: Number(nmId), price: Math.round(Number(price) || 0), discount: Math.round(Number(discount) || 0) }] }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  const failed = res.status >= 300 || (json && json.error);
  return { ok: !failed, status: res.status, error: failed ? ((json && json.errorText) || text) : '' };
}

// 设置库存（Marketplace API，FBS 仓库；sku 传卡片 barcode）
async function setStock(token, warehouseId, sku, amount) {
  const res = await fetch(MARKET_HOST + '/api/v3/stocks/' + warehouseId, {
    method: 'PUT',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stocks: [{ sku: String(sku), amount: Math.round(Number(amount) || 0) }] }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  const failed = res.status >= 300 || (json && json.error);
  return { ok: !failed, status: res.status, error: failed ? ((json && json.errorText) || text) : '' };
}

async function submit(draft, options) {
  const token = getToken();
  if (!token) return { ok: false, error: '未找到 WB API Token（data/wb_api_token.txt）' };

  const variants = (draft && draft.variants && draft.variants.length)
    ? draft.variants
    : [draft]; // 兼容旧单变体草稿结构

  const body = [{
    subjectID: draft.subjectID,
    variants: variants.map((v) => ({
      vendorCode: v.vendorCode,
      title: v.title,
      description: v.description,
      brand: draft.brand,
      currencyIsoCode4217: draft.currencyIsoCode4217,
      images: v.images,
      video: v.video || undefined,
      dimensions: v.dimensions,
      characteristics: v.characteristics,
      sizes: v.sizes,
    })),
  }];

  try {
    const res = await fetch(HOST + '/content/v2/cards/upload', {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) return { ok: false, status: res.status, body: json || text };

    // 建卡成功后按 vendorCode 找到 nmID，再把采集主图经 media 接口挂到卡片上
    const vendorCode = variants[0].vendorCode;
    const urls = variants[0].images || [];
    let card = null;
    for (let i = 0; i < 10 && !card; i++) {
      card = await findCardByVendorCode(token, vendorCode);
      if (!card) await sleep(3000);
    }
    const media = card ? await attachImages(token, card.nmID, urls) : [];

    // 价格/库存：建卡同步完成前设置会失败，失败只记录不阻断发布
    const opts = options || {};
    let price = null;
    let stock = null;
    let sku = '';
    if (card) {
      if (opts.priceCny > 0) {
        price = await setPrice(token, card.nmID, opts.priceCny, opts.discount);
      }
      const size = (card.sizes && card.sizes[0]) || {};
      sku = (size.skus && size.skus[0]) || '';
      const amount = opts.stock != null ? opts.stock : PUBLISH_DEFAULTS.stock;
      if (sku && amount > 0) {
        stock = await setStock(token, opts.warehouseId || PUBLISH_DEFAULTS.warehouseId, sku, amount);
      }
    }

    return {
      ok: true,
      status: res.status,
      body: json || text,
      nmID: card ? card.nmID : null,
      sku,
      media,
      price,
      stock,
      warning: !card ? '卡已提交，但异步建卡尚未出现在列表，图片未上传；稍后可用 nmID 重传' : '',
    };
  } catch (e) {
    return { ok: false, error: '提交异常：' + e.message };
  }
}

module.exports = {
  buildDraft, submit, getToken, translateCn, fitName, stripSize, normalizeSizeInTitle,
  findCardByVendorCode, attachImages, setPrice, setStock, PUBLISH_DEFAULTS, HOST, SUBJECT_ID,
  resolveSubject, filterChars, loadSubjectChars, normalizeDims,
};