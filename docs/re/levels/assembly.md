# How a level is put together

```
.WAM  ──► object i: type, x, y
           │
           ├─ .OBT[type] ──► width, height (in 8x8 tiles)
           └─ .I[i]      ──► shape index
                             │
                             ├─ .G2[shape]  ──► scanlines, drawn at width x height
                             └─ .G2R[shape] ──► 1 static / 2 destructible
.SCN ──► 320x200 background layers      .PAL ──► palette for all of the above
```

Sprites are separate: `SPR/<name>.SPR` + `SPR/<name>.PAL`, drawn by the
same blitter, positioned by the frame's own origin.
