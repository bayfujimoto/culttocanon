"""
Bake the .pixelated.png variant for every background source in /public/backgrounds/.

SUPERSEDED by build/vite-plugin-background-pixelate.js, which fires
automatically at `vite dev` startup and at `vite build`. This script is
kept as a manual fallback for the rare case you want to bake outside the
Vite pipeline (e.g. inspecting the variant before checking in a source).

The plugin and this script produce equivalent output — same resize target
(80px wide), same area-style downsample. If they ever diverge, the plugin
is the source of truth.

Usage:
    python3 build/bake-backgrounds.py
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BG_DIR = ROOT / "public" / "backgrounds"
TARGET_WIDTH = 80   # matches mockup 05-pixelate.html

def bake(src_path: Path) -> Path | None:
    """Bake `src_path.jpg` → `src_path.pixelated.png`. Skips if already exists."""
    out_path = src_path.with_suffix(".pixelated.png")
    if out_path.exists():
        return None
    img = Image.open(src_path).convert("RGB")
    ratio = TARGET_WIDTH / img.width
    size = (TARGET_WIDTH, max(1, round(img.height * ratio)))
    img.resize(size, Image.Resampling.BOX).save(out_path, optimize=True)
    return out_path

def main():
    if not BG_DIR.is_dir():
        raise SystemExit(f"backgrounds dir not found: {BG_DIR}")
    sources = sorted(p for p in BG_DIR.iterdir() if p.suffix.lower() == ".jpg")
    if not sources:
        print(f"(no .jpg sources in {BG_DIR})")
        return
    new_count = 0
    for src in sources:
        out = bake(src)
        if out:
            new_count += 1
            print(f"baked  {out.relative_to(ROOT)}")
        else:
            print(f"skip   {src.relative_to(ROOT)}  (variant exists)")
    print(f"\nDone. {new_count} new variant(s) baked.")

if __name__ == "__main__":
    main()
