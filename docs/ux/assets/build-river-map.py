#!/usr/bin/env python3
"""Build the exact river hierarchy and its accessible companion documents.

The standard library creates SVG, Mermaid and Markdown. PyMuPDF is optional
and creates the PNG preview when installed. No network or learner data.
"""
from collections import defaultdict
from pathlib import Path
import html
import json

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / "river-map.json").read_text())
nodes = data["nodes"]
lookup = {n["id"]: n for n in nodes}
children = defaultdict(list)
for n in nodes:
    if n["parent"]:
        children[n["parent"]].append(n["id"])

def ancestors(node_id):
    out = []
    while lookup[node_id]["parent"]:
        node_id = lookup[node_id]["parent"]
        out.append(node_id)
    return out

assert len(nodes) == len(lookup) == 40
assert [n["id"] for n in nodes if not n["parent"]] == ["L"]
assert all(len(children[n["id"]]) in (0, 2, 3) for n in nodes)
assert max(len(ancestors(n["id"])) for n in nodes) <= 5
assert all("L" in ancestors(n["id"]) for n in nodes if n["id"] != "L")
assert len({c["from"] for c in data["cross_links"]} & {c["to"] for c in data["cross_links"]}) == 0

graph = ["graph LR"]
for n in nodes:
    label = "Logical: Independent learning" if n["id"] == "L" else n["word"]
    graph.append(f'  {n["id"]}["{label}"]')
for n in nodes:
    if children[n["id"]]:
        graph.append(f'  {n["id"]} --> ' + ' & '.join(children[n["id"]]))
for c in data["cross_links"]:
    graph.append(f'  {c["from"]} -. "{c["label"]}" .-> {c["to"]}')
mermaid = "\n".join(graph) + "\n"
(HERE / "river-map.mmd").write_text(mermaid)

colors = {"A": "#0f766e", "B": "#1d4ed8", "C": "#7c3aed", "L": "#15243e"}
wash = {"A": "#e9f7f2", "B": "#edf3ff", "C": "#f3edff", "L": "#15243e"}
leaves = [n["id"] for n in nodes if not children[n["id"]]]
ys = {node_id: 222 + i * 52 for i, node_id in enumerate(leaves)}
for n in reversed(nodes):
    if children[n["id"]]:
        ys[n["id"]] = sum(ys[k] for k in children[n["id"]]) / len(children[n["id"]])
xs = [64, 376, 716, 1060]
widths = [260, 286, 280, 428]
height = 1820
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="{height}" viewBox="0 0 1900 {height}" role="img" aria-labelledby="title desc">',
       '<title id="title">Tutor UX river mind map</title>',
       '<desc id="desc">Independent learning divides into Know the learner, Guide the experience, and Prove and improve. Every branch has three children. Six dashed lateral links connect design needs and evidence. All forty nodes have definitions in RIVER-MAP.md.</desc>',
       '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#53657d"/></marker></defs>',
       f'<rect width="1900" height="{height}" fill="#f6f8fc"/>',
       '<g font-family="sans-serif">',
       '<text x="64" y="68" font-size="36" font-weight="700" fill="#15243e">Tutor UX · The river map</text>',
       '<text x="64" y="111" font-size="22" fill="#41536b">Make the next step clear. Build capability. Prove what lasts.</text>',
       '<text x="64" y="150" font-size="17" fill="#41536b">40 nodes · 39 hierarchy links · 6 lateral links · 3 levels below Logical</text>']

for n in nodes:
    if n["parent"]:
        parent = lookup[n["parent"]]
        depth = len(ancestors(n["id"]))
        x1, x2 = xs[depth - 1] + widths[depth - 1], xs[depth]
        y1, y2 = ys[parent["id"]], ys[n["id"]]
        color = colors[n["id"][0]]
        stroke = [0, 9, 5, 2.5][depth]
        mid = (x1 + x2) / 2
        svg.append(f'<path d="M{x1} {y1} C{mid} {y1} {mid} {y2} {x2} {y2}" fill="none" stroke="{color}" stroke-width="{stroke}" opacity="0.65"/>')

