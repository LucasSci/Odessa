from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BRANDING_DIR = ROOT / "assets" / "branding"
PUBLIC_DIR = ROOT / "public"


def draw_icon(size: int) -> Image.Image:
    scale = size / 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def box(x1: int, y1: int, x2: int, y2: int) -> tuple[int, int, int, int]:
        return tuple(round(v * scale) for v in (x1, y1, x2, y2))

    radius = round(232 * scale)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=(3, 9, 20, 255))
    draw.rounded_rectangle(box(48, 48, 976, 976), radius=round(190 * scale), outline=(15, 23, 42, 255), width=max(2, round(18 * scale)))

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(box(232, 232, 792, 792), outline=(34, 211, 238, 170), width=max(1, round(128 * scale)))
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, round(24 * scale))))
    img.alpha_composite(glow)

    draw = ImageDraw.Draw(img)
    draw.ellipse(box(230, 230, 794, 794), outline=(226, 246, 255, 255), width=max(8, round(38 * scale)))
    draw.ellipse(box(264, 264, 760, 760), outline=(34, 211, 238, 255), width=max(10, round(84 * scale)))
    draw.ellipse(box(358, 358, 666, 666), fill=(7, 17, 31, 255))
    draw.arc(box(256, 256, 768, 768), start=298, end=350, fill=(240, 249, 255, 230), width=max(2, round(28 * scale)))
    draw.ellipse(box(704, 246, 780, 322), fill=(103, 232, 249, 255))
    draw.ellipse(box(682, 224, 802, 344), outline=(34, 211, 238, 92), width=max(1, round(14 * scale)))
    draw.arc(box(218, 218, 806, 806), start=122, end=158, fill=(56, 189, 248, 142), width=max(2, round(24 * scale)))

    return img


def main() -> None:
    BRANDING_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    icon_1024 = draw_icon(1024)
    icon_512 = draw_icon(512)
    icon_256 = draw_icon(256)

    icon_1024.save(BRANDING_DIR / "odessa-icon.png")
    icon_512.save(BRANDING_DIR / "odessa-icon-512.png")
    icon_256.save(BRANDING_DIR / "odessa-icon-256.png")
    icon_256.save(PUBLIC_DIR / "favicon.png")
    icon_256.save(PUBLIC_DIR / "favicon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon_1024.save(BRANDING_DIR / "odessa-icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    print(f"Generated {BRANDING_DIR / 'odessa-icon.ico'}")
    print(f"Generated {PUBLIC_DIR / 'favicon.ico'}")


if __name__ == "__main__":
    main()
