# -*- coding: utf-8 -*-
"""
用 WB 搜索分析数据重建关键词库：只保留「供需比 > 1 的非消耗品词」。

供需比 = 搜索量 / 商品数量（= 同样一次搜索能分到几个商品，越大越好挖）。
用法:
  python scripts/rebuild_keywords.py                 # 只统计，不写库
  python scripts/rebuild_keywords.py --apply         # 写库（自动备份旧词库）
  python scripts/rebuild_keywords.py --min-ratio 1 --min-volume 300 --max-words 600 --apply
"""
import sys, os, re, sqlite3, argparse, datetime

sys.stdout.reconfigure(encoding='utf-8')
DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'wb_agent.db')

# ---- 消耗品 / 服务 / 活体：一律排除（不做一次性商品）----
CONSUMABLE = re.compile(
    r'корм(?!ушк)|лакомств|наполнитель|пеленк|салфетк|шампун|кондиционер|бальзам|'
    r'зубн|паст[аы]|витамин|таблетк|капл|спрей|гель\b|порошок|'
    r'блох|клещ|гельминт|антигельминт|ветеринар|лекарств|антибиотик|'
    r'обезбол|противовоспал|ранозаживл|антисептик|дезинфек|'
    r'ракушк|для кур|курей|петух|котенок|щенок|'
    r'ошейник от|жидк|сироп|'
    # 非卖品/违禁/无关：捕猫笼、捕鼠器、超大功率激光、литр 规格鱼缸（易碎超重）
    r'котоловк|кошколовк|ловушк|мышеловк|50\s*км|хоббихорс|'
    r'гроб|противоблош|блошин|съедобн|своими руками|бельчатник|эшо\b|'
    r'тренажер для собак|'
    # 俄文化品牌名（拉丁过滤抓不到）
    r'зооателье|есебока|тузик|софи\b', re.I)

# 含拉丁词的多半是品牌/型号（xiaomi / royal canin / whiskas…），只放行常见通用缩写
LATIN_OK = {'3d', '4d', 'xl', 'xxl', 'usb', 'led', 'abs', 'pp', 'tpr', 'eva', 'mini', 'plus', 'max', 'pro', 'l', 'm', 's', 'xs'}
LATIN = re.compile(r'[a-zA-Z]+')

# WB 中文类目 → 我们的类目名（保留 WB 口径，便于回溯）
CAT_MAP = {
    '猫抓板': '宠物-抓板',
    '宠物床垫': '宠物-窝垫',
    '宠物窝': '宠物-窝垫',
    '宠物厕所': '宠物-厕所',
    '宠物航空箱': '宠物-出行',
    '动物碗': '宠物-餐具',
    '动物喂食器': '宠物-喂食器',
    '宠物饮水机': '宠物-饮水',
    '宠物玩具': '宠物-玩具',
    '宠物连体服': '宠物-服饰',
    '宠物衣服': '宠物-服饰',
    '宠物项圈': '宠物-项圈',
    '宠物牵引绳': '宠物-牵引',
    '宠物胸背带': '宠物-牵引',
    '宠物尿垫': '宠物-清洁',
    '动物笼': '宠物-笼具',
    '宠物鞋': '宠物-服饰',
    '鱼缸': '宠物-水族',
    '宠物背包': '宠物-出行',
    '宠物运输箱': '宠物-出行',
    '动物垫子': '宠物-窝垫',
    '宠物隧道': '宠物-玩具',
}

