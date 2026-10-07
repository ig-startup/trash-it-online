/**
 * Structures that lose their support fall — the game's own mechanic, read
 * off `G.EXE` and checked against every shipped level by
 * scripts/formats/ccs.py ("How a structure collapses" in its README).
 *
 * - At most every fifth tick, and only after something changed (the dirty
 *   flag 0x410474: a hit, a destruction, a landing), the engine floods up
 *   from the bottom row of the collision map through what rests on what
 *   (VA 0x69b88 → 0x69c07). Whatever that does not reach is loose, and a
 *   second flood (0x69660 → 0x698c2) gathers the loose blocks into groups
 *   through their contacts above and below.
 * - A group falls as one rigid piece (0x690d6): vy += 10000 a tick,
 *   capped at 4 px, its members riding along — out of the live map while
 *   they move.
 * - When it lands (0x68b2d) the force is the weight of what it hit and
 *   everything stacked on that, times its speed in whole pixels plus one,
 *   over four — applied down into what was hit and up into what hit it,
 *   so a collapse breaks itself. Its y snaps to the 8 px grid.
 *
 * Units are the game's: px and px/tick at 60 Hz.
 */
const HZ = 60;
const FX = 65536;
const GRAVITY = 10000 / FX;   // px/tick², VA 0x690d6
const TERMINAL = 4;           // px/tick
const REBUILD_EVERY = 5;      // ticks (VA 0x69f04)
const MAX_GROUPS = 50;        // the engine's own limit (VA 0x69660)

export default class Collapse {
  /**
   * @param {object} scene the GameScene, for its block table and map
   * @param {number} rows the collision map's height in cells
   */
  constructor(scene, rows) {
    this._s = scene;
    this._rows = rows;
    this._groups = [];
    this._dirty = true;          // the game floods once a level is up
    this._ticks = 0;
    this._acc = 0;
    /** @type {Set<number>} ids that are falling right now */
    this.falling = new Set();
  }

  /** Something changed: re-flood at the next fifth tick. */
  touch() {
    this._dirty = true;
  }

