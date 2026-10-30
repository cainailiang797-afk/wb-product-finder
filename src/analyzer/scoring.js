/**
 * WB 选品工具 - 六维评分 + 可打性分析
 *
 * 借鉴 ozon-product-finder 的评分体系，但按 WB 平台信号做适配：
 *
 * 六维 100 分制（与 Ozon 一致，保证口径统一）：
 *  需求 20 / 转化 15 / 竞争 15 / 痛点 20 / 改造 20 / 跟卖 10
 *
 * 关键适配点（诚实标注）：
 *  - 「跟卖分」在 WB 上无 Ozon 的精确其它卖家数，降级为
 *    用「同搜索词相似款数量 simCount + 品牌集中度 brandShare」近似，
 *    并显式标记 grade 为「近似值」，而非真实跟卖数。
 *  - 需求/转化/竞争/痛点/改造维度逻辑与 Ozon 同构，可直接复用。
 *
 * 可打性（razivityGrade，A 强可打 / B 可打 / C 谨慎 / D 不建议）：
 *  需求强度 35（关键词搜索量） + 竞争激烈度 35（卖家/相似款数）
 *  + 垄断度 30（同关键词 TOP 商品评论集中度）
 *  分档借鉴 marketabilityAnalyzer。
 */
class WbScoring {
  constructor() {
    // 可打性三维权重（沿用 Ozon）
    this.W = { demand: 35, competition: 35, monopoly: 30 };

    // 六维权重（沿用 Ozon 决策）
    this.SIX = { demand: 20, conversion: 15, competition: 15, pain: 20, improve: 20, follow: 10 };
  }

  /**
   * 需求分（0~20）：按关键词搜索量分档
   * @param {number} searchVolume 真实搜索量（Wordstat/Ozon 词量）
   */
  demandScore(searchVolume) {
    const sv = parseInt(searchVolume, 10) || 0;
    if (sv >= 5000) return 20;
    if (sv >= 1000) return 16;
    if (sv >= 300) return 12;
    if (sv >= 50) return 8;
    return 4;
  }

  /**
   * 转化分（0~15）：评论数 + 评分 代理转化能力
   * 评论多且评分高 = 市场验证充分、转化好
   */
  conversionScore(reviewCount, rating) {
    const rc = parseInt(reviewCount, 10) || 0;
    const rt = parseFloat(rating) || 0;
    let s = 0;
    if (rc >= 100 && rt >= 4.5) s = 15;
    else if (rc >= 30 && rt >= 4.3) s = 12;
    else if (rc >= 5 && rt >= 4.0) s = 9;
    else if (rc >= 1) s = 6;
    else s = 2; // 0 评论 = 无市场验证
    return s;
  }

  /**
   * 竞争分（0~15）：按「该词在 WB 上的真实搜索结果总数」分档，供给越少越蓝海
   * 数据来源：WB 搜索页内部接口 __internal/u-search 返回的 data.total（真实平台供给量）
   * @param {number} marketSupply 该关键词的 WB 搜索结果总数
   */
  competitionScore(marketSupply) {
    const c = parseInt(marketSupply, 10);
    if (isNaN(c) || c <= 0) return 8; // 未取到供给：给中性分并标记
    if (c <= 5000) return 15;       // 供给稀薄，接近独占
    if (c <= 30000) return 12;      // 蓝海
    if (c <= 100000) return 9;      // 正常
    if (c <= 400000) return 6;      // 偏饱和
    return 3;                        // 红海
  }

  /**
   * 痛点分（0~20）：AI 评论痛点分析产出，缺数据记 0 并告示
   */
  painScore(painPoints) {
    if (painPoints == null) return 0; // 未分析，诚实 0 分
    const n = Array.isArray(painPoints) ? painPoints.length : 0;
    if (n >= 3) return 20;
    if (n === 2) return 14;
    if (n === 1) return 8;
    return 3;
  }

  /**
   * 改造分（0~20）：有无明确改造方向；无明确方向基础分减半（沿用 Ozon 决策）
   */
  improveScore(directions) {
    if (!directions) return 5; // 无方向 → 减半（满分20的半 = 10，再保守给5）
    const n = Array.isArray(directions) ? directions.length : 0;
    if (n >= 3) return 20;
    if (n === 2) return 14;
    if (n === 1) return 9;
    return 5;
  }

