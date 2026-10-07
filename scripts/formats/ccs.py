"""
Trash It (1997 DOS) — the structural simulation. **Decoded.**

The game's own name for it is in one of its debug strings: *"looked for
ccs off end of list"*. A `ccs` is a connected group of blocks that has
come loose and is falling as one piece — the thing the whole game is
about, and the one mechanic these notes previously got wrong. The old
reading was "a blow stops at the block it lands on, buildings do not
collapse". They do. The support counts the damage routine divides by are
not fields the level files fill; they are **recomputed by the engine
every few frames**, and the loader not writing them proves nothing.

Everything below is from `G.EXE`. Three globals matter:

    0x40f330   the collision map: one u16 per 8x8 cell holding the id of
               the object occupying it, 0 for empty. Row stride is the
               level's tile width (`0x41048a`); the row table at
               0x3f5928 is just `row[i] = i * stride` (VA 0x69eb3).
    0x40f334   a second copy of the map, into which a falling group is
               stamped provisionally each frame (VA 0x69386) and
               unstamped at the start of the next (VA 0x694ad).
    0x410474   the dirty flag: set by any hit, destruction or landing.

The pass, in frame order (the whole thing is one call in the frame
function at VA 0x2cbb9):

    every frame      VA 0x68b2d   move the falling groups, land them
    every 5th frame  VA 0x69f04   rebuild, and only if something changed
      VA 0x69b88 + 0x69c07         flood up from the bottom row: mark
                                   everything the ground holds up, and
                                   count each object's neighbours
      VA 0x69b27                   reset the flags
      VA 0x69660 + 0x698c2         whatever the flood did not reach is
                                   loose: flood it into groups

Support counts (VA 0x69c07), per object, refreshed by that flood:

    +0x5c  how many objects touch it from above
    +0x5e  how many objects touch it from below — its supports

which is exactly what the two damage routines divide the force by:

    damage_down(object, force):                 # VA 0x689e6
        if object.hp == -1: return              # indestructible
        if object.supports_below and force / object.supports_below > 2:
            for each occupied cell in the row under it:
                damage_down(that object, force / object.supports_below)
        if force < object.hp: object.hp -= force
        else:                 destroy(object)

    damage_up  (VA 0x68a91) is the mirror image: the row above, and
    +0x5c. So a blow from below pushes up through a structure too.

**A blow therefore travels.** It is divided among the supports at each
step and stops when a support's share drops to 2 or less, so a wide base
soaks up a hit that a single pillar passes straight down.

Falling, once a group exists (VA 0x690d6):

    vy += 10000  (0.15 px/frame², *not* Jack's 0.28125), capped at
    4 px/frame; the members ride along at fixed offsets from the group.

Landing (VA 0x68b2d, and this is where the numbers come from):

    speed  = (vy >> 16) + 1                      # 1..5 whole pixels
    weight = sum of the masses of the object hit and everything stacked
             on top of it, flooded upward (VA 0x69850)
    force  = weight * speed / 4

applied *both* ways — down into what was hit and up into the block that
hit it — so a collapse damages itself. The group's y is snapped to the
8px grid and its vy halved rather than zeroed, which is the bounce.

Mass is `.OBT` field 6, forced to 1 when the table stores 0 (VA
0x2d028). That field had been written down as "meaning not pinned down";
this is the reader that settles it.

Engine limits, worth knowing before designing anything on top: at most
**50 groups** at once (VA 0x69660; on the 50th it sets a "no more" flag
and waits for one to be freed) and **40 members per group** before it
chains a continuation record (VA 0x69906).

What this file does: builds the collision map from the level files and
runs the same three floods, so the reading above can be checked against
all 147 shipped levels rather than argued about.

    python3 scripts/formats/ccs.py            # all 147 levels
    python3 scripts/formats/ccs.py 0A --hit 12 4000
"""
import os
import struct
import sys

INDESTRUCTIBLE = (0xffff, 0xfffe)


