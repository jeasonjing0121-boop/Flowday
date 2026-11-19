# -*- coding: utf-8 -*-
"""合并三轮性能测试原始数据，输出 consolidated JSON + 对比 CSV。"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "phase4.1"
SRC1 = OUT / "perf-raw-run1-storage-app.json"
run1 = json.loads((SRC1 if SRC1.exists() else OUT / "perf-raw.json").read_text(encoding="utf-8"))
run2 = json.loads((OUT / "perf-raw-detail.json").read_text(encoding="utf-8"))
run3 = json.loads((OUT / "perf-raw-modules.json").read_text(encoding="utf-8"))
prod_file = OUT / "perf-raw-reload-prod.json"
prod = json.loads(prod_file.read_text(encoding="utf-8")) if prod_file.exists() else None

m1 = run1["meta"]
method = m1.get("methodology", {})
repeats = m1.get("repeatsPerMetric") or m1.get("repeatsPerKeyMetric")
env = m1.get("environment")
isolation = m1.get("isolation") or method.get("isolation")

consolidated = {
    "meta": {
        "phase": "4.1",
        "generatedAt": m1.get("generatedAt"),
        "repeatsPerKeyMetric": repeats,
        "sizes": m1.get("sizes") or [1000, 5000, 10000],
        "environment": env,
        "isolation": isolation,
        "methodology": {
            "rawStorage": method.get("timing"),
            "appLevel": method.get("timing"),
            "dataset": method.get("dataset"),
            "persistenceDecomposition": run2["meta"]["methodology"]["persistence"],
            "moduleBench": run3["meta"]["note"],
            "consistency": run2["meta"]["methodology"]["consistency"],
        },
        "scripts": ["scripts/bench-4.1.mjs", "scripts/bench-4.1b.mjs", "scripts/bench-4.1c.mjs"],
        "rawSources": ["perf-raw-run1-storage-app.json", "perf-raw-detail.json", "perf-raw-modules.json"],
        "notes": [
            "首轮一致性测试未校验创建是否成功，出现假阴性；consistency 采用补充轮（创建后校验内存状态，5 次/场景）结果。",
            "首轮应用级数据在测量时通过 appDbTasks 校验过规模（1000/5000/10000），有效。",
            "拆分 Store 原型为合成查询，用于评估架构方向，不代表真实访问分布。",
            "所有测试均在临时浏览器 profile 中完成，未读写用户真实浏览器数据。",
        ],
    },
    "rawStorage": run1["rawStorage"],
    "appLevel": run1["appLevel"],
    "appDetail": run2["appDetail"],
    "moduleBench": run3["modules"],
    "transactionCost": run3["transactionCost"],
    "architecturePrototype": run1["architecturePrototype"],
    "consistency": run2["consistency"],
    "consistencyRun1Superseded": run1.get("consistencyRun1Superseded") or run1.get("consistency"),
    "productionReload": prod["bySize"] if prod else {},
    "productionReloadMeta": prod["meta"] if prod else None,
}

(OUT / "perf-raw.json").write_text(json.dumps(consolidated, ensure_ascii=False, indent=2), encoding="utf-8")

MED = lambda s: "" if not s else s["median"]
MAX = lambda s: "" if not s else s["max"]
MS = lambda s: "" if not s else round(s["ms"], 2)

header = [
    "任务数", "JSON体积KB", "首次写入med_ms", "首次写入max_ms", "整份读取med_ms", "整份读取max_ms",
    "单条更新存储层med_ms", "顺序20写med_ms", "批量20写med_ms",
    "重载就绪med_ms", "重载就绪max_ms", "搜索UImed_ms", "优先级筛选UImed_ms", "状态筛选UImed_ms",
    "勾选端到端med_ms", "勾选写入med_ms", "纯计算搜索med_ms", "纯计算排序med_ms",
    "模块读整份med_ms", "模块写整份med_ms", "生产构建重载med_ms",
]
rows = [",".join(header)]
for n in ["1000", "5000", "10000"]:
    r = consolidated["rawStorage"][n]
    a = consolidated["appLevel"][n]
    d = consolidated["appDetail"][n]
    m = consolidated["moduleBench"][n]
    rows.append(",".join(str(x) for x in [
        n, round(r["jsonBytes"] / 1024),
        MED(r["initialWrite"]), MAX(r["initialWrite"]),
        MED(r["wholeRead"]), MAX(r["wholeRead"]),
        MED(r["singleUpdate"]),
        MED(r["sequential20Writes"]), MED(r["batched20Writes"]),
        MED(a["reloadToReady"]), MAX(a["reloadToReady"]),
        MED(a["search"]), MED(a["priorityFilter"]), MED(a["statusFilter"]),
        MED(d["toggleEndToEnd"]), MED(d["togglePutDuration"]),
        MS(d["compute"]["searchTitle"]) if d.get("compute") else "",
        MS(d["compute"]["sortAll"]) if d.get("compute") else "",
        MS(m["idbReadState"]), MS(m["idbWriteState"]),
        consolidated.get("productionReload", {}).get(n, {}).get("reloadToReady", {}).get("median", ""),
    ]))
(OUT / "perf-table.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")

summary = {
    "generatedAt": consolidated["meta"]["generatedAt"],
    "bySize": {
        n: {
            "jsonKB": round(consolidated["rawStorage"][n]["jsonBytes"] / 1024),
            "storage": {
                "initialWrite": consolidated["rawStorage"][n]["initialWrite"]["median"],
                "wholeRead": consolidated["rawStorage"][n]["wholeRead"]["median"],
                "singleUpdate": consolidated["rawStorage"][n]["singleUpdate"]["median"],
                "sequential20": consolidated["rawStorage"][n]["sequential20Writes"]["median"],
                "batched20": consolidated["rawStorage"][n]["batched20Writes"]["median"],
            },
            "app": {
                "reloadToReady": consolidated["appLevel"][n]["reloadToReady"]["median"],
                "searchUI": consolidated["appLevel"][n]["search"]["median"],
                "priorityUI": consolidated["appLevel"][n]["priorityFilter"]["median"],
                "statusUI": consolidated["appLevel"][n]["statusFilter"]["median"],
                "toggleEndToEnd": consolidated["appDetail"][n]["toggleEndToEnd"]["median"],
                "toggleWrite": consolidated["appDetail"][n]["togglePutDuration"]["median"],
            },
            "compute": {
                "filterQuery": consolidated["moduleBench"][n]["filterQuery"]["ms"],
                "sortTasks": consolidated["moduleBench"][n]["sortTasks"]["ms"],
                "todayStats": consolidated["moduleBench"][n]["todayStats"]["ms"],
                "last7Day": consolidated["moduleBench"][n]["last7DayCompletion"]["ms"],
                "sanitize": consolidated["moduleBench"][n]["sanitizeImportedData"]["ms"],
            },
            "module": {
                "readState": consolidated["moduleBench"][n]["idbReadState"]["ms"],
                "writeState": consolidated["moduleBench"][n]["idbWriteState"]["ms"],
            },
        }
        for n in ["1000", "5000", "10000"]
    },
}
(OUT / "perf-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print("written consolidated JSON, CSV, summary")
