/**
 * 1688 货源匹配客户端（WB 独立版，自含无外部依赖）
 *
 * 功能：
 *   1. 俄文标题 → 中文关键词翻译（基于词库，半自动）
 *   2. 构建 1688 搜索 URL / 图搜 URL
 *   3. 解析 1688 详情页 HTML（title/价格/重量/尺寸/图片/运费）
 *
 * 说明：WB 独立项目不复用 Ozon 工具运行时代码，仅移植「翻译 + 解析」纯逻辑，
 *       并去掉 Ozon 侧的 HTTP/代理抓取路线（WB 沙箱无 https-proxy-agent，且 1688
 *       HTTP 抓取反爬成功率低）。实际抓取统一走 ali1688Playwright.js（登录态）。
 */
class Ali1688Client {
  // 俄文→中文核心商品词库（宠物用品为主，覆盖 WB 种子词的垂直品类）
  get RU_CN_DICT() {
    return [
      // ===== 宠物核心 =====
      { ru: 'когтеточка', cn: '猫抓板' },
      { ru: 'когтеточ', cn: '猫抓板' },
      { ru: 'столбик', cn: '猫抓柱' },
      { ru: 'столб', cn: '柱' },
      { ru: 'кошка', cn: '猫' },
      { ru: 'кошек', cn: '猫' },
      { ru: 'кот', cn: '猫' },
      { ru: 'котенок', cn: '小猫' },
      { ru: 'собака', cn: '狗' },
      { ru: 'собак', cn: '狗' },
      { ru: 'щенок', cn: '小狗' },
      { ru: 'лежанка', cn: '宠物窝' },
      { ru: 'домик', cn: '猫窝' },
      { ru: 'диван', cn: '猫沙发' },
      { ru: 'поводок', cn: '牵引绳' },
      { ru: 'ошейник', cn: '项圈' },
      { ru: 'шлейка', cn: '胸背带' },
      { ru: 'игрушка', cn: '玩具' },
      { ru: 'игрушк', cn: '玩具' },
      { ru: 'интерактивн', cn: '互动玩具' },
      { ru: 'мяч', cn: '球' },
      { ru: 'удочка', cn: '逗猫棒' },
      { ru: 'дразнилка', cn: '逗猫棒' },
      { ru: 'канат', cn: '狗咬绳' },
      { ru: 'миска', cn: '宠物碗' },
      { ru: 'кормушка', cn: '喂食器' },
      { ru: 'поилка', cn: '饮水器' },
      { ru: 'автопоилка', cn: '自动饮水机' },
      { ru: 'лоток', cn: '猫砂盆' },
      { ru: 'наполнитель', cn: '猫砂' },
      { ru: 'переноска', cn: '宠物包' },
      { ru: 'расческа', cn: '宠物梳' },
      { ru: 'когтерез', cn: '宠物指甲剪' },
      { ru: 'фурминатор', cn: '宠物梳' },
      { ru: 'щетка', cn: '刷子' },
      { ru: 'одежда', cn: '衣服' },
      { ru: 'питомец', cn: '宠物' },
      { ru: 'животное', cn: '动物' },
      // ===== 通用属性 =====
      { ru: 'настенн', cn: '壁挂' },
      { ru: 'картонн', cn: '瓦楞纸' },
      { ru: 'с мятой', cn: '猫薄荷' },
      { ru: 'кошачьей мятой', cn: '猫薄荷' },
      { ru: 'большой', cn: '大号' },
      { ru: 'маленький', cn: '小号' },
      { ru: 'комплект', cn: '套装' },
      { ru: 'набор', cn: '套装' },
      { ru: 'новый', cn: '新款' },
    ];
  }

  // 停用词（不翻译/不作为关键词）
  get STOP_WORDS() {
    return new Set([
      'и', 'в', 'на', 'с', 'для', 'от', 'до', 'по', 'из', 'не', 'что', 'это', 'как', 'или', 'но',
      'the', 'a', 'an', 'of', 'for', 'with', 'and', 'or', 'to', 'in', 'on'
    ]);
  }

  /**
   * 俄文标题 → 中文关键词（空格分隔）
   */
  translateRuToCn(russianTitle) {
    if (!russianTitle) return '';
    const lower = russianTitle.toLowerCase();
    const tokens = lower.split(/[^a-zа-яё0-9]+/i).filter(t => t && !this.STOP_WORDS.has(t));

    const matched = [];
    const usedTokens = new Set();
    const dict = this.RU_CN_DICT;
    const sortedDict = [...dict].sort((a, b) => b.ru.length - a.ru.length);

    // 词组匹配（优先长词组）
    for (const item of sortedDict) {
      if (lower.includes(item.ru)) {
        if (!matched.includes(item.cn)) matched.push(item.cn);
        for (const t of tokens) {
          if (t.includes(item.ru) || item.ru.includes(t)) usedTokens.add(t);
        }
      }
    }

    // 未匹配的 token 保留数字/英文型号
    for (const t of tokens) {
      if (usedTokens.has(t)) continue;
      if (/^\d+$/.test(t) && t.length <= 4) matched.push(t);
      else if (/^[a-z]{2,6}$/i.test(t)) matched.push(t);
    }

    return matched.slice(0, 6).join(' ');
  }

