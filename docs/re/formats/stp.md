# `.STP` — the level's additive blend table — **Confirmed**

65536 bytes: a 256x256 table read at level load into `blend_table`
(0xbd4e4, VA 0x10be9) and used as `dst = table[src × 256 + dst]` (VA
0x34ed8). Row 0 is the identity — colour 0 is see-through. Every other
entry is the palette colour **nearest to `src + dst`, saturating**: light
added to what is behind. Checked on 0A, 3C, 7M and EK with the merged
palette — mean error 16-21 against 11-18 for the best any palette colour
could do, while "half and half" scores 115 and more. The debug switch
`/STP [1-3 | 4]` writes one (the "transparency" being its strength; 4,
full, is what ships).

Drawn through it:
- **rubble** (VA 0x2d381) — which is why smashed blocks look pale and
  ghostly;
- sprites whose template word +0x18 has bits 0x8000 | 0x2000 (VA
  0x2d552; drawing mode `+0x20 = -2`): the **bubble**, the **panel's**
  twinkle and layers, the **teleporter's beam**, `VM`;
- panel icons with the same bits in their frame word (VA 0x2e4b4).

The same template word with 0x8000 alone is a colour remap — table
`0xa1c28[n]`, 256 bytes: 1-3 are the player colours (Jack, flags, bins);
with 0x4000 it is mode -1 (`HEAT`, not read). `0xa1b28`, all 255, draws a
sprite as a flat silhouette — the super hoover's blink.
