# Generates the worlds block of public/app.css (between the Worlds comment and the tablets section).
# Each world is a token set plus a few signature rules. Run: python3 scripts/build-worlds-css.py
W = {}
W['cartoon'] = dict(tokens="""
  --sans: Nunito, ui-rounded, system-ui, sans-serif; --display: Bangers, Nunito, system-ui, sans-serif; --display-weight: 400; --logo-font: Bangers, Nunito, sans-serif; --button-font: Nunito, system-ui, sans-serif;
  --page: #ffffff; --card: #ffffff; --page-bg: #ffe23f url("/worlds/cartoon/pattern.webp") 0 0 / 420px repeat;
  --ink: #1a1030; --ink-2: #3b2f5c; --ink-3: #574b78; --rule: #e7defa; --parts: #f6f1ff; --parts-2: #e3d8ff;
  --yellow: #ffd400; --yellow-side: #c79f00; --yellow-wash: #fff6c2;
  --blue: #1f5fff; --blue-side: #1240b8; --blue-wash: #e2ebff;
  --green: #e6007e; --green-side: #8f004e; --green-wash: #ffe0f0; --green-hover: #c4006b;
  --red: #ff3b30; --red-wash: #ffe6e3;
  --line: 3px; --r-sm: 12px; --r: 16px; --r-lg: 22px; --r-btn: 999px;
  --heading-shadow: 3px 3px 0 #ffd400; --frame-shadow: 8px 8px 0 var(--ink);
  --nav-bg: #ffd400; --nav-ink: #1a1030; --nav-active: #e6007e; --nav-active-ink: #ffffff; --hero: url("/worlds/cartoon/hero.webp"); --bloop-wave: url("/worlds/cartoon/bloop-wave.webp"); --bloop-think: url("/worlds/cartoon/bloop-think.webp"); --bloop-cheer: url("/worlds/cartoon/bloop-cheer.webp"); --bloop-oops: url("/worlds/cartoon/bloop-oops.webp");""",
rules="""
@S .top { border-bottom: 0; background: #fff; margin-top: 12px; padding: 0 16px; border-radius: 999px; box-shadow: 0 5px 0 var(--ink), 0 0 0 3px var(--ink); }
@S h1 { letter-spacing: 0.02em; font-size: clamp(2.2rem, 1.6rem + 3vw, 3.4rem); line-height: 0.95; }
@S h2 { letter-spacing: 0.02em; font-size: 1.6rem; }
@S .today-mission, @S .prompt, @S .week-note, @S .build-log, @S .class-card, @S .strength-detail, @S .auth-forms .panel, @S .world-tile { box-shadow: 6px 6px 0 var(--ink); }
@S .today-mission { transform: rotate(-0.6deg); }
@S .today-mission h2 { font-size: clamp(2rem, 1.4rem + 2.6vw, 2.8rem); text-shadow: 3px 3px 0 #00d1ff; }
@S button:not(.linklike):not(.planner-fab), @S .button { font-weight: 900; text-transform: uppercase; letter-spacing: 0.03em; box-shadow: 0 5px 0 var(--ink); }
@S button.ghost:not(.linklike):not(.planner-fab), @S .button.ghost { box-shadow: 0 4px 0 var(--ink); }
@S .mission-start button.go, @S .answer > button[type=submit] { font: 400 30px/1 Bangers, Nunito, sans-serif; letter-spacing: 0.06em; transform: rotate(-1deg); background: var(--green); }
@S .question-text { font-family: Nunito, system-ui, sans-serif; font-weight: 900; }
@S .step-number { font-family: Bangers, sans-serif; color: var(--green); text-shadow: 4px 4px 0 var(--ink); }
@S .ok { background: #eafff3; border-color: #00b86b; }"""
)
W['8bit'] = dict(tokens="""
  --sans: Nunito, system-ui, sans-serif; --display: "Pixelify Sans", Nunito, monospace; --display-weight: 700; --logo-font: "Pixelify Sans", monospace; --button-font: "Pixelify Sans", Nunito, monospace; --numeral: "Pixelify Sans", monospace;
  --page: #fff7e1; --card: #fff7e1; --page-bg: #5c94fc url("/worlds/8bit/pattern.webp") 0 0 / 384px repeat;
  --ink: #000000; --ink-2: #2a2a2a; --ink-3: #4a4a4a; --rule: #d8c9a0; --parts: #f3e6bf; --parts-2: #d8c48c;
  --yellow: #f8b800; --yellow-side: #ac7c00; --yellow-wash: #fff0b8;
  --blue: #0047d6; --blue-side: #001f8f; --blue-wash: #d6e4ff;
  --green: #c84c0c; --green-side: #7c2c00; --green-wash: #ffe2cf; --green-hover: #a63c08;
  --red: #d82800; --red-wash: #ffdcd2;
  --line: 4px; --r-sm: 0px; --r: 0px; --r-lg: 0px; --r-btn: 0px; --frame-shadow: inset -8px -8px 0 rgba(0, 0, 0, 0.12), 0 0 0 4px #fff;
  --heading: #ffffff; --heading-shadow: 3px 3px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000;
  --nav-bg: #000000; --nav-ink: #ffffff; --nav-active: #f8b800; --nav-active-ink: #000000; --hero: url("/worlds/8bit/hero.webp"); --bloop-wave: url("/worlds/8bit/bloop-wave.webp"); --bloop-think: url("/worlds/8bit/bloop-think.webp"); --bloop-cheer: url("/worlds/8bit/bloop-cheer.webp"); --bloop-oops: url("/worlds/8bit/bloop-oops.webp");""",
rules="""
@S .companion { image-rendering: pixelated; }
@S .top { border-bottom: 0; background: #000; margin: 10px auto 0; padding: 0 14px; }
@S .mark { color: #fff; }
@S .today-mission h2, @S .prompt h1, @S .week-note h2, @S .build-log h2, @S .panel h2, @S .class-card h2, @S .strength-detail h2, @S .world-tile strong, @S .auth-forms .panel h2, @S .card h2 { color: var(--ink); text-shadow: none; }
@S .today-mission, @S .prompt, @S .week-note, @S .build-log, @S .class-card, @S .strength-detail, @S .auth-forms .panel, @S .world-tile, @S .panel, @S .pack-ask { clip-path: polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px)); box-shadow: inset -6px -6px 0 rgba(0, 0, 0, 0.12); }
@S button:not(.linklike):not(.planner-fab), @S .button { box-shadow: inset -5px -5px 0 rgba(0, 0, 0, 0.35), inset 5px 5px 0 rgba(255, 255, 255, 0.35); text-transform: uppercase; letter-spacing: 0.04em; }
@S button:not(.linklike):active, @S .button:active { box-shadow: inset 5px 5px 0 rgba(0, 0, 0, 0.35); transform: none; }
@S .mission-start button.go, @S .answer > button[type=submit] { font-size: 26px; }
@S .stones li, @S .mission-plan span, @S .step-tag { border-radius: 0; }
"""
)
W['toybox'] = dict(tokens="""
  --sans: Fredoka, Nunito, system-ui, sans-serif; --display: Fredoka, Nunito, system-ui, sans-serif; --display-weight: 700; --logo-font: Fredoka, sans-serif; --button-font: Fredoka, sans-serif; --numeral: Fredoka, sans-serif;
  --page: #ffffff; --card: #ffffff; --page-bg: #efe4ff url("/worlds/toybox/pattern.webp") 0 0 / 460px repeat;
  --ink: #3a2a5e; --ink-2: #4f3f74; --ink-3: #66588a; --rule: #ece4ff; --parts: #f6f0ff; --parts-2: #e6dbff;
  --yellow: #ffb21c; --yellow-side: #d98900; --yellow-wash: #fff1d1;
  --blue: #6a3df0; --blue-side: #4a22c0; --blue-wash: #ece5ff;
  --green: #158a3e; --green-side: #0c5e29; --green-wash: #dff6e7; --green-hover: #117a36;
  --red: #e5384d; --red-wash: #ffe3e7;
  --line: 0px; --r-sm: 18px; --r: 24px; --r-lg: 34px; --r-btn: 999px; --frame-shadow: 0 20px 50px rgba(90, 60, 160, 0.22);
  --nav-bg: #ffffff; --nav-ink: #3a2a5e; --nav-active: #ffb21c; --nav-active-ink: #3a2a5e; --hero: url("/worlds/toybox/hero.webp"); --bloop-wave: url("/worlds/toybox/bloop-wave.webp"); --bloop-think: url("/worlds/toybox/bloop-think.webp"); --bloop-cheer: url("/worlds/toybox/bloop-cheer.webp"); --bloop-oops: url("/worlds/toybox/bloop-oops.webp");""",
rules="""
@S .top { border-bottom: 0; background: rgba(255, 255, 255, 0.85); margin-top: 12px; padding: 0 18px; border-radius: 999px; box-shadow: 0 10px 24px rgba(90, 60, 160, 0.16); }
@S .mark { background: linear-gradient(90deg, #ff4fa3, #ffb21c, #2bc96b, #3fa7ff, #8a5cff); -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 700; }
@S .today-mission, @S .prompt, @S .week-note, @S .build-log, @S .class-card, @S .strength-detail, @S .auth-forms .panel, @S .world-tile, @S .panel, @S .pack-ask, @S .quick-missions > a { box-shadow: 0 14px 30px rgba(90, 60, 160, 0.16), inset 0 -6px 0 rgba(90, 60, 160, 0.06); }
@S button:not(.linklike):not(.planner-fab), @S .button { background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 55%); box-shadow: 0 6px 0 var(--green-side), 0 12px 20px rgba(21, 138, 62, 0.25); }
@S button.ghost:not(.linklike):not(.planner-fab), @S .button.ghost { background-image: none; box-shadow: 0 5px 0 var(--parts-2), 0 10px 18px rgba(90, 60, 160, 0.12); }
@S .mission-start button.go, @S .answer > button[type=submit] { font-size: 26px; min-height: 72px; }
@S .mission-plan span, @S .stones li { border-radius: 10px; box-shadow: inset 0 -5px 0 rgba(0, 0, 0, 0.18), inset 0 4px 0 rgba(255, 255, 255, 0.4); }
@S input, @S select, @S textarea { border-radius: 16px; border-color: #d6c8ff; }"""
)
W['sticker'] = dict(tokens="""
  --sans: Nunito, system-ui, sans-serif; --display: "Patrick Hand", Nunito, system-ui, sans-serif; --display-weight: 400; --logo-font: "Patrick Hand", sans-serif; --button-font: Nunito, sans-serif;
  --page: #fffdf6; --card: #fffdf6; --page-bg: #fbf6ea url("/worlds/sticker/pattern.webp") 0 0 / 520px repeat;
  --ink: #2a2340; --ink-2: #463d60; --ink-3: #5f5678; --rule: #eadfca; --parts: #f6efe1; --parts-2: #e7dbc2;
  --yellow: #ffd23f; --yellow-side: #c99f13; --yellow-wash: #fff5c9;
  --blue: #2563c9; --blue-side: #17408a; --blue-wash: #e3ecfb;
  --green: #d63a12; --green-side: #8f250a; --green-wash: #ffe4d9; --green-hover: #b9310e;
  --red: #c62828; --red-wash: #fde4e4;
  --line: 2px; --r-sm: 8px; --r: 12px; --r-lg: 6px; --r-btn: 999px; --frame-shadow: 0 14px 34px rgba(60, 40, 10, 0.18);
  --nav-bg: #fffdf6; --nav-ink: #2a2340; --nav-active: #ffd23f; --nav-active-ink: #2a2340; --hero: url("/worlds/sticker/hero.webp"); --bloop-wave: url("/worlds/sticker/bloop-wave.webp"); --bloop-think: url("/worlds/sticker/bloop-think.webp"); --bloop-cheer: url("/worlds/sticker/bloop-cheer.webp"); --bloop-oops: url("/worlds/sticker/bloop-oops.webp");""",
rules="""
@S h1 { font-size: clamp(2.3rem, 1.7rem + 3vw, 3.4rem); }
@S h2 { font-size: 1.7rem; }
@S .top { border-bottom: 0; }
@S .today-mission { position: relative; transform: rotate(-1deg); box-shadow: 0 10px 20px rgba(60, 40, 10, 0.12); }
@S .today-mission::before { content: ""; position: absolute; top: -14px; left: 50%; width: 120px; height: 28px; margin-left: -60px; background: rgba(255, 120, 170, 0.55); transform: rotate(-4deg); }
@S .prompt, @S .week-note, @S .build-log, @S .class-card, @S .strength-detail, @S .auth-forms .panel, @S .world-tile { box-shadow: 0 8px 18px rgba(60, 40, 10, 0.10); }
@S .prompt { transform: rotate(0.4deg); }
@S button:not(.linklike):not(.planner-fab), @S .button { box-shadow: 0 0 0 4px #fff, 0 6px 14px rgba(60, 40, 10, 0.25); }
@S button.ghost:not(.linklike):not(.planner-fab), @S .button.ghost { box-shadow: 0 0 0 3px #fff, 0 4px 10px rgba(60, 40, 10, 0.15); }
@S .mission-plan span, @S .stones li { border-radius: 50%; box-shadow: 0 0 0 3px #fff, 0 3px 6px rgba(0, 0, 0, 0.18); }
@S .mission-start button.go, @S .answer > button[type=submit] { font-size: 24px; }"""
)
W['princess'] = dict(tokens="""
  --sans: Nunito, system-ui, sans-serif; --display: "Cherry Bomb One", Nunito, system-ui, sans-serif; --display-weight: 400; --logo-font: "Cherry Bomb One", sans-serif; --button-font: Nunito, sans-serif;
  --page: #fffafd; --card: #fffafd; --page-bg: #ffe4f1 url("/worlds/princess/pattern.webp") 0 0 / 440px repeat;
  --ink: #4a1d4f; --ink-2: #5f3264; --ink-3: #7a4c80; --rule: #f6d7ea; --parts: #fff0f8; --parts-2: #f6d1e6;
  --yellow: #ffcf5c; --yellow-side: #c79a2e; --yellow-wash: #fff3d6;
  --blue: #8e44ad; --blue-side: #5e2a75; --blue-wash: #f3e6fa;
  --green: #c2185b; --green-side: #7f0f3b; --green-wash: #ffe1ee; --green-hover: #a3134c;
  --red: #d32f2f; --red-wash: #ffe3e3;
  --line: 2px; --r-sm: 16px; --r: 22px; --r-lg: 28px; --r-btn: 999px; --frame-shadow: 0 0 0 6px #ffe7a6, 0 0 0 8px var(--ink), 0 18px 40px rgba(194, 24, 91, 0.2);
  --heading: #a3134c; --heading-shadow: 2px 2px 0 #ffcf5c;
  --nav-bg: #fff0f8; --nav-ink: #4a1d4f; --nav-active: #c2185b; --nav-active-ink: #ffffff; --hero: url("/worlds/princess/hero.webp"); --bloop-wave: url("/worlds/princess/bloop-wave.webp"); --bloop-think: url("/worlds/princess/bloop-think.webp"); --bloop-cheer: url("/worlds/princess/bloop-cheer.webp"); --bloop-oops: url("/worlds/princess/bloop-oops.webp");""",
rules="""
@S .top { border-bottom: 0; }
@S .today-mission, @S .prompt, @S .week-note, @S .build-log, @S .class-card, @S .strength-detail, @S .auth-forms .panel, @S .world-tile { box-shadow: 0 0 0 5px #ffe7a6, 0 0 0 7px var(--ink), 0 14px 30px rgba(194, 24, 91, 0.18); }
@S button:not(.linklike):not(.planner-fab), @S .button { background-image: linear-gradient(135deg, #e0418a, #c2185b 55%, #8e44ad); box-shadow: 0 5px 0 var(--green-side), 0 0 18px rgba(255, 207, 92, 0.6); }
@S button.ghost:not(.linklike):not(.planner-fab), @S .button.ghost { background-image: none; }
@S .mission-plan span, @S .stones li { clip-path: polygon(50% 0, 100% 35%, 80% 100%, 20% 100%, 0 35%); border-radius: 0; }
@S .mission-start button.go, @S .answer > button[type=submit] { font: 400 28px/1 "Cherry Bomb One", Nunito, sans-serif; }"""
)
W['booklet'] = dict(tokens="""
  --sans: Lexend, ui-sans-serif, system-ui, sans-serif; --display: Lexend, ui-sans-serif, system-ui, sans-serif; --display-weight: 700; --logo-font: "Archivo Black", Lexend, sans-serif; --button-font: Lexend, sans-serif; --numeral: "Archivo Black", Lexend, sans-serif;
  --page: #ffffff; --card: #ffffff; --page-bg: #ffffff;
  --ink: #111318; --ink-2: #444a57; --ink-3: #5a6070; --rule: #d9dce3; --parts: #eef0f4; --parts-2: #dfe2e9;
  --yellow: #ffcf00; --yellow-side: #b89400; --yellow-wash: #fff5c7;
  --blue: #0a5bd3; --blue-side: #063f96; --blue-wash: #e4eefc;
  --green: #157a3a; --green-side: #0b4f24; --green-wash: #e1f2e6; --green-hover: #126a32;
  --red: #c8261c; --red-wash: #fde8e5;
  --line: 2px; --r-sm: 10px; --r: 14px; --r-lg: 18px; --r-btn: 12px; --heading-shadow: none;
  --hero: url("/worlds/booklet/hero.webp"); --bloop-wave: url("/worlds/booklet/bloop-wave.webp"); --bloop-think: url("/worlds/booklet/bloop-think.webp"); --bloop-cheer: url("/worlds/booklet/bloop-cheer.webp"); --bloop-oops: url("/worlds/booklet/bloop-oops.webp");""",
rules="")
# Step markers: worlds with their own icons (hearts and coins, gems, stickers, stars, toy blocks) replace the plain bricks.
ICON_WORLDS = ['cartoon', '8bit', 'toybox', 'sticker', 'princess']
for _w in ICON_WORLDS:
    _px = ' image-rendering: pixelated;' if _w == '8bit' else ''
    W[_w]['rules'] += f"""
@S .mission-plan span[data-beat], @S .stones li, @S .mission-key i {{ border: 0; border-radius: 0; box-shadow: none; clip-path: none;{_px} background: transparent url("/worlds/{_w}/step-own.webp") center / contain no-repeat; }}
@S .mission-plan span[data-beat=together], @S .stones li[data-beat=together], @S .stones li[data-beat=clue], @S .mission-key [data-beat=together] i {{ background-image: url("/worlds/{_w}/step-together.webp"); }}
@S .mission-plan span[data-beat=review], @S .stones li[data-beat=review], @S .mission-key [data-beat=review] i {{ background-image: url("/worlds/{_w}/step-review.webp"); }}
@S .mission-plan span[data-beat] {{ height: 56px; color: var(--ink); text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff; font-size: 17px; }}
@S .mission-key i {{ width: 22px; height: 22px; }}
@S .stones li {{ width: 30px; height: 30px; }}
@S .stones li[data-state=next] {{ filter: grayscale(1); opacity: 0.4; }}
@S .stones li[data-state=now] {{ border: 0; transform: translateY(-4px) scale(1.2); box-shadow: none; filter: drop-shadow(0 3px 0 var(--ink)); }}"""
# In every world the question itself leads; the topic name above it stays a quiet label.
for _w in W:
    W[_w]['rules'] += "\n@S .prompt h1 { font: 600 1.05rem/1.35 var(--sans); letter-spacing: 0; text-transform: none; text-shadow: none; color: var(--ink-2); }"
