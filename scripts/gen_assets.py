#!/usr/bin/env python3
"""Генерация иконок Yume Haze Zapret: res/icon.ico (256/128/64/48/32/16)
и renderer/assets/tray.png (16x16). Нужен Pillow: pip install pillow"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A1 = (185, 162, 255)
A2 = (255, 159, 203)
DARK = (18, 14, 32)
GLYPH = "夢"


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=(
            int(A1[0] + (A2[0] - A1[0]) * t),
            int(A1[1] + (A2[1] - A1[1]) * t),
            int(A1[2] + (A2[2] - A1[2]) * t),
        ))
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=radius * 4, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def find_font(size):
    cands = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "C:/Windows/Fonts/YuGothB.ttc",
        "C:/Windows/Fonts/meiryob.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
    ]
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=0)
            except Exception:
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    continue
    return ImageFont.load_default()


def make(size):
    base = gradient(size)
    mask = rounded_mask(size, int(size * 0.28))
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # внутреннее свечение
    d.rounded_rectangle([int(size * .06), int(size * .06), int(size * .94), int(size * .94)],
                        radius=int(size * .24), outline=(255, 255, 255, 60), width=max(1, size // 64))
    font = find_font(int(size * 0.62))
    text = GLYPH
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=DARK + (255,))
    return img


def main():
    os.makedirs(os.path.join(ROOT, "res"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "renderer", "assets"), exist_ok=True)
    big = make(1024)
    ico_path = os.path.join(ROOT, "res", "icon.ico")
    big.save(ico_path, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "res", "icon.png"))
    make(16).save(os.path.join(ROOT, "renderer", "assets", "tray.png"))
    make(64).save(os.path.join(ROOT, "renderer", "assets", "logo.png"))
    print("icon.ico, icon.png, tray.png, logo.png созданы")


if __name__ == "__main__":
    main()
