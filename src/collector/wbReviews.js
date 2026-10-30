/**
 * WB 评价/卡片抓取客户端（真实数据，无模拟）
 *
 * 数据来源（2026-10 实测可用，无需登录 Cookie）：
 *  1) 静态卡片：https://basket-XX.{wbbasket.ru | wildberries.cn}/vol{vol}/part{part}/{nm}/info/ru/card.json
 *     → 拿到 imt_id（评价接口主键）、品牌名。
 *     注意：新号段商品只挂在 wildberries.cn 域名（旧号段在 wbbasket.ru），两者路径一致。
 *  2) 评价接口：https://feedbacks1.wb.ru/feedbacks/v1/{imt_id}
 *     → 真实评价（text / pros / cons / productValuation / createdDate），接口返回最近 1000 条。
 *
 * 主机定位：basket 主机号不按 vol 线性分配，因此：
 *  - 号段(vol/1000) 命中缓存（data/basket_hosts.json）→ 直接用；
 *  - 旧号段(≤4565) → 静态映射表；
 *  - 新号段 → 1~60 号主机 × 双域名分批探测，命中后写入缓存（后续零探测）。
 * 也可由调用方用 setHostFromUrl() 把浏览器里看到的 card.json 地址写入缓存。
 */
const fs = require('fs');
const path = require('path');

const HOST_CACHE_FILE = path.resolve(__dirname, '../../data/basket_hosts.json');
const DOMAINS = ['wbbasket.ru', 'wildberries.cn'];

const HOST_MAP = [
  [0, 143, 1], [144, 287, 2], [288, 431, 3], [432, 719, 4], [720, 1007, 5],
  [1008, 1061, 6], [1062, 1115, 7], [1116, 1169, 8], [1170, 1313, 9], [1314, 1601, 10],
  [1602, 1655, 11], [1656, 1919, 12], [1920, 2045, 13], [2046, 2189, 14], [2190, 2405, 15],
  [2406, 2621, 16], [2622, 2837, 17], [2838, 3053, 18], [3054, 3269, 19], [3270, 3485, 20],
  [3486, 3702, 21], [3703, 3917, 22], [3918, 4133, 23], [4134, 4349, 24], [4350, 4565, 25]
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'ru-RU,ru;q=0.9'
};

