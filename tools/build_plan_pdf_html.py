#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a print-styled HTML from the FlowDay plan markdown.

This is a small, purpose-built Markdown subset renderer for the plan docs:
headings, paragraphs, GFM tables, fenced code blocks, blockquotes, lists
(including task lists), horizontal rules, inline code / bold / links.

Output: flowday/docs/plan/pdf-build/FlowDay-完整方案-v1.0-print.html
The HTML is then printed to PDF by render_pdf.mjs (Edge/Chromium).
"""

from __future__ import annotations

import html as htmllib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs" / "plan"
OUT_DIR = PLAN / "pdf-build"

DOCS = [
    ("README.md", "总览"),
    ("01-prd.md", "产品需求（PRD）"),
    ("02-design-system.md", "设计系统与页面规格"),
    ("03-architecture.md", "技术架构与数据模型"),
    ("04-roadmap.md", "分阶段开发计划与验收"),
    ("05-business.md", "商业模式、定价与增长"),
]

LINK_MAP = {
    "./README.md": "#doc-0",
    "README.md": "#doc-0",
    "./01-prd.md": "#doc-1",
    "01-prd.md": "#doc-1",
    "./02-design-system.md": "#doc-2",
    "02-design-system.md": "#doc-2",
    "./03-architecture.md": "#doc-3",
    "03-architecture.md": "#doc-3",
    "./04-roadmap.md": "#doc-4",
    "04-roadmap.md": "#doc-4",
    "./05-business.md": "#doc-5",
    "05-business.md": "#doc-5",
    "./FlowDay-完整方案-v1.0-合订本.md": "#top",
    "FlowDay-完整方案-v1.0-合订本.md": "#top",
    "./assets/design-tokens.json": "",
    "assets/design-tokens.json": "",
}

CJK_RE = re.compile(r"[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]")


def is_cjk(ch: str) -> bool:
    return bool(ch) and bool(CJK_RE.match(ch))


def escape(s: str) -> str:
    return htmllib.escape(s, quote=False)


def map_href(href: str) -> str | None:
    href = href.strip()
    if not href:
        return ""
    if href.startswith("#"):
        return href
    if re.match(r"^(https?:|mailto:)", href):
        return href
    base = href.split("#")[0]
    if base in LINK_MAP:
        return ""
    return None


def inline(text: str) -> str:
    """Convert inline markdown to HTML (safe subset)."""
    codes: list[str] = []

    def stash(m: re.Match) -> str:
        codes.append(m.group(1))
        return "\x00%d\x00" % (len(codes) - 1)

    text = re.sub(r"`([^`]+)`", stash, text)
    text = escape(text)

    def link(m: re.Match) -> str:
        label, href = m.group(1), m.group(2)
        mapped = map_href(href)
        if mapped is None:
            return label
        if mapped == "":
            return label
        target = escape(mapped)
        return '<a href="%s">%s</a>' % (target, label)

    text = re.sub(r"\[([^\]]*)\]\(([^)]+)\)", link, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^\s*][^*\n]*?)\*(?!\*)", r"<i>\1</i>", text)

    def unstash(m: re.Match) -> str:
        return "<code>%s</code>" % escape(codes[int(m.group(1))])

    return re.sub(r"\x00(\d+)\x00", unstash, text)


def join_lines(lines: list[str]) -> str:
    out = ""
    for raw in lines:
        piece = raw.strip()
        if not piece:
            continue
        if not out:
            out = piece
        elif is_cjk(out[-1]) and is_cjk(piece[0]):
            out += piece
        else:
            out += " " + piece
    return out


LIST_RE = re.compile(r"^(\s*)([-*+]|\d+\.)\s+(.*)$")
HEAD_RE = re.compile(r"^(#{1,6})\s+(.*)$")
HR_RE = re.compile(r"^\s*(?:---+|\*\*\*+|___+)\s*$")
FENCE_RE = re.compile(r"^\s*```\s*([\w+-]*)\s*$")


class DocParser:
    def __init__(self, doc_index: int) -> None:
        self.doc_index = doc_index
        self.headings: list[tuple[int, str, str]] = []  # (level, text, anchor)
        self.hid = 0
        self.seen_h1 = False
        self.buf: list[str] = []

    # ---------- helpers ----------
    def next_hid(self) -> str:
        self.hid += 1
        return "h%d" % self.hid

    def emit(self, s: str) -> None:
        self.buf.append(s)

    # ---------- block parsers ----------
    def table(self, lines: list[str], i: int) -> tuple[str, int]:
        n = len(lines)

        def split_row(row: str) -> list[str]:
            row = row.strip()
            if row.startswith("|"):
                row = row[1:]
            if row.endswith("|"):
                row = row[:-1]
            return [c.strip() for c in row.split("|")]

        header = split_row(lines[i])
        sep = split_row(lines[i + 1])
        aligns: list[str] = []
        for cell in sep:
            cell = cell.strip()
            if cell.startswith(":") and cell.endswith(":"):
                aligns.append("center")
            elif cell.endswith(":"):
                aligns.append("right")
            elif cell.startswith(":"):
                aligns.append("left")
            else:
                aligns.append("")
        rows: list[list[str]] = []
        j = i + 2
        while j < n and lines[j].strip().startswith("|"):
            rows.append(split_row(lines[j]))
            j += 1
        width = max([len(header)] + [len(r) for r in rows]) if rows else len(header)

        def pad(row: list[str]) -> list[str]:
            return row + [""] * (width - len(row))

        header = pad(header)
        rows = [pad(r) for r in rows]

        # column width heuristic: sqrt of visible length
        def visible_len(cell: str) -> int:
            plain = re.sub(r"[`*\[\]()>#|]", "", cell)
            score = 0
            for ch in plain:
                score += 2 if is_cjk(ch) else 1
            return score

        weights = []
        for c in range(width):
            longest = max([visible_len(header[c])] + [visible_len(r[c]) for r in rows])
            weights.append(max(6.0, longest) ** 0.5)
        total = sum(weights) or 1.0
        pcts = [max(6.5, w / total * 100.0) for w in weights]
        s = sum(pcts)
        pcts = [p / s * 100.0 for p in pcts]

        out = ['<table>', "<colgroup>"]
        for p in pcts:
            out.append('<col style="width:%.2f%%">' % p)
        out.append("</colgroup><thead><tr>")
        for c, cell in enumerate(header):
            style = ' style="text-align:%s"' % aligns[c] if c < len(aligns) and aligns[c] else ""
            out.append("<th%s>%s</th>" % (style, inline(cell)))
        out.append("</tr></thead><tbody>")
        for r in rows:
            out.append("<tr>")
            for c, cell in enumerate(r):
                style = ' style="text-align:%s"' % aligns[c] if c < len(aligns) and aligns[c] else ""
                out.append("<td%s>%s</td>" % (style, inline(cell)))
            out.append("</tr>")
        out.append("</tbody></table>")
        return "".join(out), j

    def code_block(self, lines: list[str], i: int) -> tuple[str, int]:
        m = FENCE_RE.match(lines[i])
        lang = (m.group(1) or "").lower() if m else ""
        j = i + 1
        body: list[str] = []
        while j < len(lines) and not re.match(r"^\s*```\s*$", lines[j]):
            body.append(lines[j])
            j += 1
        j += 1  # skip closing fence
        content = "\n".join(body)
        is_ascii = ("┌" in content or "└" in content or "┌" in content or "─" in content) and len(content) > 40
        cls = "code"
        if lang in ("text", "txt", "plain") or is_ascii:
            cls += " ascii" if is_ascii else ""
        return '<pre class="%s"><code>%s</code></pre>' % (cls, escape(content)), j

    def blockquote(self, lines: list[str], i: int) -> tuple[str, int]:
        j = i
        parts: list[str] = []
        while j < len(lines) and lines[j].lstrip().startswith(">"):
            raw = lines[j].lstrip()[1:]
            if raw.startswith(" "):
                raw = raw[1:]
            parts.append(raw)
            j += 1
        text = "<br>".join(inline(p) for p in parts if p.strip())
        return "<blockquote>%s</blockquote>" % text, j

    def list_block(self, lines: list[str], i: int) -> tuple[str, int]:
        n = len(lines)
        items: list[tuple[int, bool, str]] = []
        j = i
        while j < n:
            line = lines[j]
            m = LIST_RE.match(line)
            if m:
                indent = len(m.group(1).replace("\t", "  "))
                level = 0 if indent < 2 else (1 if indent < 4 else 2)
                ordered = not m.group(2) in ("-", "*", "+")
                text = m.group(3).strip()
                items.append((level, ordered, text))
                j += 1
                continue
            if line.strip() == "":
                # blank line: list continues only if next line is a list item
                if j + 1 < n and LIST_RE.match(lines[j + 1]):
                    j += 1
                    continue
                break
            if line.startswith(("  ", "\t")) and items and line.strip():
                level, ordered, text = items[-1]
                items[-1] = (level, ordered, text + " " + line.strip())
                j += 1
                continue
            break

        def render(idx: int, level: int) -> tuple[str, int]:
            if idx >= len(items):
                return "", idx
            tag = "ol" if items[idx][1] else "ul"
            out = ["<%s>" % tag]
            while idx < len(items) and items[idx][0] == level:
                _, _, text = items[idx]
                cls = ""
                if text.startswith("[ ] "):
                    cls = ' class="task"'
                    text = "☐ " + text[4:]
                elif text.lower().startswith("[x] "):
                    cls = ' class="task"'
                    text = "☑ " + text[4:]
                out.append("<li%s>%s" % (cls, inline(text)))
                idx += 1
                if idx < len(items) and items[idx][0] > level:
                    sub_level = items[idx][0]
                    sub, idx = render(idx, sub_level)
                    out.append(sub)
                out.append("</li>")
            out.append("</%s>" % tag)
            return "".join(out), idx

        # normalise level jumps
        if items:
            base = items[0][0]
            items = [((lv - base) if lv >= base else 0, ordered, t) for lv, ordered, t in items]
            html_out, _ = render(0, 0)
        else:
            html_out = ""
        return html_out, j

    # ---------- main loop ----------
    def parse(self, text: str) -> str:
        lines = text.splitlines()
        n = len(lines)
        i = 0
        while i < n:
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            fence = FENCE_RE.match(line)
            if fence:
                html_out, i = self.code_block(lines, i)
                self.emit(html_out)
                continue

            heading = HEAD_RE.match(line)
            if heading:
                level = len(heading.group(1))
                text_h = heading.group(2).strip()
                if level == 1:
                    if not self.seen_h1:
                        self.seen_h1 = True
                        anchor = "doc-%d" % self.doc_index
                        self.emit(
                            '<div class="kicker">第 %d 部分 &nbsp;·&nbsp; 共 %d 部分</div>'
                            % (self.doc_index + 1, len(DOCS))
                        )
                        self.emit('<h1 class="doc-title" id="%s">%s</h1>' % (anchor, inline(text_h)))
                        self.headings.append((1, self._plain(text_h), anchor))
                    else:
                        anchor = "doc-%d-sub%d" % (self.doc_index, self.next_hid())
                        self.emit('<h1 class="sub-title" id="%s">%s</h1>' % (anchor, inline(text_h)))
                else:
                    anchor = self.next_hid()
                    self.emit('<h%d id="%s">%s</h%d>' % (level, anchor, inline(text_h), level))
                    if level == 2:
                        self.headings.append((2, self._plain(text_h), anchor))
                i += 1
                continue

            if HR_RE.match(line):
                self.emit("<hr>")
                i += 1
                continue

            if stripped.startswith(">") and line.lstrip().startswith(">"):
                html_out, i = self.blockquote(lines, i)
                self.emit(html_out)
                continue

            if stripped.startswith("|") and i + 1 < n and "|" in lines[i + 1]:
                nxt = lines[i + 1].strip()
                if re.match(r"^\|?[\s:|-]*-{2,}[\s:|-]*$", nxt):
                    html_out, i = self.table(lines, i)
                    self.emit(html_out)
                    continue

            if LIST_RE.match(line):
                html_out, i = self.list_block(lines, i)
                self.emit(html_out)
                continue

            # paragraph
            para: list[str] = []
            while i < n:
                cur = lines[i]
                if not cur.strip():
                    break
                if HEAD_RE.match(cur) or FENCE_RE.match(cur) or HR_RE.match(cur):
                    break
                if cur.lstrip().startswith(">"):
                    break
                if LIST_RE.match(cur):
                    break
                if cur.strip().startswith("|") and i + 1 < n and "|" in lines[i + 1] and re.match(
                    r"^\|?[\s:|-]*-{2,}[\s:|-]*$", lines[i + 1].strip()
                ):
                    break
                para.append(cur)
                i += 1
            if para:
                self.emit("<p>%s</p>" % inline(join_lines(para)))
            else:
                i += 1

        return "\n".join(self.buf)

    @staticmethod
    def _plain(text: str) -> str:
        text = re.sub(r"`([^`]+)`", r"\1", text)
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
        text = re.sub(r"\[([^\]]*)\]\([^)]+\)", r"\1", text)
        return text.strip()


COVER = """
<section class="cover">
  <div class="cover-top">
    <div class="brand"><span class="brand-mark"></span>FlowDay</div>
    <div class="cover-tag">AI 个人效率管理产品</div>
  </div>
  <div class="cover-main">
    <div class="cover-kicker">PRODUCT PLAN · V1.0</div>
    <div class="cover-title">FlowDay<br>完整产品方案</div>
    <p class="cover-sub">从产品需求、UI/UX 设计、技术架构，到分阶段开发计划与商业化的完整方案。<br>面向普通个人用户 · Web 优先 · 免费 + Pro 订阅。</p>
    <div class="cover-meta">
      <span>版本 v1.0</span><span class="dot">·</span><span>2026-11-13</span><span class="dot">·</span><span>6 个部分</span>
    </div>
  </div>
  <div class="cover-parts">
    <div class="cover-part"><b>01</b>产品需求（PRD）</div>
    <div class="cover-part"><b>02</b>设计系统与页面规格</div>
    <div class="cover-part"><b>03</b>技术架构与数据模型</div>
    <div class="cover-part"><b>04</b>分阶段开发计划与验收</div>
    <div class="cover-part"><b>05</b>商业模式、定价与增长</div>
    <div class="cover-part"><b>00</b>总览与待确认决策</div>
  </div>
  <div class="cover-foot">
    <span>供创始人审核 · 状态：待确认</span>
    <span>成本与工期均为估算，价格以官网 2026-11 查询为准</span>
  </div>
