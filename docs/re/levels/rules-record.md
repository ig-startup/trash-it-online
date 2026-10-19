# The level's rules record — **Confirmed**

Class 16 is in 146 of the 147 levels and has the largest payload of any
class, 72 bytes. Its constructor (VA 0x1ae49) does one thing: it is a
bank of switches. Each word either sets a bit in the global option byte
at VA 0x98224 or is copied into a global of its own. This is what makes
one level play differently from another, and `scripts/formats/ob.py`
lists every field with how the 146 levels spread across its values.

Two worth calling out. The word at +0x2a is a four-way selector that
122 levels leave at 1, 14 set to 4 and 10 to 8. And +0x38 is a score:
its value is added in fives through a packed-BCD adder (VA 0x19b9d),
the arcade way of ticking a total up on screen — 40 levels leave it at
zero and the rest sit between 200 and 630.

Traced so far: stream +0x26 picks what option 0x1000 (a button) sets
off — 2 the 1D sequence, 4 the demolition of the whole level (2T 4T BA);
+0x22 bit 1 would demolish at load (no level). Option bits 0x100, 0x200,
0x400 reveal the hidden buttons, 0x800 frees the subtype-2 bell, 0x2000
marks 0x1000 handled, 0x40 the level demolished. See
[the buttons](../objects/buttons.md). The rest of the bits are the
field list's map.