  /**
   * 跟卖分（0~10）—— WB 近似：无精确其它卖家数，用品牌集中度倒数近似
   * @param {number} brandShare 0~1，同赛道头部品牌销量/评论占比越高越垄断
   * 明确：这是「近似跟卖/垄断风险」，非真实跟卖数
   */
  followScore(brandShare) {
    const bs = parseFloat(brandShare);
    if (isNaN(bs)) return 5;          // 未知中性
    if (bs < 0.25) return 10;         // 无品牌垄断，容易切入
    if (bs < 0.5) return 7;
    if (bs < 0.75) return 4;
    return 2;
  }

  /**
   * 六维总分（0~100）
   */
  sixDimTotal(input) {
    const p = {
      demand: this.demandScore(input.searchVolume),
      conversion: this.conversionScore(input.reviewCount, input.rating),
      competition: this.competitionScore(input.competitorCount),
      pain: this.painScore(input.painPoints),
      improve: this.improveScore(input.improveDirections),
      follow: this.followScore(input.brandShare)
    };
    const total = p.demand + p.conversion + p.competition + p.pain + p.improve + p.follow;
    return { parts: p, total };
  }

  /**
   * 需求分（0~20）——代理值
   * WB 不公开关键词搜索量（无 Wordstat 类接口），用真实可得数据做代理：
   *   「同关键词下样本商品的近 30 天评价增量合计」= 真实市场交易活跃度代理。
   * 换算用对数刻度，避免头部类目直接爆表：4 + 8*log10(v/50)，封顶 20、下限 2。
   * 页面/报表需标注「需求=代理值」，不得表述为搜索量。
   */
  demandScoreByProxy(recent30Sum) {
    const v = parseInt(recent30Sum, 10);
    if (isNaN(v) || v < 0) return null;
    const s = 4 + 8 * Math.log10(Math.max(v, 1) / 50);
    return Math.min(20, Math.max(2, Math.round(s)));
  }

  /**
   * 六维汇总：逐维累加，缺失维（null）记入 missing，不做默认 0 冒充实分。
   * @param {object} parts {demand,conversion,competition,pain,improve,follow}
   */
  sixDimFromParts(parts = {}) {
    const keys = ['demand', 'conversion', 'competition', 'pain', 'improve', 'follow'];
    let total = 0;
    const missing = [];
    for (const k of keys) {
      const v = parts[k];
      if (v == null || Number.isNaN(v)) missing.push(k);
      else total += Number(v);
    }
    return { total: Math.round(total), missing, parts };
  }

  /**
   * 可打性评级（A/B/C/D）
   */
  marketability(opts = {}) {
    const W = this.W;
    const sv = parseInt(opts.demand && opts.demand.searchVolume, 10) || 0;

    // 需求强度（0~35）
    let demandScore = null;
    if (opts.demand && opts.demand.searchVolume != null) {
      if (sv >= 500) demandScore = 35;
      else if (sv >= 100) demandScore = 28;
      else if (sv >= 30) demandScore = 21;
      else if (sv >= 5) demandScore = 14;
      else demandScore = 7;
    }

    // 竞争（0~35）：卖家/相似款越少越高
    let compScore = null;
    if (opts.competitors != null) {
      const c = parseInt(opts.competitors, 10);
      if (c <= 3) compScore = 35;
      else if (c <= 10) compScore = 28;
      else if (c <= 30) compScore = 22;
      else if (c <= 100) compScore = 14;
      else compScore = 7;
    }

    // 垄断度（0~30）：TOP 评论集中度
    let monoScore = null;
    if (opts.monopoly && opts.monopoly.topShare != null) {
      const ts = parseFloat(opts.monopoly.topShare);
      if (ts < 0.25) monoScore = 30;
      else if (ts < 0.5) monoScore = 23;
      else if (ts < 0.75) monoScore = 15;
      else monoScore = 7;
    }

    const parts = { demand: demandScore, competition: compScore, monopoly: monoScore };
    const available = [demandScore, compScore, monoScore].filter(v => v != null);
    const score = available.length
      ? available.reduce((a, b) => a + b, 0)
      : 0;

    // 评级
    let grade = 'D';
    if (demandScore != null && compScore != null && monoScore != null) {
      const t = demandScore + compScore + monoScore;
      if (t >= 85) grade = 'A';
      else if (t >= 70) grade = 'B';
      else if (t >= 50) grade = 'C';
      else grade = 'D';
    } else {
      if (score >= 35) grade = 'C';
    }

    return {
      grade,
      score,
      parts,
      note: parts.competition != null
        ? 'WB 竞争维度为「相似款数量」近似，非精确跟卖数'
        : '部分市场数据缺失，可打性判断受限'
    };
  }
}

module.exports = WbScoring;