FONTS = """
@font-face { font-family: Nunito; src: url('/fonts/nunito-latin.woff2') format('woff2'); font-weight: 200 1000; font-display: swap; }
@font-face { font-family: Bangers; src: url('/fonts/bangers-latin.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: "Pixelify Sans"; src: url('/fonts/pixelify-sans-latin.woff2') format('woff2'); font-weight: 400 700; font-display: swap; }
@font-face { font-family: Fredoka; src: url('/fonts/fredoka-latin.woff2') format('woff2'); font-weight: 300 700; font-display: swap; }
@font-face { font-family: "Patrick Hand"; src: url('/fonts/patrick-hand-latin.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: "Cherry Bomb One"; src: url('/fonts/cherry-bomb-one-latin.woff2') format('woff2'); font-weight: 400; font-display: swap; }
"""
out = ["\n/* ===== Worlds. One app, swappable skins; each child picks a world (src/worlds.ts). Cartoon Club is the default,", "   so a page with no world on it (sign-in, family list) is Cartoon Club too. Scoring and layout never change between worlds. ===== */", FONTS]
for w, d in W.items():
    sel = f':root:has([data-world="{w}"])'
    if w == 'cartoon': sel = ':root:has([data-world="cartoon"]), :root:not(:has([data-world]))'
    out.append(f"{sel} {{{d['tokens']}\n}}")
    for line in d['rules'].strip().splitlines():
        if not line.strip(): continue
        selpart, body = line.split(' {', 1)
        sels = [s.strip().replace('@S ', '') for s in selpart.split(', ')]
        prefixes = [f':root:has([data-world="{w}"])'] + ([':root:not(:has([data-world]))'] if w == 'cartoon' else [])
        full = ', '.join(f'{p} {s}' for s in sels for p in prefixes)
        out.append(f"{full} {{{body}")
css = '\n'.join(out)
path = 'public/app.css'
text = open(path).read()
start, end = text.index('\n/* ===== Worlds.'), text.index('/* Tablets and laptops */')
open(path, 'w').write(text[:start] + css + '\n\n' + text[end:])
print('worlds block written')
