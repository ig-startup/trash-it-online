# The bell is locked to a block — **Confirmed**

The bell does not sit at a free-floating coordinate and it is not won by
touching it. Its constructor (VA 0x33ef2) looks up the object at
`(bell.x, bell.y - 2)` through the tile map and stores it in `+0x58`;
failing that it logs `*** Bell has no block to lock to?? ***`.

Its per-frame routine (VA 0x33f58) then does nothing at all while bit 0
of the locked block's first word is set. When that block dies the bit
clears and the bell frees: it takes a new behaviour, and moves to the
block's centre and underside —
`x = block.x + block.width/2`, `y = block.y + block.height`.

So the bell is released by demolition, not reached by walking. The
timmies work the same way (`*** timmy has no block to lock to?? ***`).
