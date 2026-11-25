# -*- coding: utf-8 -*-
"""
导入 WB 卖家后台「搜索分析」导出（宠物类目）到 wb_search_terms 表。
用法: python scripts/import_search_terms.py "<xlsx 路径>"
表结构对齐导出列，便于后续按「搜索量 / 商品数量」算供需比。
"""
import sys, sqlite3, os, datetime
import openpyxl

sys.stdout.reconfigure(encoding='utf-8')

DEFAULT_XLSX = r"c:\Users\25696\.trae-cn\attachments\63bdae31-44bd-4383-a650-6af826f0c7fd_ffd335c5-e181-40eb-abc7-84160e63e7d1_18-11-2026 search 从 19-10-2026 到 17-11-2026.xlsx"
DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'wb_agent.db')

DDL = """
CREATE TABLE IF NOT EXISTS wb_search_terms (
  term TEXT PRIMARY KEY,
  volume INTEGER DEFAULT 0,
  volume_prev INTEGER DEFAULT 0,
  daily_volume REAL DEFAULT 0,
  daily_volume_prev REAL DEFAULT 0,
  top_category TEXT DEFAULT '',
  clicks INTEGER DEFAULT 0,
  clicks_prev INTEGER DEFAULT 0,
  carts INTEGER DEFAULT 0,
  carts_prev INTEGER DEFAULT 0,
  cart_cvr REAL DEFAULT 0,
  cart_cvr_prev REAL DEFAULT 0,
  orders INTEGER DEFAULT 0,
  orders_prev INTEGER DEFAULT 0,
  order_cvr REAL DEFAULT 0,
  order_cvr_prev REAL DEFAULT 0,
  skus_ordered INTEGER DEFAULT 0,
  skus_ordered_prev INTEGER DEFAULT 0,
  product_count INTEGER DEFAULT 0,
  product_count_prev INTEGER DEFAULT 0,
  period_start TEXT DEFAULT '',
  period_end TEXT DEFAULT '',
  imported_at TEXT DEFAULT (datetime('now'))
)
"""

def num(v):
    if v is None or v == '':
        return 0
    try:
        return float(str(v).replace('\xa0', '').replace(' ', '').replace(',', '.'))
    except ValueError:
        return 0


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    wb = openpyxl.load_workbook(path, data_only=True)

    # 周期信息在「基础信息」表
    period = {}
    info = wb['基础信息']
    for row in info.iter_rows(values_only=True):
        vals = [c for c in row if c is not None]
        if len(vals) >= 2:
            period[str(vals[0]).strip()] = str(vals[1]).strip()
    p_start = period.get('选定周期', '').replace('从 ', '').split(' 到 ')[0]
    p_end = period.get('选定周期', '').replace('从 ', '').split(' 到 ')[-1]

    ws = wb['详细信息']
    conn = sqlite3.connect(DB)
    conn.executescript(DDL)
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:  # 标题行 + 表头行
            continue
        term = row[0]
        if not term or not str(term).strip():
            continue
        rows.append((
            str(term).strip(),
            int(num(row[1])), int(num(row[2])), num(row[3]), num(row[4]),
            str(row[5] or '').strip(),
            int(num(row[6])), int(num(row[7])), int(num(row[8])), int(num(row[9])),
            num(row[10]), num(row[11]), int(num(row[12])), int(num(row[13])),
            num(row[14]), num(row[15]), int(num(row[16])), int(num(row[17])),
            int(num(row[18])), int(num(row[19])),
            p_start, p_end,
        ))
    conn.executemany("""
        INSERT INTO wb_search_terms (
          term, volume, volume_prev, daily_volume, daily_volume_prev, top_category,
          clicks, clicks_prev, carts, carts_prev, cart_cvr, cart_cvr_prev,
          orders, orders_prev, order_cvr, order_cvr_prev,
          skus_ordered, skus_ordered_prev, product_count, product_count_prev,
          period_start, period_end
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(term) DO UPDATE SET
          volume=excluded.volume, volume_prev=excluded.volume_prev,
          daily_volume=excluded.daily_volume, daily_volume_prev=excluded.daily_volume_prev,
          top_category=excluded.top_category,
          clicks=excluded.clicks, clicks_prev=excluded.clicks_prev,
          carts=excluded.carts, carts_prev=excluded.carts_prev,
          cart_cvr=excluded.cart_cvr, cart_cvr_prev=excluded.cart_cvr_prev,
          orders=excluded.orders, orders_prev=excluded.orders_prev,
          order_cvr=excluded.order_cvr, order_cvr_prev=excluded.order_cvr_prev,
          skus_ordered=excluded.skus_ordered, skus_ordered_prev=excluded.skus_ordered_prev,
          product_count=excluded.product_count, product_count_prev=excluded.product_count_prev,
          period_start=excluded.period_start, period_end=excluded.period_end,
          imported_at=datetime('now')
    """, rows)
    conn.commit()
    total = conn.execute('SELECT COUNT(*) FROM wb_search_terms').fetchone()[0]
    print(f'导入 {len(rows)} 行，表内合计 {total} 个搜索词')
    print(f'周期: {p_start} ~ {p_end}')
    conn.close()


if __name__ == '__main__':
    main()
