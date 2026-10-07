/**
 * How Jack collides with a block, and the probes his ladder states make.
 *
 * Every block carries a collision kind — word 0 of its `.COL` record, which
 * the game loads whole at VA 0x6028f and every probe of the tile map reads
 * for the object it finds (see `.COL` in scripts/formats/level.py):
 *
 *   0  nothing at all: scenery, the buildings Jack walks in front of and smashes
 *   1  solid — the only kind that stops him sideways (VA 0x6040a) or overhead
 *   2  a platform: a floor, and only from above (VA 0x607c1: feet over its top)
 *   4  a ladder: no collision, UP climbs it
 *   5  a ladder's top: a platform, and still a ladder
 *
 * Kinds 3 (a ceiling) and 6 (a platform) exist in the code; no level uses them.
 */
export const COL = {
  NONE: 0, SOLID: 1, PLATFORM: 2, LADDER: 4, LADDER_TOP: 5,
};

/** The ladder probe's box: half his width, and how far above his feet. */
export const LADDER_PROBE = { half: 4, up: 30 };

/**
 * Sets an Arcade static body up the way the game's probes treat its kind.
 * A platform is Phaser's one-way body: it stops what lands on its top and
 * nothing else.
 * @param {Phaser.Physics.Arcade.StaticBody} body
 * @param {number} kind
 */
export function applyCollisionKind(body, kind) {
  if (!body) return;
  const c = body.checkCollision;
  if (kind === COL.SOLID) return;
  const top = kind === COL.PLATFORM || kind === COL.LADDER_TOP;
  c.none = !top;
  c.up = top;
  c.down = false;
  c.left = false;
  c.right = false;
}

/**
 * The ladder probe, VA 0x60920 with the box at VA 0xa0264 (4, 30): the row
 * of cells 31 px above his feet, across his x ± 4. Every cell in it must be
 * ladder — one that is not, empty or anything else, and he is not at a
 * ladder. A top anywhere in it answers 5, plain ladder 4, otherwise 0.
 *
 * @param {(x: number, y: number) => ({col: number} | null)} blockAt
 *   the block whose cell holds this point, or null
 * @param {number} x  his centre
 * @param {number} feet  the y of his feet
 * @returns {0 | 4 | 5}
 */
export function ladderAt(blockAt, x, feet) {
  const y = feet - LADDER_PROBE.up - 1;
  let top = false;
  for (let cx = cell(x - LADDER_PROBE.half); cx <= cell(x + LADDER_PROBE.half); cx += 8) {
    const b = blockAt(cx, y);
    const kind = b ? b.col : COL.NONE;
    if (kind === COL.LADDER_TOP) top = true;
    else if (kind !== COL.LADDER) return 0;
  }
  return top ? COL.LADDER_TOP : COL.LADDER;
}

/**
 * A ladder's top under his feet: what stepping down onto the ladder needs
 * (VA 0x22a05 → 0x29b15 reads the block at x, feet + 1 and keeps its top).
 * @returns {number | null} the block's top, or null
 */
export function ladderTopUnder(blockAt, x, feet) {
  const b = blockAt(x, feet + 1);
  return b && b.col === COL.LADDER_TOP ? b.top : null;
}

/**
 * What stops him climbing down: VA 0x606eb over x ± 4 from just under his
 * feet to where he is going, of which the climb heeds a solid block and a
 * platform he is above (`& 6`) — a ladder's top he passes straight through.
 * @returns {number | null} the top he lands on, or null
 */
export function floorUnder(blockAt, x, from, to) {
  for (let cy = cell(from + 1); cy <= cell(to); cy += 8) {
    for (let cx = cell(x - LADDER_PROBE.half); cx <= cell(x + LADDER_PROBE.half); cx += 8) {
      const b = blockAt(cx, cy);
      if (!b) continue;
      if (b.col === COL.SOLID) return b.top;
      if (b.col === COL.PLATFORM && from < b.top) return b.top;
    }
  }
  return null;
}

function cell(v) {
  return Math.floor(v / 8) * 8;
}