def load(levels_dir, name):
    """
    -> dict(tiles_w, tiles_h, objects) — the level's blocks, in tiles.

    A light reader: unlike `level.load` this does not touch the shapes,
    because the structural simulation only ever looks at the collision
    map and the object table.
    """
    def read(ext):
        with open(os.path.join(levels_dir, name + ext), 'rb') as fh:
            return fh.read()

    wam, obt = read('.WAM'), read('.OBT')
    tw, th, count, _ = struct.unpack_from('<4H', wam, 0)
    objects = []
    for i in range(1, count + 1):
        otype, x, y, _ = struct.unpack_from('<4H', wam, i * 8)
        hp, ow, oh, mass = struct.unpack_from('<4H', obt, otype * 8)
        objects.append(dict(
            id=i, type=otype,
            tx=x >> 3, ty=y >> 3, tw=ow, th=oh,
            hp=None if hp in INDESTRUCTIBLE else hp,
            mass=mass or 1,                       # VA 0x2d028
        ))
    return dict(tiles_w=tw, tiles_h=th, objects=objects)


class Map:
    """The collision map: cell -> object id, 0 for empty (VA 0x40f330)."""

    def __init__(self, level):
        self.w, self.h = level['tiles_w'], level['tiles_h']
        self.cells = [0] * (self.w * self.h)
        self.objects = {o['id']: o for o in level['objects']}
        self.overwritten = 0
        for o in level['objects']:
            for dy in range(o['th']):
                for dx in range(o['tw']):
                    x, y = o['tx'] + dx, o['ty'] + dy
                    if not (0 <= x < self.w and 0 <= y < self.h):
                        continue
                    i = y * self.w + x
                    if self.cells[i]:
                        self.overwritten += 1   # the game says so too,
                        continue                # VA 0x69de9
                    self.cells[i] = o['id']

    def at(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.cells[y * self.w + x]
        return 0

    def row_below(self, o):
        """Ids under an object, one per column it covers."""
        return [self.at(o['tx'] + dx, o['ty'] + o['th'])
                for dx in range(o['tw'])]

    def row_above(self, o):
        return [self.at(o['tx'] + dx, o['ty'] - 1) for dx in range(o['tw'])]


def support(cmap):
    """
    The grounded flood — VA 0x69b88 (the bottom row) + VA 0x69c07.

    -> dict(id -> (touching_above, touching_below)) for every object the
    ground holds up, transitively. Anything missing from it is loose.
    """
    counts = {}
    stack = [cmap.at(x, cmap.h - 1) for x in range(cmap.w)]
    while stack:
        oid = stack.pop()
        if not oid or oid in counts:
            continue
        o = cmap.objects[oid]
        above = cmap.row_above(o)
        counts[oid] = (sum(1 for n in above if n),
                       sum(1 for n in cmap.row_below(o) if n))
        stack.extend(n for n in above if n and n not in counts)
    return counts


def groups(cmap, grounded):
    """
    The loose flood — VA 0x69660 + VA 0x698c2.

    Whatever the ground does not hold up is a `ccs`: a connected group,
    through contacts in both directions, that falls as one piece.
    -> list of sorted id lists.
    """
    seen, out = set(), []
    for o in cmap.objects.values():
        if o['id'] in grounded or o['id'] in seen:
            continue
        member, stack = [], [o['id']]
        while stack:
            oid = stack.pop()
            if oid in seen:
                continue
            seen.add(oid)
            member.append(oid)
            cur = cmap.objects[oid]
            for n in cmap.row_below(cur) + cmap.row_above(cur):
                if n and n not in seen:
                    stack.append(n)
        out.append(sorted(member))
    return out


def weight_on(cmap, oid):
    """
    Mass of an object plus everything stacked above it — VA 0x69850.

    The impact force of a landing group is this times its speed, over 4.
    """
    seen, total, stack = set(), 0, [oid]
    while stack:
        cur = stack.pop()
        if not cur or cur in seen:
            continue
        seen.add(cur)
        o = cmap.objects[cur]
        total += o['mass']
        stack.extend(n for n in cmap.row_above(o) if n and n not in seen)
    return total


def blow(cmap, counts, oid, force, limit=400):
    """
    Follow a blow of `force` into the structure — VA 0x689e6.

    -> (events, hp) where events is (id, depth, force, what) in the order
    the game visits them and hp is the surviving hit points. Note that
    the game walks the *cells* under an object, not the objects: a wide
    block beneath a narrow one is hit once per cell it shares with the
    row, and the same block can be struck several times by one blow. The
    divisor is a cell count for the same reason. Nothing here dedupes,
    because the original does not.

    `limit` only bounds the report; a single blow into a deep structure
    genuinely does fan out into thousands of visits.
    """
    hp = {o['id']: o['hp'] for o in cmap.objects.values()}
    events, work = [], [(oid, force, 0)]
    while work and len(events) < limit:
        cur, f, depth = work.pop()
        o = cmap.objects.get(cur)
        if o is None or hp[cur] is None:          # indestructible
            continue
        if hp[cur] <= 0:                          # already gone
            continue
        below = counts.get(cur, (0, 0))[1]
        if below and f // below > 2:
            share = f // below
            for n in cmap.row_below(o):
                if n:
                    work.append((n, share, depth + 1))
        if f < hp[cur]:
            hp[cur] -= f
            events.append((cur, depth, f, f'damaged, {hp[cur]} left'))
        else:
            hp[cur] = 0
            events.append((cur, depth, f, 'DESTROYED'))
    return events, hp


def _levels(levels_dir):
    names = set()
    for fn in os.listdir(levels_dir):
        stem, dot, ext = fn.rpartition('.')
        if ext.upper() == 'WAM':
            names.add(stem)
    return sorted(names)


def _main():
    repo = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    levels_dir = os.path.join(repo, 'Trash-it-original', 'LEVELS')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]

    if '--hit' in sys.argv:
        at = sys.argv.index('--hit')
        name, oid, force = args[0], int(sys.argv[at + 1]), int(sys.argv[at + 2])
        lvl = load(levels_dir, name)
        cmap = Map(lvl)
        counts = support(cmap)
        events, hp = blow(cmap, counts, oid, force)
        print(f'{name}: a blow of {force} on object {oid}\n')
        for i, depth, f, what in events[:60]:
            o = cmap.objects[i]
            print(f'{"  " * min(depth, 12)}object {i:<4} type {o["type"]:<4} '
                  f'hp {o["hp"]:<6} mass {o["mass"]:<6} force {f:<7} -> {what}')
        if len(events) > 60:
            print(f'  ... {len(events) - 60} more visits')
        gone = [i for i, v in hp.items() if v == 0]
        print(f'\n{len(events)} visits, deepest {max(d for _, d, _, _ in events)} '
              f'levels down, {len(gone)} object(s) destroyed'
              + (f': {gone}' if 0 < len(gone) <= 12 else ''))
        return

    names = args or _levels(levels_dir)
    totals = dict(objects=0, loose=0, groups=0, overwritten=0)
    worst = []
    print(f'{"level":<6}{"objects":>8}{"loose":>7}{"groups":>7}'
          f'{"biggest":>9}{"overlap":>9}   supports (min/median/max)')
    for name in names:
        lvl = load(levels_dir, name)
        cmap = Map(lvl)
        counts = support(cmap)
        gs = groups(cmap, counts)
        loose = sum(len(g) for g in gs)
        below = sorted(b for _, b in counts.values())
        med = below[len(below) // 2] if below else 0
        totals['objects'] += len(lvl['objects'])
        totals['loose'] += loose
        totals['groups'] += len(gs)
        totals['overwritten'] += cmap.overwritten
        if gs:
            worst.append((max(len(g) for g in gs), len(gs), name))
        print(f'{name:<6}{len(lvl["objects"]):>8}{loose:>7}{len(gs):>7}'
              f'{max((len(g) for g in gs), default=0):>9}'
              f'{cmap.overwritten:>9}   '
              f'{below[0] if below else 0}/{med}/{below[-1] if below else 0}')

    print(f'\n{len(names)} levels, {totals["objects"]} objects')
    print(f'  loose at load: {totals["loose"]} in {totals["groups"]} groups')
    print(f'  cells claimed twice: {totals["overwritten"]}')
    if worst:
        worst.sort(reverse=True)
        print(f'  biggest group: {worst[0][0]} members, in {worst[0][2]}'
              f'   (engine caps a group at 40, and the level at 50 groups)')


if __name__ == '__main__':
    _main()
