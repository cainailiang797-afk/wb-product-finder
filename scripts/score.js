/**
 * 六维评分回填（已并入 scripts/deepscore.js）
 * 用法：node scripts/score.js 等同 node scripts/deepscore.js
 *
 * 原脚本只算「转化+竞争」两维（满分30），会把 需求/痛点/改造/跟卖 四维重置为缺失，
 * 已废弃，统一走 deepscore.js（真实评价 + 关键词代理），避免两套口径互相覆盖。
 */
console.log('[score] 已并入 deepscore.js，转执行六维全量回填...');
require('./deepscore');
