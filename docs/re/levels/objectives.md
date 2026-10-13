# Objectives — **Confirmed** (from `F.EXE`)

`F.EXE` is the front end, not the editor, and it carries mission text in
five languages — one line for each of the fifteen arcade levels, 0K to
EK (table at VA 0x8d5c4, picked by the arcade row, VA 0x1a163; see
"The front end" below):

- `trash NN% to free the bell` — 0K 28, 1K 61, 2K 58, 3K 61, 4K 34,
  AK 90, DK 48, EK 85
- `get to the bell` — 5K, 9K, BK, CK
- `ring the bell` — 6K; `hit the bell` — 7K
- `collect the timmies` — 8K, the one level with a timmy bin

Each line is the level's bell, said in words. Every "trash NN%" level
has a subtype-8 bell with NN at payload +18; every "get/ring/hit" level
a subtype-1 bell; 8K a subtype-2 bell. The percentage **is** enforced:
a subtype-8 bell stays hidden until `destroyed_percent` reaches it (see
"The bell" and "The percentage check" below). Story levels carry no
mission line, but 29 of them have subtype-8 bells all the same — every
level of worlds A and M and seven of T's eight, at 70 to 100% — and so
do 1D and 3D.