</section>
"""

GUIDE = """
<section class="guide-page">
  <h1 class="page-title">阅读指南</h1>
  <p>这份 PDF 是 FlowDay 完整方案 v1.0 的阅读／打印版，由「第 1 部分 总览」和 5 份分册组成。你不必从头读到尾，可以按可用时间选择一条阅读路径：</p>
  <table class="guide-table">
    <colgroup><col style="width:18%"><col style="width:52%"><col style="width:30%"></colgroup>
    <thead><tr><th>时间</th><th>建议阅读顺序</th><th>你会得到</th></tr></thead>
    <tbody>
      <tr><td><b>10 分钟</b></td><td>第 1 部分 总览（全部）→ 第 2 部分 §10 待确认决策 → 第 4 部分 §3–§6 阶段、时间线、成本</td><td>能否拍板、要改什么</td></tr>
      <tr><td><b>1 小时</b></td><td>上一条 + 第 2 部分 §1–§5（定位、用户、MVP、页面结构）+ 第 5 部分 §3–§4（权益边界与定价）</td><td>完整的产品与商业判断</td></tr>
      <tr><td><b>深入</b></td><td>全部 6 部分；设计与前端精读第 3 部分，工程精读第 4 部分；支付/合规重点看第 6 部分 §5</td><td>可直接开工的施工图</td></tr>
    </tbody>
  </table>
  <p class="note">阅读提示</p>
  <ul class="guide-list">
    <li>目录为章节索引；每页页脚有页码；正文中的外部链接可点击。</li>
    <li>本 PDF 由 Markdown 源文件自动排版生成，源文件位于 <code>flowday/docs/plan/</code>，与 PDF 内容一致；后续修订以源文件为准。</li>
    <li>文中标注「估算」「待验证」「公开资料」的数字均为假设或外部资料，不是承诺；成本以 Supabase / DeepSeek / Apple / Google 官网 2026-11 查询为参考。</li>
    <li>所有页面以真实后端功能为前提，不含假数据演示；开发需按第 4 部分的分阶段门禁逐阶段验收。</li>
    <li>本 PDF 不构成法律意见；支付、备案、商标、税务事项需咨询专业人士。</li>
  </ul>
  <div class="guide-map">
    <h2>文档地图</h2>
    <table class="guide-table">
      <colgroup><col style="width:30%"><col style="width:44%"><col style="width:26%"></colgroup>
      <thead><tr><th>部分</th><th>回答什么问题</th><th>谁需要读</th></tr></thead>
      <tbody>
        <tr><td>第 1 部分 总览</td><td>方案能不能行、要花多少钱、下一步做什么</td><td>创始人（必读）</td></tr>
        <tr><td>第 2 部分 产品需求</td><td>为谁做、做什么、不做什么、怎么算做完</td><td>全员</td></tr>
        <tr><td>第 3 部分 设计系统</td><td>长什么样、怎么交互、每个页面与组件规格</td><td>设计 / 前端</td></tr>
        <tr><td>第 4 部分 技术架构</td><td>用什么造、数据怎么存、AI 如何只建议不执行、怎么测试与上线</td><td>工程</td></tr>
        <tr><td>第 5 部分 开发计划</td><td>分几个阶段、每阶段交付什么、怎么验收</td><td>创始人 + 全员</td></tr>
        <tr><td>第 6 部分 商业模式</td><td>怎么收费、成本与毛利、怎么获客与合规</td><td>创始人 / 增长</td></tr>
      </tbody>
    </table>
  </div>
