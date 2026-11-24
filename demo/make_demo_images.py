"""Make the two made-up-brand demo ads used in the README and the demo video.
Run: python3 demo/make_demo_images.py  (needs Pillow)"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BOLD = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def gradient(w, h, top, bottom):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    return im


def bottle(im, cx, cy, s):
    d = ImageDraw.Draw(im, "RGBA")
    # soft shadow
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - 170 * s, cy + 300 * s, cx + 170 * s, cy + 360 * s], fill=(0, 0, 0, 90))
    im.paste(sh.filter(ImageFilter.GaussianBlur(18)), (0, 0), sh.filter(ImageFilter.GaussianBlur(18)))
    d.rounded_rectangle([cx - 120 * s, cy - 180 * s, cx + 120 * s, cy + 330 * s], radius=int(60 * s), fill=(250, 214, 220, 255), outline=(255, 255, 255, 200), width=4)
    d.rounded_rectangle([cx - 45 * s, cy - 300 * s, cx + 45 * s, cy - 175 * s], radius=int(14 * s), fill=(60, 40, 60, 255))
    d.rounded_rectangle([cx - 95 * s, cy - 40 * s, cx + 95 * s, cy + 160 * s], radius=int(16 * s), fill=(255, 255, 255, 235))
    d.text((cx, cy + 25 * s), "GLOWBERRY", font=font(BOLD, int(30 * s)), fill=(120, 40, 80), anchor="mm")
    d.text((cx, cy + 80 * s), "night serum", font=font(REG, int(26 * s)), fill=(120, 40, 80), anchor="mm")


def story():
    W, H = 1080, 1920
    im = gradient(W, H, (255, 196, 160), (196, 80, 130)).convert("RGBA")
    d = ImageDraw.Draw(im)
    # headline jammed at the very top (inside Meta's 14% top margin)
    d.text((W // 2, 120), "CLEAR SKIN IN 7 DAYS", font=font(BOLD, 86), fill="white", anchor="mm")
    d.text((W // 2, 330), "Glowberry Skin Lab", font=font(REG, 54), fill=(255, 240, 245), anchor="mm")
    bottle(im, W // 2, 950, 1.25)
    # CTA low in the frame (inside the 35% bottom margin)
    d.rounded_rectangle([W // 2 - 260, 1640, W // 2 + 260, 1760], radius=60, fill="white")
    d.text((W // 2, 1700), "Shop now - 50% off", font=font(BOLD, 50), fill=(196, 60, 110), anchor="mm")
    d.text((W // 2, 1840), "Guaranteed results or your money back", font=font(REG, 36), fill="white", anchor="mm")
    im.convert("RGB").save(os.path.join(HERE, "glowberry-story.png"))


def square():
    W, H = 1200, 1200
    im = gradient(W, H, (40, 30, 60), (110, 60, 120)).convert("RGBA")
    d = ImageDraw.Draw(im)
    d.text((W // 2, 150), "Glowberry Night Oil", font=font(BOLD, 80), fill="white", anchor="mm")
    d.text((W // 2, 250), "Vegan. Small batch. Made for night.", font=font(REG, 44), fill=(235, 220, 240), anchor="mm")
    bottle(im, W // 2, 700, 1.0)
    im.convert("RGB").save(os.path.join(HERE, "glowberry-square.png"))


if __name__ == "__main__":
    story()
    square()
    print("wrote demo/glowberry-story.png and demo/glowberry-square.png")
