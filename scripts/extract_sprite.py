"""
Extracts a character sprite from a screen-captured game frame by:
1. Cropping to a bounding box (given manually, by inspection).
2. Removing the background via BFS flood-fill from the image border —
   any pixel connected to the border within a color-distance threshold
   of its neighbor becomes transparent. This avoids eating into
   same-colored regions *inside* the character silhouette (e.g. a white
   shirt) since those aren't connected to the border.
3. Trimming to the tight alpha bounding box and upscaling with NEAREST
   (preserves crisp pixel-art edges).

Usage: python3 extract_sprite.py <src.png> <x0> <y0> <x1> <y1> <out.png> [threshold] [scale]
"""
import sys
from collections import deque
from PIL import Image
import numpy as np


def flood_fill_bg(rgb, threshold=28):
    h, w, _ = rgb.shape
    visited = np.zeros((h, w), dtype=bool)
    alpha = np.full((h, w), 255, dtype=np.uint8)

    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))

    while q:
        x, y = q.popleft()
        if x < 0 or x >= w or y < 0 or y >= h or visited[y, x]:
            continue
        visited[y, x] = True
        alpha[y, x] = 0
        c = rgb[y, x].astype(int)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx]:
                nc = rgb[ny, nx].astype(int)
                if np.abs(nc - c).sum() <= threshold:
                    q.append((nx, ny))
    return alpha


def main():
    src, x0, y0, x1, y1, out = sys.argv[1:7]
    threshold = int(sys.argv[7]) if len(sys.argv) > 7 else 28
    scale = int(sys.argv[8]) if len(sys.argv) > 8 else 3

    im = Image.open(src).convert('RGB').crop((int(x0), int(y0), int(x1), int(y1)))
    rgb = np.array(im)
    alpha = flood_fill_bg(rgb, threshold)

    rgba = np.dstack([rgb, alpha])
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        print('WARNING: everything removed, lower threshold')
        return
    pad = 2
    x_min, x_max = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + pad)
    y_min, y_max = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + pad)
    trimmed = rgba[y_min:y_max, x_min:x_max]

    out_im = Image.fromarray(trimmed, 'RGBA')
    out_im = out_im.resize((out_im.width * scale, out_im.height * scale), Image.NEAREST)
    out_im.save(out)
    print(f'saved {out} size={out_im.size}')


if __name__ == '__main__':
    main()
