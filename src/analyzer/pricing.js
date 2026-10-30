/**
 * WB 选品工具 - 定价模型（Phase 1 框架）
 *
 * 借鉴 ozon-product-finder 的 recalc-cost 模型骨架，公式同构：
 *   利润(₽) = 售价 × (1 − 佣金率) − 头程物流 − 到仓采购成本 − 履约/尾程 − 其他
 *
 * ⚠️ 重要诚实声明（用户硬约束「不用模拟数据」）：
 *  WB 的佣金率、FBO/FBS 履约费率目前【未拉取官方最新值】。
 *  本模块只提供计算骨架与字段占位，所有费率从 wb_cost_config 读取；
 *  只要关键费率未配置（commission_rate=0 或未填），一律返回
 *  hasCost=false 并给出「费率未配置」说明，绝不返回编造的利润数字。
 */
class WbPricing {
  constructor(costConfig = {}) {
    this.cfg = {
      commissionRate: costConfig.commission_rate != null ? costConfig.commission_rate : 0,
      logisticsFboRate: costConfig.logistics_fbo_rate != null ? costConfig.logistics_fbo_rate : 0,
      logisticsFbsRate: costConfig.logistics_fbs_rate != null ? costConfig.logistics_fbs_rate : 0,
      advertisingRate: costConfig.advertising_rate != null ? costConfig.advertising_rate : 0,
      targetMargin: costConfig.target_margin != null ? costConfig.target_margin : 0.25,
      promoDiscountRate: costConfig.promo_discount_rate != null ? costConfig.promo_discount_rate : 0.10,
      multiplierMin: costConfig.multiplier_min != null ? costConfig.multiplier_min : 45,
      // 实时汇率（₽ per ¥），Phase 1 需外部传入；未传则无法算到仓成本
      rubPerCny: costConfig.rub_per_cny || null
    };
  }

  /**
   * 判断是否具备真实算价条件
   * 缺少：佣金率 或 采购成本 或 汇率 时，视为「无法真实定价」
   */
  _canPrice(purchaseCostCny, dimsInferred = false) {
    const missing = [];
    if (!this.cfg.commissionRate) missing.push('WB佣金率未配置');
    if (purchaseCostCny == null || isNaN(purchaseCostCny) || purchaseCostCny <= 0) missing.push('采购成本未知');
    if (!this.cfg.rubPerCny) missing.push('实时汇率未提供');
    return { ok: missing.length === 0, missing };
  }

  /**
   * 计算建议售价与利润（只返回真实可算部分）
   * @param {Object} input
   *   - priceRub: 竞品 WB 售价 ₽（作基准，非必需）
   *   - purchaseCostCny: 1688 采购成本（人民币）
   *   - weightG / dims: 重量/尺寸（用于头程估算，Phase 1 提供接口位）
   *   - fulfillment: 'fbo' | 'fbs'（履约模式）
   */
  calc(input = {}) {
    const purchaseCostCny = parseFloat(input.purchaseCostCny);
    const check = this._canPrice(purchaseCostCny, input.dimsInferred);
    if (!check.ok) {
      return { hasCost: false, reason: check.missing.join('；'), profitCny: null, suggestedPriceRub: null };
    }

    const rubPerCny = this.cfg.rubPerCny;
    const arrivalCostRub = purchaseCostCny * rubPerCny; // 到仓采购成本 ₽

    // 头程物流（¥ 线性计价参考 Ozon China Post，此处为接口位，费率待 WB 头程渠道确认）
    // Phase 1：暂不支持按重量精确计算，作为可扩展占位（0 表示未接入）
    const headFreightRub = 0;

    // 履约成本：FBO/FBS 费率待确认，此处仅做「接入位」说明，不编造具体金额
    const fulfillmentRub = input.fulfillment === 'fbo'
      ? 0 /* FBO 仓储+配送，费率待填充 */
      : 0 /* FBS 自发货，费率待填充 */;

    // 建议售价 = (到仓成本 + 头程 + 履约) ÷ [(1 − 佣金 − 广告 − 目标利润) × (1 − 促销余量)]
    const denom = (1 - this.cfg.commissionRate - this.cfg.advertisingRate - this.cfg.targetMargin)
      * (1 - this.cfg.promoDiscountRate);
    let suggestedPriceRub = (arrivalCostRub + headFreightRub + fulfillmentRub) / Math.max(denom, 0.05);

    // 市场倍率下限：建议售价不低于 采购¥ × multiplierMin
    const floorRub = purchaseCostCny * this.cfg.multiplierMin;
    if (suggestedPriceRub < floorRub) suggestedPriceRub = floorRub;

    // 单件净利润（人民币）= (售价×(1−佣金) − 头程 − 到仓 − 履约) / 汇率
    const profitRub = suggestedPriceRub * (1 - this.cfg.commissionRate)
      - headFreightRub - arrivalCostRub - fulfillmentRub;
    const profitCny = profitRub / rubPerCny;

    return {
      hasCost: true,
      suggestedPriceRub: Math.round(suggestedPriceRub),
      profitCny: Math.round(profitCny * 100) / 100,
      note: '利润为中性估算，不含未接入的头程/履约精确项；费率以官方值填充后为准'
    };
  }
}

module.exports = WbPricing;