function loadHostCache() {
  try { return JSON.parse(fs.readFileSync(HOST_CACHE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function saveHostCache(obj) {
  try {
    fs.mkdirSync(path.dirname(HOST_CACHE_FILE), { recursive: true });
    fs.writeFileSync(HOST_CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {}
}

function mappedHost(vol) {
  const hit = HOST_MAP.find(([a, b]) => vol >= a && vol <= b);
  return hit ? `basket-${String(hit[2]).padStart(2, '0')}` : null;
}

/** 用 "basket-38.wildberries.cn" / "basket-38" 生成探测地址 */
function cardUrl(hostName, vol, part, nm) {
  const full = hostName.includes('.') ? hostName : `${hostName}.${DOMAINS[0]}`;
  return `https://${full}/vol${vol}/part${part}/${nm}/info/ru/card.json`;
}

async function probe(hostName, vol, part, nm, timeoutMs = 4000) {
  const url = cardUrl(hostName, vol, part, nm);
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(String(res.status));
  return { host: hostName, json: await res.json() };
}

class WbReviewClient {
  constructor() {
    this.hostBand = loadHostCache(); // 号段(vol/1000) → "basket-38.wildberries.cn"
  }

  /** 记录号段主机（可由浏览器 card.json 请求地址反推） */
  setHost(band, hostName) {
    this.hostBand[band] = hostName;
    saveHostCache(this.hostBand);
  }

  /** 从实际 card.json URL 反推主机并缓存，例：https://basket-38.wildberries.cn/vol8460/... */
  setHostFromUrl(url) {
    const m = String(url).match(/basket-(\d{1,2})\.(wbbasket\.ru|wildberries\.cn)/);
    const v = url.match(/vol(\d+)/);
    if (!m || !v) return null;
    const hostName = `basket-${m[1]}.${m[2]}`;
    const band = Math.floor(parseInt(v[1], 10) / 1000);
    this.setHost(band, hostName);
    return { band, hostName };
  }

  /** 取静态卡片信息（imt_id / 品牌） */
  async getCard(nmId) {
    const nm = parseInt(nmId, 10);
    if (!nm) return { ok: false, error: 'nm 无效' };
    const vol = Math.floor(nm / 100000);
    const part = Math.floor(nm / 1000);
    const band = Math.floor(vol / 1000);

    const wrap = (r) => ({
      ok: true,
      host: r.host,
      imtId: parseInt(r.json.imt_id, 10) || 0,
      brand: (r.json.selling && r.json.selling.brand_name) || r.json.brand_name || '',
      name: r.json.imt_name || r.json.subj_name || ''
    });

    // 1) 号段缓存（主机号按 vol 段顺序分配，同号段内可能落在相邻主机，故按 ±2 邻近试）
    const cached = this.hostBand[band];
    if (cached) {
      const base = parseInt((cached.match(/basket-(\d+)/) || [])[1], 10);
      if (base) {
        for (const delta of [0, 1, -1, 2, -2]) {
          const h = base + delta;
          if (h < 1 || h > 99) continue;
          for (const d of DOMAINS) {
            const r = await probe(`basket-${String(h).padStart(2, '0')}.${d}`, vol, part, nm, 5000).catch(() => null);
            if (r) return wrap(r);
          }
        }
      }
      delete this.hostBand[band];
    }

    // 2) 旧号段映射表
    const mapped = mappedHost(vol);
    if (mapped) {
      for (const d of DOMAINS) {
        const r = await probe(`${mapped}.${d}`, vol, part, nm, 6000).catch(() => null);
        if (r) { this.setHost(band, r.host); return wrap(r); }
      }
    }

    // 3) 兜底：1~60 号主机 × 双域名，分批探测（每批 6 个主机）
    for (let start = 1; start <= 60; start += 6) {
      const tasks = [];
      for (let h = start; h < start + 6 && h <= 60; h++) {
        for (const d of DOMAINS) {
          tasks.push(probe(`basket-${String(h).padStart(2, '0')}.${d}`, vol, part, nm, 4000).catch(() => null));
        }
      }
      const results = await Promise.all(tasks);
      const hit = results.find(Boolean);
      if (hit) { this.setHost(band, hit.host); return wrap(hit); }
    }

    return { ok: false, error: 'card.json 全部主机未命中' };
  }

  /** 取评价列表（最近 1000 条，v1 接口对 imt_id 有效） */
  async getFeedbacks(imtId) {
    const id = parseInt(imtId, 10);
    if (!id) return { ok: false, error: 'imt_id 无效' };
    for (const host of ['feedbacks1.wb.ru', 'feedbacks2.wb.ru']) {
      try {
        const res = await fetch(`https://${host}/feedbacks/v1/${id}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const j = await res.json();
        return {
          ok: true,
          host,
          count: parseInt(j.feedbackCount, 10) || 0,
          withText: parseInt(j.feedbackCountWithText, 10) || 0,
          valuation: parseFloat(j.valuation) || 0,
          distribution: j.valuationDistributionPercent || null,
          reviews: Array.isArray(j.feedbacks) ? j.feedbacks : []
        };
      } catch (e) {}
    }
    return { ok: false, error: 'feedbacks 全部主机未命中' };
  }

  /** 取「商品 + 评价」合并数据 */
  async getProductReviews(nmId) {
    const card = await this.getCard(nmId);
    if (!card.ok) return { ok: false, error: card.error };
    const fb = await this.getFeedbacks(card.imtId);
    return {
      ok: true,
      imtId: card.imtId,
      brand: card.brand,
      name: card.name,
      feedbacks: fb.ok ? fb : { count: 0, withText: 0, reviews: [] }
    };
  }
}

module.exports = { WbReviewClient, HOST_CACHE_FILE };