def animal_of(term):
    t = term.lower()
    if re.search(r'кош(к|ек|ач)|\bкот[аеуы]?\b|котят|котен|кота\b', t):
        return 'cat'
    if re.search(r'собак|собач|щен|пёс\b|пес\b', t):
        return 'dog'
    if re.search(r'птиц|попуга|хомяк|шиншилл|крыс|морск|кролик|белк', t):
        return 'small'
    if re.search(r'рыб|аквариум|черепах', t):
        return 'fish'
    return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-ratio', type=float, default=1.0)
    ap.add_argument('--min-volume', type=int, default=300)
    ap.add_argument('--max-words', type=int, default=600)
    ap.add_argument('--apply', action='store_true')
    # 玻璃鱼缸跨境易碎、按体积计费必亏，默认排除；需要时加 --keep-aquarium
    ap.add_argument('--keep-aquarium', action='store_true')
    a = ap.parse_args()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT term, volume, product_count, top_category, carts, clicks, order_cvr, volume_prev
        FROM wb_search_terms
        WHERE volume > 0 AND product_count > 0
    """).fetchall()

    picked, dropped = [], {'consumable': 0, 'latin': 0, 'ratio': 0, 'volume': 0, 'nocat': 0, 'aquarium': 0}
    for r in rows:
        t = r['term'].strip()
        ratio = r['volume'] / r['product_count']
        if CONSUMABLE.search(t):
            dropped['consumable'] += 1
            continue
        latin = {w.lower() for w in LATIN.findall(t)}
        if latin - LATIN_OK:
            dropped['latin'] += 1
            continue
        if ratio < a.min_ratio:
            dropped['ratio'] += 1
            continue
        if r['volume'] < a.min_volume:
            dropped['volume'] += 1
            continue
        cat = CAT_MAP.get((r['top_category'] or '').strip())
        if not cat:
            dropped['nocat'] += 1
            continue
        if cat == '宠物-水族' and not a.keep_aquarium:
            dropped['aquarium'] += 1
            continue
        picked.append((t, cat, animal_of(t), ratio, r))

    picked.sort(key=lambda x: -x[4]['volume'])
    picked = picked[:a.max_words]

    print(f'候选池 {len(rows)} | 入选 {len(picked)} | 剔除: ' + ', '.join(f'{k}={v}' for k, v in dropped.items()))
    bycat = {}
    for _, cat, animal, ratio, r in picked:
        bycat.setdefault(cat, []).append((ratio, r['volume'], r['term']))
    print('\n按类目分布:')
    for cat, items in sorted(bycat.items(), key=lambda x: -len(x[1])):
        print(f'  {cat:<14} {len(items):>4} 词 | 最高供需 {max(i[0] for i in items):>5.1f}')

    print('\n供需比 Top25:')
    for _, cat, animal, ratio, r in sorted(picked, key=lambda x: -x[3])[:25]:
        print(f"  {ratio:>6.1f} | 搜{r['volume']:>7} 供给{r['product_count']:>7} | 加购{r['carts']:>7} | {cat:<12} {r['term']}")

    if os.environ.get('WB_DUMP_ALL') == '1':
        print('\n=== 全量入选词 ===')
        for t, cat, animal, ratio, r in picked:
            print(f"{ratio:>6.1f} | 搜{r['volume']:>7} 供给{r['product_count']:>7} | {cat:<12} | {animal:<5} | {t}")

    if not a.apply:
        print('\n（未写库，加 --apply 生效）')
        return

    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    bak = f'wb_keywords_bak_{stamp}'
    conn.execute(f'CREATE TABLE {bak} AS SELECT * FROM wb_keywords')
    conn.execute('UPDATE wb_keywords SET enabled=0')
    for t, cat, animal, ratio, r in picked:
        conn.execute("""
            INSERT INTO wb_keywords (keyword, category, animal_type, enabled)
            VALUES (?,?,?,1)
            ON CONFLICT(keyword) DO UPDATE SET category=excluded.category,
              animal_type=excluded.animal_type, enabled=1, updated_at=datetime('now')
        """, (t, cat, animal))
    conn.commit()
    total = conn.execute('SELECT COUNT(*) FROM wb_keywords WHERE enabled=1').fetchone()[0]
    print(f'\n已写库：启用 {total} 个词（旧词库备份到 {bak}）')
    conn.close()


if __name__ == '__main__':
    main()
