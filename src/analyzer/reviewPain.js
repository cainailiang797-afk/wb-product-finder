/**
 * WB 差评痛点提取（俄语规则分类，真实评价数据 → 痛点 / 改造方向）
 *
 * 口径说明（诚实标注）：
 *  - 只分析样本内差评（1~3 星），文本来源 = cons 字段 + text 字段。
 *  - 规则为关键词正则分类，可复现、可审计；不做语义编造。
 *  - 命中阈值为「出现次数 ≥2 且占差评 ≥3%」，避免单条噪声被当成痛点。
 *  - 改造方向 = 命中痛点对应的固定改进项（由痛点映射，非凭空生成）。
 */
const PAIN_RULES = [
  {
    key: 'glue_odor',
    label: '胶水异味大',
    re: /кле(й|ем|я|й)|воня|запах|хими|токсич|пахнет/i,
    fix: '换用低气味环保胶/无溶剂粘胶，出厂前做通风散味'
  },
  {
    key: 'not_stick',
    label: '固定不牢易脱落',
    re: /откле|не держ|отвалива|свалива|съезжа|не прилип|сполза/i,
    fix: '提升背胶粘力（加厚胶层/双组分胶），附安装说明与加固配件'
  },
  {
    key: 'size_small',
    label: '尺寸偏小/与描述不符',
    re: /мален|меньше|миниатюр|не соответств.{0,20}размер|размер не/i,
    fix: '核对详情页尺寸图与实物一致，主图加厘米标注，提供大号规格'
  },
  {
    key: 'flimsy',
    label: '材质脆弱易坏',
    re: /хлипк|тонк|сломал|порвал|развалил|треснул|непрочн|разорвал|рассыпал/i,
    fix: '加厚/加固结构（增加支撑层或密度），出厂做承重与拉扯测试'
  },
  {
    key: 'cat_ignore',
    label: '猫咪不感兴趣',
    re: /не игра|игнорир|не интерес|не реагир|не обраща|не заинтерес/i,
    fix: '增加猫薄荷/响纸/羽毛等吸引力元素，优化尺寸与动线贴合猫习性'
  },
  {
    key: 'battery',
    label: '电池/续航差',
    re: /батаре|заряд|разряд|перестал работ|не включа|не работа|зарядк/i,
    fix: '升级电池容量与充电方案，增加低电提示与自动断电'
  },
  {
    key: 'wrong_item',
    label: '货不对板/发错货',
    re: /не тот товар|другой товар|перепута|пришел не|пришла не|не соответствует.{0,15}(фото|описан|картинк)/i,
    fix: '加强 SKU 与订单核对、出货前称重校验，主图与规格表统一'
  },
  {
    key: 'unstable',
    label: '结构不稳固易倾倒',
    re: /не устойчив|неустойчив|шатает|болтает|переворачива|опрокид|качается/i,
    fix: '加宽/加重底座、增加防倾倒支撑，提升整体稳定性'
  },
  {
    key: 'missing_parts',
    label: '配件缺失',
    re: /неполн|не хватает|без винт|без болт|ввертыш|комплект не|не комплект/i,
    fix: '出货前配件清单逐项核对，随包附备用螺丝/安装件'
  },
  {
    key: 'sharp_safety',
    label: '边缘锐利/安全隐患',
    re: /торчат|поранит|остры|травм|опасн/i,
    fix: '螺丝倒角隐藏、边缘包边打磨，通过安全测试'
  },
  {
    key: 'shedding',
    label: '掉屑/碎料',
    re: /осыпа|крошит|стружк|мусор|пыль/i,
    fix: '更换高密度瓦楞/剑麻材料，边缘封边处理减少掉屑'
  },
  {
    key: 'noise',
    label: '噪音大',
    re: /шумн|громк|скрип|пищит|слишком громк/i,
    fix: '优化内部结构与减震，降低电机噪音或改用静音方案'
  },
  {
    key: 'shipping_damage',
    label: '物流破损',
    re: /помят|повреж|разбит|мят|деформ|брак при доставк/i,
    fix: '加厚包装（护角/内衬），与物流商约定易碎标识'
  },
  {
    key: 'scratches_furniture',
    label: '抓不住/伤家具',
    re: /не царап|царапа.{0,15}мебел|дерет.{0,15}мебел|портит/i,
    fix: '增大抓挠面积与角度引导，附猫薄荷引导使用说明'
  },
  {
    key: 'price_high',
    label: '价格偏高',
    re: /дорог|цена завыш|переоцен/i,
    fix: '优化成本结构与定价，或增加大规格/多件装提升性价比'
  }
];

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {Array} reviews WB feedbacks 数组（含 text/pros/cons/productValuation/createdDate）
 * @param {number} nowMs 当前时间戳（便于测试）
 */
function analyzeReviews(reviews, nowMs) {
  const now = nowMs || Date.now();
  const list = Array.isArray(reviews) ? reviews : [];
  const sample = list.length;

  let negCount = 0;
  let recent30 = 0;
  const counts = {};
  const negSamples = [];

  for (const f of list) {
    const d = f && f.createdDate ? Date.parse(f.createdDate) : NaN;
    if (!isNaN(d) && now - d <= 30 * DAY) recent30++;

    const val = parseInt(f && f.productValuation, 10);
    if (!val || val > 3) continue;
    negCount++;
    const txt = `${f.cons || ''} ${f.text || ''}`.replace(/\s+/g, ' ').trim();
    if (txt && negSamples.length < 300) {
      negSamples.push({ v: val, d: f.createdDate || '', t: txt.slice(0, 200) });
    }
    if (!txt) continue;
    for (const rule of PAIN_RULES) {
      if (rule.re.test(txt)) counts[rule.key] = (counts[rule.key] || 0) + 1;
    }
  }

  const minCount = Math.max(3, Math.ceil(negCount * 0.03));
  const pains = PAIN_RULES
    .map((r) => ({ key: r.key, label: r.label, fix: r.fix, count: counts[r.key] || 0 }))
    .filter((p) => p.count >= minCount && p.count > 0)
    .sort((a, b) => b.count - a.count);

  // 去重改造方向（同一 fix 只保留一次）
  const improves = [...new Set(pains.map((p) => p.fix))];

  return {
    sample,
    negCount,
    recent30,
    pains: pains.map((p) => ({ key: p.key, label: p.label, count: p.count, fix: p.fix })),
    improves,
    negSamples
  };
}

module.exports = { analyzeReviews, PAIN_RULES };