  /**
   * 构建 1688 搜索 URL
   */
  buildSearchUrl(russianTitle) {
    const kw = this.translateRuToCn(russianTitle);
    return {
      keyword: kw,
      search_url: kw ? `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}` : 'https://www.1688.com/',
      image_search_url: 'https://image.1688.com/'
    };
  }

  /**
   * 从 1688 商品 URL 提取 offerId
   */
  parseOfferId(url) {
    if (!url) return null;
    const m = url.match(/offer\/(\d+)/) || url.match(/^(\d{6,})$/);
    return m ? m[1] : null;
  }

  /**
   * 解析 1688 详情页 HTML，提取标题/价格/重量/尺寸/运费
   * 优先从内联 JSON（window.__INIT_DATA__）解析，失败/缺失时用正则兜底。
   */
  parseDetailHtml(html) {
    const info = {
      source_title: '',
      source_price: 0,
      source_supplier: '',
      source_weight: 0,
      source_length: 0,
      source_width: 0,
      source_height: 0,
      source_freight: 0,
      source_images: '[]'
    };

    // ① 优先：内联 JSON
    const jsonBlob = this._extractInlineJson(html);
    if (jsonBlob) {
      let data = null;
      try { data = JSON.parse(jsonBlob); } catch (e) { data = null; }
      if (data) {
        const t = this._findVal(data, ['subject', 'title', 'offerSubject', 'name', 'wgux_title']);
        if (t && typeof t === 'string' && t.trim()) {
          info.source_title = t.trim().replace(/-阿里巴巴|_阿里巴巴|1688\.com.*$/g, '').trim();
        }
        const prices = this._collectPrices(data, 8);
        if (prices.length) info.source_price = Math.min(...prices);
        const w = this._findVal(data, ['unitWeight', 'weight', 'singleWeightG', 'listingWeight']);
        const wtNum = this._toNum(w);
        if (wtNum > 0) info.source_weight = wtNum;
        const dims = this._findVal(data, ['dimension', 'dimensions']);
        if (dims && typeof dims === 'object') {
          const dL = this._toNum(dims.length || dims.depth), dW = this._toNum(dims.width), dH = this._toNum(dims.height);
          if (dL > 0) info.source_length = dL;
          if (dW > 0) info.source_width = dW;
          if (dH > 0) info.source_height = dH;
        }
        const imgArr = this._collectImages(data, 8);
        if (imgArr.length) info.source_images = JSON.stringify(imgArr);
      }
    }

    // ② 兜底：正则
    if (!info.source_title) {
      const tm = html.match(/<title>([^<]+)<\/title>/i)
        || html.match(/<meta[^>]+og:title["'\s]+content=["']([^"']+)["']/i)
        || html.match(/"subject"\s*:\s*"([^"]+)"/);
      if (tm) info.source_title = tm[1].trim().replace(/-阿里巴巴|_阿里巴巴|1688\.com.*$/g, '').trim();
    }
    if (!info.source_price) {
      const pm = html.match(/"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/)
        || html.match(/"priceRange"\s*:\s*\{[^}]*"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/)
        || html.match(/价格[：:]\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/)
        || html.match(/class="price"[^>]*>\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
      if (pm) info.source_price = parseFloat(pm[1]);
    }
    if (!info.source_supplier) {
      const sm = html.match(/"companyName"\s*:\s*"([^"]+)"/)
        || html.match(/class="company-name"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/)
        || html.match(/店铺[：:]\s*([^<\n]+)/);
      if (sm) info.source_supplier = sm[1].trim();
    }
    if (!info.source_images || info.source_images === '[]' || info.source_images === '') {
      const images = [];
      const imgRegex = /"image"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = imgRegex.exec(html)) && images.length < 8) {
        const url = m[1].replace(/\\u002F/g, '/');
        if (!images.includes(url)) images.push(url);
      }
      if (images.length === 0) {
        const imgRegex2 = /<img[^>]+src=["'](https:[^"']+(?:cbu01|cbuimg)\.alicdn[^"']+)["']/gi;
        while ((m = imgRegex2.exec(html)) && images.length < 8) {
          if (!images.includes(m[1])) images.push(m[1]);
        }
      }
      info.source_images = JSON.stringify(images);
    }
    if (!info.source_weight) {
      const wm = html.match(/重量[：:]\s*(\d+(?:\.\d+)?)\s*(g|kg|克|千克|公斤)?/i)
        || html.match(/"weight"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
      if (wm) {
        let w = parseFloat(wm[1]);
        const unit = (wm[2] || '').toLowerCase();
        if (unit === 'kg' || unit === '千克' || unit === '公斤') w *= 1000;
        info.source_weight = w;
      }
    }

    // ③ 包装信息容器 od-pc-offer-table：重量/运费/尺寸（跨 cell）
    const wrapIdx = html.indexOf('od-pc-offer-table');
    const region = wrapIdx >= 0 ? html.slice(wrapIdx, wrapIdx + 12000) : html;
    const numAfter = (kw, span = 260) => {
      const i = region.indexOf(kw);
      if (i < 0) return null;
      const seg = region.slice(i, i + span);
      const m = seg.match(/(\d+(?:\.\d+)?)/);
      return m ? { n: parseFloat(m[1]), seg } : null;
    };

    if (!info.source_weight) {
      const wm = numAfter('重量');
      if (wm && wm.n) {
        let w = wm.n;
        if (/(千克|公斤|kg)\b/i.test(wm.seg)) w *= 1000;
        info.source_weight = w;
      }
    }
    const freightNum = numAfter('运费') || numAfter('快递费') || numAfter('快递');
    if (freightNum) info.source_freight = freightNum.n;

    if (!info.source_length && !info.source_width) {
      let sizeMatch = null;
      const seg = numAfter('尺寸') || numAfter('长');
      if (seg) {
        const m = seg.seg.match(/(?:尺寸|长)[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)/i)
          || seg.seg.match(/([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*(cm|厘米)?/i);
        if (m) {
          const v = [+m[1], +m[2], +m[3]];
          if (v.every(n => n > 0 && n <= 500) && v[0] >= v[2]) sizeMatch = m;
        }
      }
      if (!sizeMatch) {
        const generic = region.match(/([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*(cm|厘米)?/i);
        if (generic) {
          const v = [+generic[1], +generic[2], +generic[3]];
          if (v.every(n => n > 0 && n <= 500) && v[0] >= v[2]) sizeMatch = generic;
        }
      }
      if (sizeMatch) {
        info.source_length = parseFloat(sizeMatch[1]);
        info.source_width = parseFloat(sizeMatch[2]);
        info.source_height = parseFloat(sizeMatch[3]);
      }
    }

    return info;
  }

  _extractInlineJson(html) {
    const patterns = [
      /window\.__INIT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*\n?<\/script>/i,
      /window\.__INIT_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i,
      /<script[^>]+type=["']application\/json["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/i
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  _findVal(obj, keys, depth = 0) {
    if (obj == null || depth > 8) return undefined;
    if (Array.isArray(obj)) {
      for (const it of obj) {
        const r = this._findVal(it, keys, depth + 1);
        if (r !== undefined) return r;
      }
      return undefined;
    }
    if (typeof obj === 'object') {
      const lowerKeys = keys.map(k => String(k).toLowerCase());
      for (const k of Object.keys(obj)) {
        if (lowerKeys.includes(String(k).toLowerCase()) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
      }
      for (const k of Object.keys(obj)) {
        const r = this._findVal(obj[k], keys, depth + 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }

  _collectPrices(obj, maxDepth, depth = 0, out = []) {
    if (obj == null || depth > maxDepth) return out;
    if (Array.isArray(obj)) { for (const it of obj) this._collectPrices(it, maxDepth, depth + 1, out); return out; }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const lk = String(k).toLowerCase();
        const v = obj[k];
        if ((lk.includes('price') || lk.includes('money')) && typeof v === 'number' && v > 0 && v < 1e7) out.push(v);
        else if (lk.includes('price') && typeof v === 'string' && v && !/[a-zа-я]/i.test(v)) {
          const n = parseFloat(v);
          if (!isNaN(n) && n > 0 && n < 1e7) out.push(n);
        }
        if (typeof v === 'object') this._collectPrices(v, maxDepth, depth + 1, out);
      }
    }
    return out;
  }

  _collectImages(obj, maxLen, depth = 0, out = []) {
    if (obj == null || out.length >= maxLen || depth > 8) return out;
    if (typeof obj === 'string') {
      if (/^https?:\/\/[^"'\s]*ali[ck]dn\.com\/[^\s]*\.(jpg|jpeg|png|webp)([?#]|$)/i.test(obj)) {
        const u = obj.replace(/\\u002F/g, '/');
        if (!out.includes(u)) out.push(u);
      }
      return out;
    }
    if (Array.isArray(obj)) { for (const it of obj) { this._collectImages(it, maxLen, depth + 1, out); if (out.length >= maxLen) break; } return out; }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'object') { this._collectImages(v, maxLen, depth + 1, out); if (out.length >= maxLen) break; }
      }
    }
    return out;
  }

  _toNum(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v > 0 ? v : 0;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
    return 0;
  }
}

module.exports = Ali1688Client;