  /** Falling groups, for whatever needs to know where they are. */
  get groups() {
    return this._groups;
  }

  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._ticks += 1;
      this._step();
      if (this._dirty && this._ticks % REBUILD_EVERY === 0) this._rebuild();
    }
  }

  // ── The floods ────────────────────────────────────────────────────────

  _owner(tx, ty) {
    return this._s._cellOwner.get(ty * this._s._gridW + tx);
  }

  _row(entry, ty) {
    const out = [];
    for (let dx = 0; dx < entry.tw; dx += 1) {
      const id = this._owner(entry.tx + dx, ty);
      if (id !== undefined && id !== entry.id) out.push(id);
    }
    return out;
  }

  _rebuild() {
    this._dirty = false;
    const map = this._s._destructibleMap;

    // Up from the bottom row, through what rests on what.
    const grounded = new Set();
    const stack = [];
    const bottom = this._rows - 1;
    for (let tx = 0; tx < this._s._gridW; tx += 1) {
      const id = this._owner(tx, bottom);
      if (id !== undefined) stack.push(id);
    }
    while (stack.length) {
      const id = stack.pop();
      if (grounded.has(id)) continue;
      const e = map.get(id);
      if (!e || !e.rect.active || this.falling.has(id)) continue;
      grounded.add(id);
      this._row(e, e.ty - 1).forEach((n) => { if (!grounded.has(n)) stack.push(n); });
    }

    // What is left is loose; gather it into groups through its contacts.
    const seen = new Set();
    for (const e of map.values()) {
      if (this._groups.length >= MAX_GROUPS) break;
      if (!e.rect.active || grounded.has(e.id) || seen.has(e.id) || this.falling.has(e.id)) continue;
      const members = [];
      const todo = [e.id];
      while (todo.length) {
        const id = todo.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const m = map.get(id);
        if (!m || !m.rect.active || this.falling.has(id)) continue;
        members.push(m);
        [...this._row(m, m.ty + m.th), ...this._row(m, m.ty - 1)]
          .forEach((n) => { if (!seen.has(n) && !grounded.has(n)) todo.push(n); });
      }
      if (members.length) this._loosen(members);
    }
  }

  /** A group comes loose: out of the live map, and falling. */
  _loosen(members) {
    members.forEach((m) => {
      this._s._unstampCells(m);
      this.falling.add(m.id);
      m.y0 = m.ty * this._s._tile;
      // Out of the live map, out of the way: sprites only meet a falling
      // group through the map it is stamped into (VA 0x60a00).
      if (m.rect.body) m.rect.body.enable = false;
    });
    this._groups.push({ members, dy: 0, vy: 0 });
  }

  // ── The fall ──────────────────────────────────────────────────────────

  _step() {
    const tile = this._s._tile;
    for (let i = this._groups.length - 1; i >= 0; i -= 1) {
      const g = this._groups[i];
      g.members = g.members.filter((m) => m.rect.active);
      if (!g.members.length) { this._groups.splice(i, 1); continue; }

      g.vy = Math.min(TERMINAL, g.vy + GRAVITY);
      const next = g.dy + g.vy;

      // The first row of cells any member would move into, and what is there.
      let hit = null;
      let hitter = null;
      let landAt = null;
      let fellOut = false;
      g.members.forEach((m) => {
        const fromRow = Math.floor((m.y0 + g.dy) / tile) + m.th;
        const toRow = Math.floor((m.y0 + next) / tile) + m.th;
        for (let row = fromRow; row <= toRow; row += 1) {
          if (row >= this._rows) { fellOut = fellOut || landAt === null; break; }
          const under = this._row(m, row).find((id) => !this.falling.has(id));
          if (under !== undefined) {
            const snapped = (row - m.th) * tile - m.y0;
            if (landAt === null || snapped < landAt) {
              landAt = snapped;
              hit = under;
              hitter = m;
            }
            break;
          }
        }
      });

      if (landAt !== null) {
        this._land(g, landAt, hit, hitter);
        this._groups.splice(i, 1);
      } else if (fellOut && (g.members[0].y0 + next) / tile > this._rows + 4) {
        g.members.forEach((m) => { this.falling.delete(m.id); this._s._forgetBlock(m); });
        this._groups.splice(i, 1);
      } else {
        g.dy = next;
        this._place(g);
      }
    }
  }

  _place(g) {
    const tile = this._s._tile;
    g.members.forEach((m) => {
      const top = m.y0 + g.dy;
      m.rect.setPosition(m.rect.x, top + m.height / 2);
      if (m.rect.body && m.rect.body.updateFromGameObject) m.rect.body.updateFromGameObject();
      m.ty = Math.round(top / tile);
    });
  }

  /**
   * Down onto the grid, back into the map, and the impact: weight of what
   * was hit and all on top of it × (speed + 1) / 4, both ways (0x68b2d).
   */
  _land(g, dy, hitId, hitter) {
    const speed = Math.floor(g.vy) + 1;
    g.dy = dy;
    this._place(g);
    g.members.forEach((m) => {
      this.falling.delete(m.id);
      this._s._stampCells(m);
      if (m.rect.body) {
        m.rect.body.enable = true;
        if (m.rect.body.updateFromGameObject) m.rect.body.updateFromGameObject();
      }
    });
    this._dirty = true;

    const map = this._s._destructibleMap;
    const hit = map.get(hitId);
    if (!hit) return;
    const force = Math.floor((this._weightOn(hit) * speed) / 4);
    this._s._landed(hit, hitter, force);
  }

  /**
   * The falling block over a span — what Jack's check finds (VA 0x60a00):
   * one that covers his width and whose underside is inside his height.
   * @returns {{id: any, bottom: number, vy: number} | null}
   */
  over(left, right, top, feet) {
    for (const g of this._groups) {
      for (const m of g.members) {
        if (!m.rect.active) continue;
        const b = m.rect.getBounds();
        if (b.right <= left || b.left >= right) continue;
        if (b.bottom > top && b.bottom <= feet) return { id: m.id, bottom: b.bottom, vy: g.vy };
      }
    }
    return null;
  }

  /** Mass of a block and everything stacked above it (VA 0x69850). */
  _weightOn(entry) {
    const map = this._s._destructibleMap;
    const seen = new Set();
    const stack = [entry.id];
    let total = 0;
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const e = map.get(id);
      if (!e || !e.rect.active) continue;
      total += e.mass || 1;
      this._row(e, e.ty - 1).forEach((n) => { if (!seen.has(n)) stack.push(n); });
    }
    return total;
  }
}
