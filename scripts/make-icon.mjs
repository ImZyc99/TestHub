// 生成应用图标 → build/icon.png（1024）+ build/icon.icns
//
//   node scripts/make-icon.mjs                        用内置的紫色 T 标记
//   node scripts/make-icon.mjs path/to/pic.png        用你自己的图
//   node scripts/make-icon.mjs path/to/pic.png --card 强制放到白色圆角卡片上
//
// 默认走「自由形状」：图形直接浮在 Dock 上。白底的源图会先抠掉背景 ——
// 用四角 flood fill 只吃连通的背景色，图形内部的白色（比如白问号）不会被挖掉。
// 自由形状在小尺寸下比卡片版清楚得多，因为不用给卡片留内边距。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const buildDir = path.join(root, 'build')
fs.mkdirSync(buildDir, { recursive: true })

const args = process.argv.slice(2)
const forceCard = args.includes('--card')
// --bg RRGGBB / --bg RRGGBB,RRGGBB（两个色 = 渐变）
const bgArg = args.find((a) => a.startsWith('--bg='))?.slice(5) ?? null
// --full：底色铺满整张画布，不再往里缩一圈（去掉四周透明留白）
const fullBleed = args.includes('--full')
// --square：完全不切圆角，纯方图（iOS/App Store 那种母版形态）
const squareMode = args.includes('--square')
// --pad=N：图形距边缘的安全边距，占卡片边长的百分比
const padArg = (() => {
  const hit = args.find((a) => a.startsWith('--pad='))
  const v = hit ? Number(hit.slice(6)) : NaN
  return Number.isFinite(v) ? v : null
})()
const sourceArg = args.find((a) => !a.startsWith('--'))
const source = sourceArg ? path.resolve(sourceArg) : null
if (source && !fs.existsSync(source)) {
  console.error(`[icon] 找不到源图：${source}`)
  process.exit(1)
}

