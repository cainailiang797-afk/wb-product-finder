/**
 * WB-DPX 头程物流计费 + 售价反推
 * 依据《WB-DPX 物流费用计算器》（来源：WB-DPX 地址及运费价格 8.11）
 *
 * 计费规则：
 * - 只按【实际重量(g)】计费，不看体积/尺寸
 * - 计费重量 = 每 100g 向上取整（ROUNDUP）
 * - 第一档 100~300g：计费单位×5.8 + 2 元/单
 * - 第二档 >300~20000g：计费单位×4.3 + 8 元/单
 * - <100g 或 >20000g 本价表不报价
 *
 * 售价反推：售价 = (采购₽ + 物流₽ + 其他固定费₽) ÷ (1 − 佣金率 − 损耗率 − 目标毛利率)
 */
const TIER1 = { ratePer100g: 5.8, fee: 2, label: '第一档' };
const TIER2 = { ratePer100g: 4.3, fee: 8, label: '第二档' };

/** 单件物流费（元）：传入实际重量 g */
function calcLogistics(weightG) {
  const w = Number(weightG) || 0;
  if (!(w >= 100)) return { ok: false, error: '实际重量低于 100g，当前价表未覆盖，需另行确认' };
  if (w > 20000) return { ok: false, error: '实际重量超过 20000g，超出价表上限，需另行确认' };
  const chargeG = Math.ceil(w / 100) * 100;      // 每 100g 向上取整
  const units = chargeG / 100;
  const tier = w <= 300 ? TIER1 : TIER2;          // 档位按实际重量判定
  const costCny = Math.round((units * tier.ratePer100g + tier.fee) * 100) / 100;
  return { ok: true, chargeG, units, tierLabel: tier.label, costCny };
}

/**
 * 计算头程物流 + 建议售价
 * @param {object} p
 * @param {number} p.purchaseCostCny 采购成本（元，含国内运费）
 * @param {number} p.weightG 实际重量（g）
 * @param {object} p.config getCostConfig() 返回
 */
function computePricing({ purchaseCostCny, weightG, config }) {
  const cfg = config || {};
  const rate = cfg.currencyRate > 0 ? cfg.currencyRate : 12;
  const rubFee = cfg.rubFee != null ? cfg.rubFee : 90;
  const c = cfg.commissionRate > 0 ? cfg.commissionRate : 0.15;
  const l = cfg.lossRate != null ? cfg.lossRate : 0.05;
  const m = cfg.targetMargin > 0 ? cfg.targetMargin : 0.25;

  const purchaseRub = (Number(purchaseCostCny) || 0) * rate;
  const denom = 1 - c - l - m;
  if (denom <= 0) {
    return { ok: false, error: '目标毛利率 + 佣金率 + 损耗率合计超过 100%，无法定价' };
  }

  const logi = calcLogistics(weightG);
  if (!logi.ok) return logi;

  const headLegRub = Math.round(logi.costCny * rate * 100) / 100;
  const suggestPriceRub = Math.round((purchaseRub + headLegRub + rubFee) / denom);
  const realMargin = Math.round(
    ((suggestPriceRub - (purchaseRub + headLegRub + rubFee) - suggestPriceRub * (c + l)) / suggestPriceRub) * 1000
  ) / 1000;

  return {
    ok: true,
    channel: logi.tierLabel,
    chargeWeight: logi.chargeG / 1000,   // 计费重(kg)，仅供展示
    headLegCny: logi.costCny,
    headLegRub,
    purchaseRub: Math.round(purchaseRub * 100) / 100,
    suggestPriceRub,
    margin: m,
    realMargin,
    currencyRate: rate,
  };
}

module.exports = { computePricing, calcLogistics };
