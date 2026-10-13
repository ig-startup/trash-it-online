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

What the individual option bits *do* is not traced yet. The field list
is the map for doing it.
