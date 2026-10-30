/**
 * WB 选品工具 - 入口
 * Phase 1 导出核心模块，供脚本/前端调用
 */
const WbDatabase = require('./db/database');
const WbScoring = require('./analyzer/scoring');
const WbPricing = require('./analyzer/pricing');
const { WbMarketApiClient } = require('./collector/wbCollector');
const { DEFAULT_PET_KEYWORDS } = require('./config/petKeywords');

module.exports = {
  WbDatabase,
  WbScoring,
  WbPricing,
  WbMarketApiClient,
  DEFAULT_PET_KEYWORDS
};