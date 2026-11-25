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

  // ===== 猫抓板长尾（二次扩充，用于定向补量）=====
  { keyword: 'когтеточка деревянная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с лежанкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка угловая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка настенная деревянная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка столбик с лежанкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'коврик для когтей', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для котят', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из картона большая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с домиком', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка 3 в 1', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка комплекс', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка башня', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из сизаля', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка подвесная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для мебели', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с полками', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с гамаком', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для стенки', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка столбик картонный', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из джута', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с мячиком', category: '猫用品-抓板', animalType: 'cat' },

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

  // ===== 护理美容扩充（轻小、免认证、1688 货源充足，新手主攻方向）=====
  { keyword: 'фурминатор для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'расческа для вычесывания кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'щетка для вычесывания шерсти', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'рукавица для вычесывания шерсти', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'перчатка для вычесывания шерсти', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'колтунорез для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'расческа антиколтун для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'когтерезка для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'щетка для мытья кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'зубная щетка для кошек', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'полотенце для кошек микрофибра', category: '猫用品-护理', animalType: 'cat' },
  { keyword: 'насадка для вычесывания шерсти', category: '猫用品-护理', animalType: 'cat' },

  { keyword: 'фурминатор для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'пуходерка для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'щетка для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'рукавица для вычесывания собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'когтерезка для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'колтунорез для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'лапомойка для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'полотенце для собак микрофибра', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'зубная щетка для собак', category: '狗用品-美容', animalType: 'dog' },
  { keyword: 'расческа для вычесывания собак', category: '狗用品-美容', animalType: 'dog' },

  // ===== 猫抓板中高客单扩充（大件/组合/木质，客单 ₽1200 以上为主）=====
  { keyword: 'когтеточка большая деревянная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из дерева', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка напольная большая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для больших кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с лежанкой большая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с домиком и лежанкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка комплекс большой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для двух кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка многоуровневая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка потолочная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка настенная большая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с тоннелем', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка стойка', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка кровать', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка 4 в 1', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка премиум', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для крупных кошек напольная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка столбик высокий', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с полками настенная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка домик с лежанкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из ротанга', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для мебели угловая', category: '猫用品-抓板', animalType: 'cat' },

  // ===== 宠物服饰（300g 级轻小件，客单 ₽1500–2500，₽/kg 高）=====
  { keyword: 'комбинезон для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'куртка для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'свитер для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'дождевик для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'жилет для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'попона для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'костюм для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'одежда для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'комбинезон для кошек', category: '猫用品-服饰', animalType: 'cat' },
  { keyword: 'свитер для кошек', category: '猫用品-服饰', animalType: 'cat' },
  { keyword: 'одежда для кошек', category: '猫用品-服饰', animalType: 'cat' },
  { keyword: 'костюм для кошек', category: '猫用品-服饰', animalType: 'cat' },

  // ===== 宠物出行（200–400g 配件 + 1kg 级外出包，客单 ₽1300–3500）=====
  { keyword: 'переноска для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'рюкзак для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'сумка для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'рулетка для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'поводок рулетка для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'адресник для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'намордник для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'автогамак для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'ремень безопасности для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'рюкзак для кошек', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'сумка переноска для кошек', category: '猫用品-出行', animalType: 'cat' },

  // ===== 躺垫/沙发造型（已验证出单的差异化方向：抓板与躺垫一体）=====
  { keyword: 'диван для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'когтеточка диван', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'когтеточка лежанка', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'лежанка для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'лежанка для кошек большая', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'лежанка для кошек с бортиком', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'лежанка когтеточка для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'когтеточка с гамаком', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'гамак для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'домик для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'домик лежанка для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'кровать для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'пуф для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'кресло для кошек', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'лежанка для кошек из картона', category: '猫用品-沙发', animalType: 'cat' },
  { keyword: 'когтеточка трансформер', category: '猫用品-沙发', animalType: 'cat' },

  // ===== 蓝海长尾（实测供给 <1.5万 且 Top 商品评价 <100，通得过新店「评论>100 排除」规则）=====
  { keyword: 'кровать для кошек с балдахином', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'лежанка для кошек из дерева', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'матрас для кошек', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'подушка для кошек', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'одеяло для кошек', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'домик для кошек с когтеточкой', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'лежанка для кошек с подогревом', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'когтеточка потолочная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка настенная деревянная', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с тоннелем', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для двух кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'комплекс для кошек настенный', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка из дерева на стену', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'фонтан для кошек керамический', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'поилка для кошек керамическая', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'миска для кошек с наклоном', category: '猫用品-餐具', animalType: 'cat' },
  { keyword: 'сумка переноска для кошек с колесами', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'переноска для кошек рюкзак', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'туалет для кошек с крышкой', category: '猫用品-清洁', animalType: 'cat' },
  { keyword: 'лоток для кошек с сеткой', category: '猫用品-清洁', animalType: 'cat' },
  { keyword: 'лежанка для собак ортопедическая', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'лежанка для собак охлаждающая', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'коврик для собак охлаждающий', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'будка для собак уличная', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'бассейн для собак', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'пандус для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'лестница для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'гамак для собак', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'халат для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'фартук для собак', category: '狗用品-服饰', animalType: 'dog' },
  { keyword: 'намордник для собак кожаный', category: '狗用品-项圈', animalType: 'dog' },
  { keyword: 'игрушка для собак из натуральной резины', category: '狗用品-玩具', animalType: 'dog' },
  { keyword: 'рюкзак для собак', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'коляска для собак', category: '狗用品-出行', animalType: 'dog' },

  // ===== 用户指定词（2026-11-11）：猫抓板/猫窝/狗窝/出行 =====
  { keyword: 'когтеточка с домиком для кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с лежанкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка для крупных кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка настенная сизалевая', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка угловая для кошек', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'домик для кошек с когтеточкой', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'когтеточка столбик с площадкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'когтеточка с заменяемой вставкой', category: '猫用品-抓板', animalType: 'cat' },
  { keyword: 'домик для кошек закрытый', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'домик для кошек складной', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'домик для кошек из фетра', category: '猫用品-窝', animalType: 'cat' },
  { keyword: 'лежанка для собак большая с бортиками', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'лежанка для собак водонепроницаемая', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'лежанка для крупных собак', category: '狗用品-窝', animalType: 'dog' },
  { keyword: 'сумка переноска для кошек с жестким дном', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'рюкзак переноска для кошек', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'переноска для животных складная', category: '猫用品-出行', animalType: 'cat' },
  { keyword: 'автогамак для собак водонепроницаемый', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'манеж для собак складной', category: '狗用品-出行', animalType: 'dog' },
  { keyword: 'вольер для собак домашний', category: '狗用品-出行', animalType: 'dog' },
];

module.exports = { DEFAULT_PET_KEYWORDS };