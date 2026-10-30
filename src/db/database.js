/**
 * WB 选品工具 - 数据库模块
 * 独立实现，借鉴 ozon-product-finder 的 schema 结构（同样用 better-sqlite3 + WAL）
 *
 * 说明：本工具为独立项目，不复用 Ozon 工具的运行时代码，
 *       仅借鉴其表结构设计思路，平台字段按 Wildberries 语义重命名/重定义。
 */
const path = require('path');
const fs = require('fs');

// 优先 better-sqlite3（已编译时），失败自动回退 node:sqlite（Node 22.5+ 内置，免编译）
const Database = require('./sqliteCompat');

class WbDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '../../data/wb_agent.db');
    this.db = null;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._createTables();
    this._migrate();
    console.log('[DB] 数据库初始化完成: ' + this.dbPath);
    return this;
  }

  _createTables() {
    this.db.exec(`
      -- ===== WB 市场商品表（Phase 1 采集入库）=====
      CREATE TABLE IF NOT EXISTS wb_market_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wb_nm_id INTEGER DEFAULT 0,               -- WB 商品编号 nmID（同一卖家一卡一号）
        title TEXT DEFAULT '',
        category TEXT DEFAULT '',                  -- 我们的类目（猫用品-xx / 狗用品-xx）
        keyword TEXT DEFAULT '',                   -- 命中的搜索词
        url TEXT DEFAULT '',                       -- 商品详情页 URL
        image_url TEXT DEFAULT '',
        price REAL DEFAULT 0,                      -- 当前售价 ₽
        old_price REAL DEFAULT 0,                  -- 划线原价 ₽（折扣判断）
        rating REAL DEFAULT 0,                     -- 商品评分（отзывы rating）
        review_count INTEGER DEFAULT 0,            -- 评价数（отзывы）
        brand TEXT DEFAULT '',                     -- 品牌（WB 卡片强字段，选品可参考）
        seller_name TEXT DEFAULT '',               -- 卖家名
        -- 竞争信号：WB 无 Ozon「其他卖家 N 家」，用「同搜索词相似款/品牌集中度」替代（见 competition_score）
        competition_score REAL DEFAULT 0,
        opportunity_score REAL DEFAULT 0,
        -- 六维评分（采集/回填时只算有实数据的维度，缺数据维度记入 sixdim_missing）
        conversion_score REAL DEFAULT 0,             -- 转化分 0~15（评论数+评分）
        demand_score REAL DEFAULT 0,                 -- 需求分 0~20（代理值：关键词近30天评价增量）
        pain_score REAL DEFAULT 0,                   -- 痛点分 0~20（差评规则分类提取）
        improve_score REAL DEFAULT 0,                -- 改造分 0~20（由痛点映射改造方向）
        follow_score REAL DEFAULT 0,                 -- 跟卖分 0~10（同关键词头部品牌评论集中度）
        sixdim_total REAL DEFAULT 0,                 -- 六维总分（满分100，各维按实数据计分）
        sixdim_missing TEXT DEFAULT '',              -- 缺失维度（逗号分隔，如 demand,pain,improve,follow）
        -- 评价抓取与洞察（真实数据，来自 WB card.json + feedbacks 接口）
        imt_id INTEGER DEFAULT 0,                    -- WB 合并卡 imt_id（评价接口按它查）
        review_sample INTEGER DEFAULT 0,             -- 已分析的评价样本数（最近 N 条）
        review_neg INTEGER DEFAULT 0,                -- 样本中差评数（1~3 星）
        review_recent30 INTEGER DEFAULT 0,           -- 样本中近30天评价数（需求代理的原料）
        review_recent_all INTEGER DEFAULT 0,         -- 样本中最新的评价日期距今跨度内合计（辅助）
        pain_json TEXT DEFAULT '',                   -- 痛点明细 JSON（[{key,label,count,fix}]）
        improve_json TEXT DEFAULT '',                -- 改造方向 JSON（字符串数组）
        review_neg_json TEXT DEFAULT '',             -- 差评原文样本 JSON（最多300条，供复核/重新分类）
        brand_share REAL DEFAULT 0,                  -- 同关键词头部品牌评论占比 0~1
        demand_proxy INTEGER DEFAULT 0,              -- 关键词近30天评价增量（需求代理原始值）
        review_checked_at TEXT DEFAULT '',           -- 评价回填时间（空=未抓取）
        source_1688_json TEXT DEFAULT '',            -- 1688 工具导出的完整原始 JSON（含 attributes/images，供发布建卡用）
        -- 1688 货源物理规格（来源采集工具，重量 g / 尺寸 cm）
        source_weight REAL DEFAULT 0,
        source_length REAL DEFAULT 0,
        source_width REAL DEFAULT 0,
        source_height REAL DEFAULT 0,
        -- 利润相关（前端可回填 1688 采购成本）
        purchase_cost REAL DEFAULT 0,
        shipping_cost REAL DEFAULT 0,
        profit_estimate REAL DEFAULT 0,
        profit_margin REAL DEFAULT 0,
        excluded INTEGER DEFAULT 0,                 -- 预筛排除标记（1=新店规则排除，列表不再展示）
        exclude_reason TEXT DEFAULT '',             -- 排除原因（分号分隔）
        collect_task_id INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(wb_nm_id)
      );

      CREATE INDEX IF NOT EXISTS idx_wb_products_keyword ON wb_market_products(keyword);
      CREATE INDEX IF NOT EXISTS idx_wb_products_category ON wb_market_products(category);
      CREATE INDEX IF NOT EXISTS idx_wb_products_score ON wb_market_products(opportunity_score);

      -- ===== 采集任务表 =====
      CREATE TABLE IF NOT EXISTS wb_collection_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT DEFAULT 'market_collect',
        keyword TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        total_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        skip_existing INTEGER DEFAULT 0,
        prescreen_dropped INTEGER DEFAULT 0,
        started_at TEXT DEFAULT (datetime('now')),
        finished_at TEXT DEFAULT (datetime('now')),
        error_message TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wb_tasks_status ON wb_collection_tasks(status);

      -- ===== 关键词池 =====
      CREATE TABLE IF NOT EXISTS wb_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT '',
        animal_type TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- ===== 成本配置（Phase 1：字段就位，费率待拉取 WB 官方值后填充）=====
      CREATE TABLE IF NOT EXISTS wb_cost_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commission_rate REAL DEFAULT 0,            -- WB 宠物类目佣金率【待确认官方值，当前 0=未配置】
        logistics_fbo_rate REAL DEFAULT 0,         -- FBO（平台仓配）费率【待确认】
        logistics_fbs_rate REAL DEFAULT 0,         -- FBS（卖家自发货）费率【待确认】
        advertising_rate REAL DEFAULT 0,           -- 广告费率，新产品默认 0
        other_cost REAL DEFAULT 0,
        currency TEXT DEFAULT 'RUB',
        target_margin REAL DEFAULT 0.25,
        promo_discount_rate REAL DEFAULT 0.10,     -- 促销余量（借鉴 Ozon，WB 待实测）
        multiplier_min REAL DEFAULT 45,            -- 市场倍率下限（借鉴 Ozon）
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * 表结构增量迁移：给已存在的老表补新增列（CREATE TABLE IF NOT EXISTS 不会改已存在的表）。
   */
  _migrate() {
    const cols = this.db.pragma('table_info(wb_market_products)').map(c => c.name);
    const addCol = (name, type) => {
      if (!cols.includes(name)) {
        this.db.exec(`ALTER TABLE wb_market_products ADD COLUMN ${name} ${type}`);
        console.log('[DB] 迁移：新增列 ' + name);
      }
    };
    addCol('source_weight', 'REAL DEFAULT 0');
    addCol('source_length', 'REAL DEFAULT 0');
    addCol('source_width', 'REAL DEFAULT 0');
    addCol('source_height', 'REAL DEFAULT 0');
    addCol('conversion_score', 'REAL DEFAULT 0');
    addCol('demand_score', 'REAL DEFAULT 0');
    addCol('pain_score', 'REAL DEFAULT 0');
    addCol('improve_score', 'REAL DEFAULT 0');
    addCol('follow_score', 'REAL DEFAULT 0');
    addCol('sixdim_total', 'REAL DEFAULT 0');
    addCol('sixdim_missing', "TEXT DEFAULT ''");
    addCol('imt_id', 'INTEGER DEFAULT 0');
    addCol('review_sample', 'INTEGER DEFAULT 0');
    addCol('review_neg', 'INTEGER DEFAULT 0');
    addCol('review_recent30', 'INTEGER DEFAULT 0');
    addCol('review_recent_all', 'INTEGER DEFAULT 0');
    addCol('pain_json', "TEXT DEFAULT ''");
    addCol('improve_json', "TEXT DEFAULT ''");
    addCol('review_neg_json', "TEXT DEFAULT ''");
    addCol('brand_share', 'REAL DEFAULT 0');
    addCol('demand_proxy', 'INTEGER DEFAULT 0');
    addCol('review_checked_at', "TEXT DEFAULT ''");
    addCol('excluded', 'INTEGER DEFAULT 0');
    addCol('exclude_reason', "TEXT DEFAULT ''");
    addCol('source_1688_json', "TEXT DEFAULT ''");
    addCol('head_leg_cny', 'REAL DEFAULT 0');      // 头程物流成本（元，OGL 计费）
    addCol('ogl_channel', "TEXT DEFAULT ''");      // OGL 渠道名（Budget/SMALL/Big...）
    addCol('suggest_price', 'REAL DEFAULT 0');     // 建议售价 ₽（按目标毛利率反推）
    addCol('suggest_margin', 'REAL DEFAULT 0');    // 建议毛利率 0~1
    addCol('market_supply', 'INTEGER DEFAULT 0');  // 该关键词的 WB 搜索结果总数（真实市场供给量，竞争维口径）
    this._migrateCostConfig();
  }

  /**
   * 成本配置迁移：补列（汇率/履约固定费/损耗率）+ 无配置行时初始化默认值。
   * 定价需要这些参数，否则无法反推售价。
   */
  _migrateCostConfig() {
    const cols = this.db.pragma('table_info(wb_cost_config)').map((c) => c.name);
    const addCol = (name, type) => {
      if (!cols.includes(name)) {
        this.db.exec(`ALTER TABLE wb_cost_config ADD COLUMN ${name} ${type}`);
        console.log('[DB] 迁移：wb_cost_config 新增列 ' + name);
      }
    };
    addCol('currency_rate', 'REAL DEFAULT 12');   // 汇率：1 元 ≈ N 卢布
    addCol('rub_fee', 'REAL DEFAULT 90');         // 平台履约/仓配等固定费（₽/件）
    addCol('loss_rate', 'REAL DEFAULT 0.05');     // 退货/损耗率
    const cnt = this.db.prepare('SELECT COUNT(*) AS c FROM wb_cost_config').get().c;
    if (!cnt) {
      this.db.prepare(
        "INSERT INTO wb_cost_config (commission_rate, target_margin, currency_rate, rub_fee, loss_rate, updated_at) VALUES (0.15, 0.25, 12, 90, 0.05, datetime('now'))"
      ).run();
      console.log('[DB] 初始化默认成本配置：佣金15% / 目标毛利25% / 汇率12 / 履约90₽ / 损耗5%');
    }
  }

  /** 读取成本配置（缺省值兜底，保证定价随时可用） */
  getCostConfig() {
    const row = this.db.prepare('SELECT * FROM wb_cost_config ORDER BY id LIMIT 1').get() || {};
    return {
      commissionRate: row.commission_rate > 0 ? row.commission_rate : 0.15,
      targetMargin: row.target_margin > 0 ? row.target_margin : 0.25,
      currencyRate: row.currency_rate > 0 ? row.currency_rate : 12,
      rubFee: row.rub_fee != null ? row.rub_fee : 90,
      lossRate: row.loss_rate != null ? row.loss_rate : 0.05,
    };
  }
}

module.exports = WbDatabase;