for i, c in enumerate(data["cross_links"], 1):
    y1, y2 = ys[c["from"]], ys[c["to"]]
    right, rail = xs[3] + widths[3], 1535 + i * 43
    svg.append(f'<path d="M{right} {y1} H{rail} V{y2} H{right+5}" fill="none" stroke="#53657d" stroke-width="1.7" stroke-dasharray="7 6" opacity="0.7" marker-end="url(#arrow)"/>')
    for yy in (y1, y2):
        svg.append(f'<circle cx="{rail}" cy="{yy}" r="12" fill="#ffffff" stroke="#53657d"/><text x="{rail}" y="{yy+5}" text-anchor="middle" font-size="13" font-weight="700" fill="#15243e">{i}</text>')

for n in nodes:
    nid = n["id"]
    depth = len(ancestors(nid))
    x, y, w = xs[depth], ys[nid], widths[depth]
    color = colors[nid[0]]
    h = 108 if depth == 0 else 60 if depth == 1 else 48 if depth == 2 else 40
    fill = color if depth <= 1 else wash[nid[0]] if depth == 2 else "#ffffff"
    ink = "#ffffff" if depth <= 1 else "#15243e"
    svg.append(f'<rect x="{x}" y="{y-h/2}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{color}" stroke-width="1.5"/>')
    if depth == 0:
        svg.append(f'<text x="{x+22}" y="{y-23}" font-size="16" fill="#c8d5ea">Logical</text><text x="{x+22}" y="{y+7}" font-size="25" font-weight="700" fill="white">Independent</text><text x="{x+22}" y="{y+37}" font-size="25" font-weight="700" fill="white">learning</text>')
    else:
        size = 22 if depth <= 2 else 21
        svg.append(f'<text x="{x+18}" y="{y+7}" font-size="{size}" font-weight="{700 if depth<=2 else 500}" fill="{ink}">{html.escape(n["word"])}</text>')

svg.append('<text x="64" y="1652" font-size="21" font-weight="700" fill="#15243e">Lateral relationships · dashed links do not create child branches</text>')
for i, c in enumerate(data["cross_links"], 1):
    column = (i - 1) % 2
    row = (i - 1) // 2
    x, y = 64 + column * 900, 1695 + row * 39
    sentence = f'{i}. {lookup[c["from"]]["word"]} → {lookup[c["to"]]["word"]}: {c["label"]}'
    svg.append(f'<text x="{x}" y="{y}" font-size="18" fill="#41536b">{html.escape(sentence)}</text>')
svg.append('</g></svg>')
(HERE / "river-map.svg").write_text("\n".join(svg))

cross_by_pair = {frozenset([c["from"], c["to"]]): c for c in data["cross_links"]}

def relationship(a, b):
    if b["parent"] == a["id"]:
        return "contains", f'{a["word"]} groups {b["word"]} as one of its three parts.'
    if a["parent"] == b["id"]:
        return "part of", f'{a["word"]} is one of the three parts of {b["word"]}.'
    if a["id"] in ancestors(b["id"]):
        return "ancestor", f'{b["word"]} contributes through its intervening topic(s) to {a["word"]}.'
    if b["id"] in ancestors(a["id"]):
        return "descendant", f'{a["word"]} contributes through its intervening topic(s) to {b["word"]}.'
    pair = cross_by_pair.get(frozenset([a["id"], b["id"]]))
    if pair:
        return "lateral", pair["why"]
    if a["parent"] == b["parent"]:
        return "siblings", f'Complementary parts of {lookup[a["parent"]]["word"]}; neither replaces the other.'
    if a["id"][0] == b["id"][0]:
        return "shared branch", f'Connected through {lookup[a["id"][0]]["word"]}; no additional direct dependency is asserted.'
    return "indirect", "Connected through the Independent learning goal; no additional direct dependency is asserted."

pairs = []
for i, a in enumerate(nodes):
    for b in nodes[i + 1:]:
        kind, text = relationship(a, b)
        pairs.append({"a": a["id"], "b": b["id"], "kind": kind, "relationship": text})
assert len(pairs) == 780
(HERE / "all-relationships.json").write_text(json.dumps({"terms": {n["id"]: n["word"] for n in nodes}, "note": "Every unordered pair is classified. Hierarchy and declared lateral design relationships are explicit; indirect links do not claim empirical causation.", "pairs": pairs}, ensure_ascii=False, separators=(",", ":")))

