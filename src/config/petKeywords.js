/**
 * WB 选品工具 - 宠物种子词库
 * 俄文搜索词为平台中立数据，直接复用 Ozon 工具已验证的宠物词。
 * 此处为「种子词库」，可从 ozon-product-finder 的 petKeywords.js 全量导入扩展。
 *
 * 采集口径沿用用户既定约束：
 *  - 排除衣服/鞋子/猫粮，仅保留宠物用品
 *  - 排除药品/保健品（维生素/驱虫药/补充剂等，由采集器标题正则拦截）
 */
const DEFAULT_PET_KEYWORDS = [
  // ===== 猫用品-抓板/磨爪 =====
  { keyword: 'когтеточка', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка настенная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка картонная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка домик', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'столбик для когтей', category: '猫用品-抓板', animalType: 'cat' },

  // ===== 猫用品-玩具 =====
  { keyword: 'игрушка для кошек', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'интерактивная игрушка для кошек', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'мяч для кошек', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'удочка для кошек', category: '猫用品-玩具', animalType: 'cat' },

  // ===== 猫用品-窝/垫 =====
  { keyword: 'лежанка для кошки', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'домик для кошки', category: '猫用品-窝', animalType: 'cat' },

  // ===== 猫用品-食盆/饮水 =====
  { keyword: 'миска для кошек', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'автопоилка для кошек', category: '猫用品-餐具', animalType: 'cat' },

  // ===== 猫用品-护理/清洁 =====
  { keyword: 'расческа для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'когтерез для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'лоток для кошек', category: '猫用品-清洁', animalType: 'cat' },

  // ===== 猫用品-出行 =====
  { keyword: 'переноска для кошек', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'шлейка для кошки', category: '猫用品-出行', animalType: 'cat' },

  // ===== 猫沙发（独立类目，价格地板另配）=====
  { keyword: 'диван для кошек', category: '猫用品-沙发', animalType: 'cat' },

  // ===== 狗用品-玩具 =====
  { keyword: 'игрушка для собак', category: '狗用品-玩具', animalType: 'dog' },
  { keyword: 'мяч для собак', category: '狗用品-玩具', animalType: 'dog' },
  { keyword: 'канат для собак', category: '狗用品-玩具', animalType: 'dog' },

  // ===== 狗用品-餐具 =====
  { keyword: 'миска для собак', category: '狗用品-餐具', animalType: 'dog' },

  // ===== 狗用品-护理/美容 =====
  { keyword: 'расческа для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'когтерез для собак', category: '狗用品-美容', animalType: 'dog' },

  // ===== 狗用品-出行/训练 =====
  { keyword: 'поводок для собак', category: '狗用品-项圈', animalType: 'dog' },
  { keyword: 'ошейник для собак', category: '狗用品-项圈', animalType: 'dog' },
  { keyword: 'шлейка для собак', category: '狗用品-项圈', animalType: 'dog' },

  // ===== 猫用品-抓板（长尾扩展，来自 ozon 已验证词库）=====
  { keyword: 'когтеточка напольная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с игрушкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с кошачьей мятой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка большая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для крупных кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка sisal', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка джутовая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'точилка для когтей кошкам', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'напольная когтеточка для кошек', category: '猫用品-抓板', animalType: 'cat' },

  // ===== 猫用品-玩具 =====
  { keyword: 'мышка для кошек', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'лазер для кошек', category: '猫用品-玩具', animalType: 'cat' },

  // ===== 猫用品-窝 =====
  { keyword: 'когтеточка лежанка', category: '猫用品-窝', animalType: 'cat' },

  // ===== 猫用品-清洁/护理 =====
  { keyword: 'коврик для кошачьего туалета', category: '猫用品-清洁', animalType: 'cat' },
  { keyword: 'пуходерка для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'щетка для кошек', category: '猫用品-护理', animalType: 'cat' },

  // ===== 狗用品-窝 =====
  { keyword: 'лежанка для собак', category: '狗用品-窝', animalType: 'dog' },

  // ===== 扩充词库（10 个新细分品类，用于补充增量采集）=====
  { keyword: 'тоннель для кошек', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'игрушка для котят', category: '猫用品-玩具', animalType: 'cat' },
  { keyword: 'фонтан для кошек', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'автокормушка для кошек', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'гамак для кошек', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'закрытый лоток для кошек', category: '猫用品-清洁', animalType: 'cat' },
  { keyword: 'намордник для собак', category: '狗用品-项圈', animalType: 'dog' },
  { keyword: 'рулетка для собак', category: '狗用品-项圈', animalType: 'dog' },
  { keyword: 'поилка для собак', category: '狗用品-餐具', animalType: 'dog' },
  { keyword: 'домик для собак', category: '狗用品-窝', animalType: 'dog' },
];

module.exports = { DEFAULT_PET_KEYWORDS };