const PY = `
import os, sys
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
FULL = ${fullBleed ? 'True' : 'False'}
# 常规模式留 6% 透明边；--full 模式铺满整张画布（四周不留透明）
INSET = 0 if FULL else int(SIZE * 0.06)
BOX = SIZE - INSET * 2
RADIUS = 0 if ${squareMode ? 'True' : 'False'} else int(BOX * 0.225)
SRC = ${source ? `r"""${source}"""` : 'None'}
FORCE_CARD = ${forceCard ? 'True' : 'False'}
BG = ${bgArg ? `"${bgArg}"` : 'None'}
OUT = os.path.join(r"""${buildDir}""", 'icon.png')

def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m

def builtin_card():
    TOP, BOTTOM, CREAM = (0x91,0x79,0xE2), (0x5A,0x41,0xA8), (0xF2,0xE9,0xA8)
    S = 4
    w = h = BOX * S
    grad = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(grad)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(TOP[i] + (BOTTOM[i]-TOP[i])*t) for i in range(3)))
    card = Image.new('RGBA', (w, h), (0,0,0,0))
    card.paste(grad, (0,0), rounded_mask(w, h, RADIUS*S))
    font = None
    for p in ['/System/Library/Fonts/Supplemental/Arial Bold.ttf',
              '/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf']:
        if os.path.exists(p):
            try:
                font = ImageFont.truetype(p, int(BOX*S*0.58)); break
            except Exception: pass
    if font is None: raise SystemExit('找不到可用字体')
    td = ImageDraw.Draw(card)
    b = td.textbbox((0,0), 'T', font=font)
    td.text(((w-(b[2]-b[0]))/2 - b[0], (h-(b[3]-b[1]))/2 - b[1]), 'T', font=font, fill=CREAM+(255,))
    return card.resize((BOX, BOX), Image.LANCZOS)

def dekey(im):
    """抠掉纯色背景：从四角 flood fill，只吃连通区域，
    所以图形内部的白色（白问号、高光）会被保留。"""
    from PIL import ImageFilter
    rgb = im.convert('RGB')
    w, h = rgb.size
    probe = rgb.copy()
    SENT = (255, 0, 255)
    for c in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]:
        ImageDraw.floodfill(probe, c, SENT, thresh=26)
    alpha = Image.new('L', (w, h), 255)
    pa, pp = alpha.load(), probe.load()
    for y in range(h):
        for x in range(w):
            if pp[x, y] == SENT:
                pa[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))   # 边缘羽化
    out = rgb.convert('RGBA')
    out.putalpha(alpha)
    return out

def trim(im):
    """裁掉四周全透明的空白"""
    rgba = im.convert('RGBA')
    bbox = rgba.split()[3].getbbox()
    return rgba.crop(bbox) if bbox else rgba

def fit(im, target):
    """等比缩放到 target 见方并居中，不裁切"""
    w, h = im.size
    s = min(target / w, target / h)
    im = im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (target, target), (0,0,0,0))
    canvas.paste(im, ((target-im.size[0])//2, (target-im.size[1])//2), im)
    return canvas

icon = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))

if SRC is None:
    card = builtin_card()
    icon.paste(card, (INSET, INSET), card)
    mode = '内置 T 标记'
else:
    src = Image.open(SRC).convert('RGBA')
    keyed = src.split()[3].getextrema()[0] < 250   # 本来就有透明通道
    if not keyed:
        src = dekey(src)                            # 白底：抠掉
    art = trim(src)

    # 顺手导出一张给界面用的透明 logo
    art.resize((512, 512), Image.LANCZOS) if False else None
    art.save(os.path.join(r"""${root}""", 'src', 'assets', 'logo.png'))

    if FORCE_CARD or BG:
        def hexc(v): return tuple(int(v[i:i+2],16) for i in (0,2,4))
        cols = [hexc(c.strip().lstrip('#')) for c in BG.split(',')] if BG else [(255,255,255)]
        fill = Image.new('RGB', (BOX, BOX), cols[0])
        if len(cols) > 1:
            d2 = ImageDraw.Draw(fill)
            for y in range(BOX):
                t = y/(BOX-1)
                d2.line([(0,y),(BOX,y)], fill=tuple(round(cols[0][i]+(cols[1][i]-cols[0][i])*t) for i in range(3)))
        card = Image.new('RGBA', (BOX, BOX), (0,0,0,0))
        card.paste(fill.convert('RGBA'), (0,0), rounded_mask(BOX, BOX, RADIUS))
        pad = int(BOX * ${padArg !== null ? padArg : 'null'} / 100) if ${padArg !== null ? 'True' : 'False'} else (int(BOX * 0.12) if FULL else int(BOX * 0.015))
        # 用 alpha_composite 而不是 paste —— paste 会让图形的半透明边缘
        # 把底下卡片的 alpha 一起打穿，纯方图就不再是「完全不透明」了
        inner = fit(art, BOX - pad*2)
        layer = Image.new('RGBA', (BOX, BOX), (0,0,0,0))
        layer.paste(inner, (pad, pad))
        card = Image.alpha_composite(card, layer)
        icon.paste(card, (INSET, INSET), card)
        mode = f'{"铺满画布" if FULL else "圆角卡片"}({BG or "白"}) + 源图'
    else:
        art = fit(art, BOX)
        icon.paste(art, (INSET, INSET), art)
        mode = '自由形状' + ('' if keyed else '（已抠掉白底）')

icon.save(OUT)
print(f'icon.png 1024x1024 — {mode}')
`

execFileSync('python3', ['-c', PY], { stdio: 'inherit' })

/* ---- macOS：用 iconutil 生成 icns ---- */
if (process.platform === 'darwin') {
  const iconset = path.join(buildDir, 'icon.iconset')
  fs.rmSync(iconset, { recursive: true, force: true })
  fs.mkdirSync(iconset)

  const src = path.join(buildDir, 'icon.png')
  const specs = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of specs) {
    fs.copyFileSync(src, path.join(iconset, name))
    execFileSync('sips', ['-z', String(size), String(size), path.join(iconset, name)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')])
  fs.rmSync(iconset, { recursive: true, force: true })
  console.log('icon.icns 已生成')
}

console.log('图标已写入 build/')
