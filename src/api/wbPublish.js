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
const SUBJECT_ID = 731; // Игрушки для животных（猫用品/玩具类目）

// ---------- 中文 → 俄文 词库（猫用品垂直品类） ----------
const CN_RU = [
  // 颜色（值必须与 WB 颜色字典完全一致：小写、无 ё）
  ['复古', 'Ретро'], ['白色', 'белый'], ['黑色', 'черный'], ['蓝色', 'синий'],
  ['粉色', 'розовый'], ['绿色', 'зеленый'], ['红色', 'красный'], ['黄色', 'желтый'],
  ['灰色', 'серый'], ['棕色', 'коричневый'], ['米色', 'бежевый'], ['紫色', 'фиолетовый'],
  // 材质
  ['瓦楞纸', 'Гофрокартон'], ['硬纸板', 'Картон'], ['纸质', 'Бумага'], ['剑麻', 'Сизаль'],
  ['毛绒', 'Плюш'], ['硅胶', 'Силикон'], ['塑料', 'Пластик'], ['木材', 'Дерево'],
  ['棉', 'Хлопок'], ['皮革', 'Экокожа'], ['生态皮革', 'Экокожа'], ['麻绳', 'Джут'],
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

// 从 1688 属性/标题提取材质
function extractMaterial(attrs, cnTitle) {
  const src = String(pickAttr(attrs, '材质') || pickAttr(attrs, '材料') || cnTitle);
  const hits = translateCn(src).filter((w) =>
    ['Гофрокартон', 'Картон', 'Бумага', 'Сизаль', 'Плюш', 'Силикон', 'Пластик', 'Дерево', 'Хлопок', 'Экокожа', 'Джут'].includes(w));
  return hits.length ? hits.join(', ') : 'Гофрокартон';
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
  // WB 宠物玩具类目(731)无「尺寸规格」变体维度，大/中/小无法合并成一张卡 → 只发体积最大的「大号」
  specs.sort((a, b) => (b.length * b.width * b.height) - (a.length * a.width * a.height));
  specs = [specs[0]];

  const material = extractMaterial(attrs, cnTitle);
  // HS 编码（跨境清关必填，UI 上的「填写 HS」提示），按材质选择合法编码
  const tnved = pickTnved(material);
  const toyType = detectToyType(cnTitle);
  const animalType = translateCn(cnTitle).includes('Кошка') || translateCn(cnTitle).includes('Котёнок') ? 'Кошка' : 'Кошка';

  // 标题：把尺寸归一到 1688 实测值（只发大号，单变体）
  const commonTitle = normalizeSizeInTitle(ruTitle, specs[0].length, specs[0].width, specs[0].height);
  // 卡名单独生成：WB 名称字段上限 60 字符，超长会被平台拒绝
  const cardName = fitName(ruTitle, specs[0].length, specs[0].width, specs[0].height);

  const purpose = toyType === 'Когтеточка' || toyType === 'Когтеточка-столбик'
    ? ['Точить когти, отдых кошки'] : ['Активная игра для кошки'];
  const features = (toyType === 'Когтеточка' || toyType === 'Когтеточка-столбик')
    ? [toyType + ' 2 в 1, защита мебели'] : [toyType + ' для кошек'];
  const kit = translateCn(cnTitle).includes('Набор') ? [commonTitle + ', в наборе'] : [commonTitle];

  // 描述：单变体单行尺寸/重量
  const descBase = [
    'Товар для кошек, безопасный материал, подходит для активной игры и отдыха питомца.',
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
    const L = Math.round(s.length) || 0;
    const W = Math.round(s.width) || 0;
    const H = Math.round(s.height) || 0;
    const WT = Math.round(s.weight) || 0;
    const vColor = singleColor;

    const characteristics = [
      { id: 89008, value: WT },                                    // Вес товара без упаковки (г)
      { id: 90673, value: W },                                     // Ширина предмета (см)
      { id: 90652, value: L },                                     // Глубина предмета (см)
      { id: 90630, value: H },                                     // Высота предмета (см)
      { id: 14177449, value: [vColor] },                           // Цвет（多变体时作规格区分）
      { id: 12285, value: [animalType] },                          // Вид животного
      { id: 252454, value: [animalType] },                         // Вид грызуна
      { id: 125045, value: [toyType] },                            // Вид игрушки
      { id: 17596, value: [material] },                            // Материал изделия
      { id: 14177451, value: ['中国'] },                           // Страна производства
      { id: 15001405, value: ['20'] },                             // Ставка НДС
      { id: 15003169, value: [commonTitle] },                      // Полное наименование
      { id: 15000001, value: [tnved] },                            // ТНВЭД（HS 编码）
      { id: 15004139, value: [tnved] },                            // Код ТН ВЭД（跨境 HS 字段）
      { id: 378533, value: kit },                                  // Комплектация
      { id: 125575, value: purpose },                              // Назначение
      { id: 115027, value: features },                             // Особенности
    ];

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
    subjectID: SUBJECT_ID,
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
};