</section>
"""

CSS = r"""
@page { size: A4; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", "Noto Sans SC", sans-serif;
  font-size: 9.8pt;
  line-height: 1.75;
  color: #1C1A17;
  background: #FFFFFF;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
a { color: #46508F; text-decoration: none; }

/* ---------- cover ---------- */
.cover {
  position: relative;
  height: 254mm;
  break-after: page;
  padding: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #FAF7F2;
  border: 1px solid #E2DACD;
  padding: 16mm 14mm 12mm;
  overflow: hidden;
}
.cover::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5mm;
  background: linear-gradient(90deg, #F2A45C 0%, #C9668F 52%, #5B5CBF 100%);
}
.cover-top { display: flex; justify-content: space-between; align-items: baseline; }
.brand { font-size: 15pt; font-weight: 600; letter-spacing: .04em; display: flex; align-items: center; gap: 2.4mm; }
.brand-mark { width: 7mm; height: 7mm; border-radius: 2mm; background: linear-gradient(135deg, #F2A45C, #C9668F 52%, #5B5CBF); display: inline-block; }
.cover-tag { font-size: 8.5pt; color: #6E665A; letter-spacing: .18em; }
.cover-kicker { font-size: 8.5pt; letter-spacing: .2em; color: #8A4E73; font-weight: 600; margin-bottom: 5mm; }
.cover-title { font-size: 38pt; line-height: 1.22; font-weight: 600; letter-spacing: -.01em; margin: 0 0 6mm; }
.cover-sub { font-size: 10.5pt; color: #5A544C; line-height: 1.8; margin: 0 0 9mm; max-width: 135mm; }
.cover-meta { font-size: 9pt; color: #6E665A; display: flex; gap: 3mm; align-items: center; }
.cover-meta .dot { color: #CFC5B4; }
.cover-parts { border-top: 1px solid #E2DACD; padding-top: 6mm; display: grid; grid-template-columns: 1fr 1fr; gap: 2.6mm 8mm; }
.cover-part { font-size: 9pt; color: #2E2A25; }
.cover-part b { color: #8A4E73; font-weight: 600; margin-right: 2.6mm; letter-spacing: .06em; }
.cover-foot { display: flex; justify-content: space-between; font-size: 7.6pt; color: #8D887F; border-top: 1px solid #E2DACD; padding-top: 3.5mm; }

/* ---------- guide / toc pages ---------- */
.guide-page { break-before: page; }
.page-title { font-size: 20pt; font-weight: 600; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 1.6pt solid #1C1A17; }
.guide-page p { margin: 0 0 4mm; }
.guide-page h2 { font-size: 12.5pt; margin: 7mm 0 3mm; }
.guide-list { margin: 2mm 0 5mm; padding-left: 5mm; }
.guide-list li { margin: 1.6mm 0; }
.guide-page .note { font-size: 8.6pt; color: #6E665A; letter-spacing: .08em; margin-top: 5mm; }
.guide-map { margin-top: 6mm; }

.toc-page { break-before: page; }
.toc-note { font-size: 8.4pt; color: #6E665A; margin: -2mm 0 5mm; }
.toc-list { font-size: 8.9pt; line-height: 1.62; }
.toc-l1 { font-weight: 600; margin: 3.4mm 0 1.4mm; color: #1C1A17; break-after: avoid; }
.toc-l1 .part-no { color: #8A4E73; margin-right: 1.6mm; }
.toc-l2 { margin: 0 0 1.1mm; padding-left: 4.2mm; color: #2E2A25; break-inside: avoid; }
.toc-l2 .dotline { color: #B3AA9C; }

/* ---------- docs ---------- */
.doc-title { break-before: page; font-size: 21pt; font-weight: 600; line-height: 1.3; margin: 0 0 5mm; padding-bottom: 3mm; border-bottom: 1.4pt solid #1C1A17; }
.sub-title { font-size: 18pt; font-weight: 600; margin: 8mm 0 4mm; padding-bottom: 2.4mm; border-bottom: 1pt solid #1C1A17; break-before: page; }
.kicker { font-size: 8.4pt; letter-spacing: .16em; color: #8A4E73; font-weight: 600; margin-bottom: 3mm; }

h2 { font-size: 14pt; font-weight: 600; line-height: 1.45; margin: 7mm 0 3mm; padding-bottom: 2mm; border-bottom: .6pt solid #E2DACD; break-after: avoid; }
h3 { font-size: 11.4pt; font-weight: 600; margin: 5.4mm 0 2.2mm; break-after: avoid; color: #2E2A25; }
h4 { font-size: 10.2pt; font-weight: 600; margin: 4.2mm 0 1.8mm; break-after: avoid; color: #2E2A25; }

p { margin: 0 0 2.6mm; orphans: 2; widows: 2; }
b { font-weight: 600; }
hr { border: 0; border-top: .6pt solid #E2DACD; margin: 5mm 0; }

ul, ol { margin: 1.6mm 0 3.2mm; padding-left: 5.4mm; }
li { margin: 1.1mm 0; }
li.task { list-style: none; margin-left: -3.6mm; }

blockquote {
  margin: 3mm 0;
  padding: 1.6mm 0 1.6mm 4mm;
  border-left: 2.2pt solid #CFC5B4;
  background: #FBF9F5;
  color: #5A544C;
  font-size: 9.2pt;
  break-inside: avoid;
}

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 8.5pt;
  background: #F2EDE4;
  padding: 0 .6mm;
  border-radius: .8mm;
}
pre.code {
  margin: 2.6mm 0 3.6mm;
  padding: 2.6mm 3mm;
  background: #F8F4ED;
  border: .6pt solid #E2DACD;
  border-radius: 1.2mm;
  font-family: Consolas, "Courier New", monospace;
  font-size: 7.6pt;
  line-height: 1.42;
  white-space: pre-wrap;
  word-break: break-all;
  break-inside: auto;
  color: #2E2A25;
}
pre.code.ascii { font-size: 6.6pt; line-height: 1.22; white-space: pre; word-break: normal; }

table { width: 100%; border-collapse: collapse; margin: 2.6mm 0 4mm; font-size: 7.8pt; line-height: 1.5; }
thead { display: table-header-group; }
th, td { border: .55pt solid #DCD3C4; padding: 1.3mm 1.5mm; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
th { background: #F2EDE4; font-weight: 600; text-align: left; }
tr { break-inside: auto; }
td b, th b { font-weight: 600; }

@media screen {
  body { width: 210mm; margin: 0 auto; padding: 20mm 16mm 18mm; }
  .doc-title, .sub-title, .guide-page, .toc-page { break-before: auto; }
}
"""


def build() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sections: list[str] = []
    toc: list[tuple[int, str, str, int]] = []

    for idx, (fname, _label) in enumerate(DOCS):
        path = PLAN / fname
        text = path.read_text(encoding="utf-8-sig")
        parser = DocParser(idx)
        body = parser.parse(text)
        for level, title, anchor in parser.headings:
            toc.append((level, title, anchor, idx))
        sections.append('<div class="doc" id="doc-%d">%s</div>' % (idx, body))

    toc_html = ['<section class="toc-page" id="toc">', '<h1 class="page-title">目录</h1>',
                '<p class="toc-note">目录为章节索引；每页页脚显示页码。</p>', '<div class="toc-list">']
    for level, title, anchor, _idx in toc:
        if level == 1:
            toc_html.append('<div class="toc-l1">%s</div>' % inline(title))
        else:
            toc_html.append('<div class="toc-l2">%s</div>' % inline(title))
    toc_html.append("</div></section>")

    html_out = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>FlowDay 完整方案 v1.0</title>
<style>%s</style>
</head>
<body>
<div id="top"></div>
%s
%s
%s
%s
</body>
</html>
""" % (CSS, COVER, GUIDE, "\n".join(toc_html), "\n".join(sections))

    out = OUT_DIR / "FlowDay-完整方案-v1.0-print.html"
    out.write_text(html_out, encoding="utf-8")
    return out


if __name__ == "__main__":
    p = build()
    print("HTML:", p)
    print("chars:", len(p.read_text(encoding="utf-8")))