rel = ["# Complete relationship analysis", "", "All 40 terms are related explicitly to each of the other 39 terms below. Groups with the same relationship share an explanation to avoid repeating identical sentences. The machine-readable companion enumerates all 780 unordered pairs: [all-relationships.json](assets/all-relationships.json).", "", "Containment is a conceptual grouping. Lateral links are design dependencies proposed in this framework, not research-proven causal effects. An indirect relationship means only a common goal; no direct dependency is invented.", ""]
for a in nodes:
    rel.extend([f'## {a["word"]}', "", "| Relationship | Other terms | Explanation |", "|---|---|---|"])
    groups = defaultdict(list)
    for b in nodes:
        if b["id"] != a["id"]:
            kind, text = relationship(a, b)
            if kind in ("contains", "part of", "ancestor", "descendant", "lateral"):
                rel.append(f'| {kind} | {b["word"]} | {text} |')
            else:
                groups[(kind, text)].append(b["word"])
    for (kind, text), terms in groups.items():
        rel.append(f'| {kind} | {"; ".join(terms)} | {text} |')
    rel.append("")
(HERE.parent / "RELATIONSHIPS.md").write_text("\n".join(rel))

md = ["# Tutor UX: river-style mind map", "", "This map is a proposed framework grounded in the repository audit. The Logical trunk has three children. Every other nonterminal node has three children. There are three hierarchy levels below Logical. Dashed lateral links are relationships, not hierarchy branches.", "", "## 1. Vocabulary list", "", "; ".join(n["word"] for n in nodes) + ".", "", "## 2. How it relates analysis", "", "The table names the main relationship for every node. [RELATIONSHIPS.md](RELATIONSHIPS.md) explicitly classifies every term against all other terms; its JSON companion covers all 780 unordered pairs. Unconnected topics share the goal without an invented causal dependency.", "", "| Term | Main relationships |", "|---|---|"]
for n in nodes:
    md.append(f'| {n["word"]} | {n["relates"]} |')
md.extend(["", "### Lateral links", "", "| From | To | Why |", "|---|---|---|"])
for c in data["cross_links"]:
    md.append(f'| {lookup[c["from"]]["word"]} | {lookup[c["to"]]["word"]} | {c["why"]} |')
md.extend(["", "## 3. Chunk groups", "", "| Parent | Child 1 | Child 2 | Child 3 |", "|---|---|---|---|"])
for n in nodes:
    if children[n["id"]]:
        md.append("| " + " | ".join([n["word"]] + [lookup[c]["word"] for c in children[n["id"]]]) + " |")
md.extend(["", "## 4. Mermaid mind-map code", "", "```mermaid", mermaid.rstrip(), "```", "", "## 5. Rendered diagram", "", "![Complete Tutor UX river map](assets/river-map.svg)", "", "[Open the scalable SVG](assets/river-map.svg) · [PNG preview](assets/river-map.png) · [Mermaid source](assets/river-map.mmd)", "", "## 6. Definitions table", "", "| Word | Quick Definition | Why It’s Important | How It Relates (to help chunking) | Deep Dive | Example | ELI5-Style Explanation |", "|---|---|---|---|---|---|---|"])
for n in nodes:
    md.append("| " + " | ".join(n[k].replace("|", "\\|") for k in ["word", "quick", "why", "relates", "deep", "example", "eli5"]) + " |")
md.extend(["", "The behavioral and operational applications follow in [FRAMEWORK.md](FRAMEWORK.md), [WORKFLOWS.md](WORKFLOWS.md) and [PROCESS-SERIES.md](PROCESS-SERIES.md).", ""])
(HERE.parent / "RIVER-MAP.md").write_text("\n".join(md))

try:
    import fitz
except ImportError:
    print("SVG, Mermaid and Markdown created; install PyMuPDF to rebuild the PNG preview.")
else:
    vector = fitz.open(stream=(HERE / "river-map.svg").read_bytes(), filetype="svg")
    pdf = fitz.open("pdf", vector.convert_to_pdf())
    pix = pdf[0].get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
    pix.save(HERE / "river-map.png")
    print(f"Validated {len(nodes)} nodes, 39 hierarchy links, 6 lateral links, {len(pairs)} unordered pairs; rendered {pix.width}×{pix.height} PNG.")
