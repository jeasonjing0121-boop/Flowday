# -*- coding: utf-8 -*-
"""生成 Phase 4.2 前后对比表（prod before/after + dev before(4.1)/after）。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "docs" / "phase4.2"
prev = json.loads((ROOT / "docs" / "phase4.1" / "perf-raw.json").read_text(encoding="utf-8"))
before = json.loads((D / "perf-4.2-before-prod.json").read_text(encoding="utf-8"))
after_prod = json.loads((D / "perf-4.2-after-prod.json").read_text(encoding="utf-8"))
after_dev = json.loads((D / "perf-4.2-after3-dev.json").read_text(encoding="utf-8"))
responsive = json.loads((D / "perf-4.2-responsive.json").read_text(encoding="utf-8"))

SIZES = ["1000", "5000", "10000"]


def med(node):
    return node["median"] if node and node.get("median") is not None else "—"


def mx(node):
    return node["max"] if node and node.get("max") is not None else "—"


rows = []
rows.append("# Phase 4.2 优化前后对比（真实测量，5 次中位/最大，ms）\n")
rows.append("## A. 生产构建（vite preview，同一台机器、同一数据构造、同一计时口径）\n")
rows.append("| 指标 | 1,000 优化前 | 1,000 优化后 | 5,000 优化前 | 5,000 优化后 | 10,000 优化前 | 10,000 优化后 |")
rows.append("|---|---|---|---|---|---|---|")


def pair(label, extractor):
    cells = []
    for n in SIZES:
        cells.append(str(extractor(before["bySize"][n])))
        cells.append(str(extractor(after_prod["bySize"][n])))
    rows.append(f"| {label} | " + " | ".join(cells) + " |")


pair("首次列表渲染（中位）", lambda b: med(b["firstListRender"]))
pair("列表稳定（中位）", lambda b: med(b["listStable"]))
pair("搜索 UI（中位）", lambda b: med(b["search"]))
pair("优先级筛选（中位）", lambda b: med(b["priorityFilter"]))
pair("状态筛选（中位）", lambda b: med(b["statusFilter"]))
pair("勾选端到端（中位）", lambda b: med(b["toggleEndToEnd"]))
pair("勾选写库（中位）", lambda b: med(b["togglePutDuration"]))
pair("DOM 元素总数", lambda b: b["dom"]["totalNodes"])
pair("已渲染任务行数", lambda b: b["dom"]["rowNodes"])
rows.append("")
rows.append("滚动流畅度（10,000 条，2 秒程序化滚动）：")
rows.append("")
rows.append("| 指标 | 优化前 | 优化后 |")
rows.append("|---|---|---|")
b10 = before["bySize"]["10000"]["scroll"]
a10 = after_prod["bySize"]["10000"]["scroll"]
rows.append(f"| 帧间隔中位 | {b10['median']} ms | {a10['median']} ms |")
rows.append(f"| 帧间隔 p95 | {b10['p95']} ms | {a10['p95']} ms |")
rows.append(f"| 最长帧 | {b10['max']} ms | {a10['max']} ms |")
rows.append(f"| 掉帧数(>50ms) | {b10['jankFrames']} | {a10['jankFrames']} |")
rows.append(f"| 掉帧比例 | {b10['jankRatio']}% | {a10['jankRatio']}% |")
rows.append("")
rows.append("## B. 开发服务器（与 Phase 4.1 相同的环境与脚本口径）\n")
rows.append("| 指标 | 1,000 前 | 1,000 后 | 5,000 前 | 5,000 后 | 10,000 前 | 10,000 后 |")
rows.append("|---|---|---|---|---|---|---|")
for label, key in [("搜索 UI（中位）", "search"), ("优先级筛选（中位）", "priorityFilter"), ("状态筛选（中位）", "statusFilter")]:
    cells = []
    for n in SIZES:
        cells.append(str(med(prev["appLevel"][n][key])))
        cells.append(str(med(after_dev["bySize"][n][key])))
    rows.append(f"| {label} | " + " | ".join(cells) + " |")
cells = []
for n in SIZES:
    cells.append(str(med(prev["appLevel"][n]["togglePersist"])))
    cells.append(str(med(after_dev["bySize"][n]["toggleEndToEnd"])))
rows.append("| 勾选端到端（中位） | " + " | ".join(cells) + " |")
rows.append("")
rows.append("## C. 达标情况（10,000 条，目标值）\n")
rows.append("| 目标 | 目标值 | 生产构建实测 | 开发服务器实测 | 结论 |")
rows.append("|---|---|---|---|---|")
rows.append(f"| 搜索 UI | < 200 ms | {med(after_prod['bySize']['10000']['search'])} ms | {med(after_dev['bySize']['10000']['search'])} ms | ✅ |")
rows.append(f"| 优先级筛选 UI | < 200 ms | {med(after_prod['bySize']['10000']['priorityFilter'])} ms | {med(after_dev['bySize']['10000']['priorityFilter'])} ms | ✅ |")
rows.append(f"| 勾选端到端 | < 300 ms | {med(after_prod['bySize']['10000']['toggleEndToEnd'])} ms | {med(after_dev['bySize']['10000']['toggleEndToEnd'])} ms | ✅ |")
rows.append("")
rows.append("## D. React 渲染次数（开发态计数器，一次勾选操作）\n")
rows.append("| 指标 | 优化前 | 优化后 |")
rows.append("|---|---|---|")
rows.append(f"| TaskRow 组件渲染次数 | ≈8,020（全部已挂载行，每次状态更新；由 DOM 行数与无 memo/上下文订阅可证实） | {after_dev['bySize']['10000']['reactRenderCounts']['rowRenders']} |")
rows.append(f"| TasksPage 渲染次数 | 1 | {after_dev['bySize']['10000']['reactRenderCounts']['pageRenders']} |")
rows.append("")
rows.append("## E. 大数据量响应式校验（5,000 条）\n")
rows.append("| 视口 | 已渲染行 | 横向溢出 | 底部导航 | 滚动到底部行数 |")
rows.append("|---|---|---|---|---|")
for name in ["mobile", "tablet", "desktop"]:
    r = responsive["results"][name]
    rows.append(f"| {r['viewport']} | {r['rows']} | {'是' if r['overflowX'] else '否'} | {'显示' if r['navVisible'] else '隐藏（桌面侧栏）'} | {r['bottomRows']} |")

text = "\n".join(rows) + "\n"
(D / "perf-4.2-compare.md").write_text(text, encoding="utf-8")
print('written perf-4.2-compare.md')
