# -*- coding: utf-8 -*-
"""Generate FlowDay PWA icons from the brand gradient (offline, no repo dependency).

Run manually when the brand changes:
    python tools/gen-icons.py

Outputs into public/icons:
  icon-192.png, icon-512.png            (purpose: any, rounded corners)
  icon-192-maskable.png, icon-512-maskable.png (maskable, full-bleed + safe zone)
  apple-touch-icon-180.png              (iOS home screen)

Requires Pillow only in the operator's environment; the repository itself keeps
zero runtime/dev dependencies for icon generation (assets are committed).
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")

STOPS = [(0.0, (242, 164, 92)), (0.52, (201, 102, 143)), (1.0, (91, 92, 191))]
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for i in range(len(STOPS) - 1):
                t0, c0 = STOPS[i]
                t1, c1 = STOPS[i + 1]
                if t0 <= t <= t1:
                    px[x, y] = lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
                    break
            else:
                px[x, y] = STOPS[-1][1]
    return img


def rounded(img, radius_ratio=0.22):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def with_glyph(img, glyph_ratio=0.46):
    size = img.size[0]
    draw = ImageDraw.Draw(img)
    f = font(int(size * glyph_ratio))
    text = "F"
    box = draw.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=f, fill=(255, 255, 255, 246))
    return img


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    print("wrote", path, img.size)


def main():
    for s in (192, 512):
        base = gradient(s)
        save(with_glyph(rounded(base)), f"icon-{s}.png")
        # maskable：全幅背景 + 安全区内的图形（避免被系统圆形裁切）
        maskable = gradient(s).convert("RGBA")
        inner = int(s * 0.72)
        glyph = with_glyph(Image.new("RGBA", (inner, inner), (0, 0, 0, 0)))
        maskable.alpha_composite(glyph, ((s - inner) // 2, (s - inner) // 2))
        save(maskable, f"icon-{s}-maskable.png")
    save(with_glyph(rounded(gradient(180), 0.24)), "apple-touch-icon-180.png")


if __name__ == "__main__":
    main()
