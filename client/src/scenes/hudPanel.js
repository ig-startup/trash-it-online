import { PROP_ANIMS } from '../entities/props';
import scripts from './hudScripts.json';

/**
 * The in-level panel's sprites and the little scripts that move them — see
 * docs/re/front/hud.md. A list is walked by `panel_script_run` (0x196db):
 * each sprite entry becomes a record (`panel_icon_alloc` 0x197e8) at the
 * entry's x and its y less 18, the frame at its own size plus an `extra`
 * width and height. Every tick `hud_objects_tick` (0x19ad0) draws each
 * record, then steps its script (`hud_script_step` 0x1a1fb): a wait counts
 * down, otherwise ops run until one waits or ends the script. The motion
 * ops move it afterwards: `drift_x` / `drift_y` add to x / y every tick.
 *
 * Played here: the ops the countdown uses — at, size, drift, wait, frame,
 * shake, go, sound, stop. The edge-easing ops (1-4, 6-9) belong to the
 * arcade target's list and are not run.
 *
 * Positions are in the level's 320-wide view, 1:1 with the original's
 * pixels; `zoom` scales them to the screen.
 */
const HZ = 60;
const FX = 65536;
const Y_OFFSET = 18;      // panel_icon_alloc: the entry's y less 0x12
const DEPTH = 1500;

/** The exported sheet frames, by PANEL.SPR frame number. */
const PANEL_FRAMES = { countdown: [47, 48, 49, 50] };

export default class HudPanel {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} list  a list of hudScripts.json
   * @param {object} hooks
   * @param {(img: Phaser.GameObjects.Image) => Phaser.GameObjects.Image} hooks.adopt
   *   puts an image on the HUD camera
   * @param {number} hooks.zoom  screen px per view px
   * @param {() => void} hooks.go  op 17: the players are let go
   * @param {(ticks: number) => void} hooks.shake  op 15
   * @param {(id: number) => void} hooks.sound  op 18
   * @param {() => void} [hooks.done]  every record has finished
   */
  constructor(scene, list, hooks) {
    this._h = hooks;
    this._acc = 0;
    this._frames = PANEL_FRAMES[list];
    this._records = scripts[list].map((e) => ({
      x: e.x * FX,
      y: (e.y - Y_OFFSET) * FX,
      w: 0,
      h: 0,
      dx: 0,
      dy: 0,
      frame: e.frame,
      ops: e.script,
      pc: 0,
      wait: 0,
      alive: true,
      img: hooks.adopt(scene.add.image(0, 0, PROP_ANIMS[list][this._index(e.frame)])
        .setOrigin(0, 0).setDepth(DEPTH).setVisible(false)),
    }));
    this._list = list;
  }

  /** True while any record is still alive. */
  get running() {
    return this._records.some((r) => r.alive);
  }

  _index(frame) {
    return Math.max(0, this._frames.indexOf(frame));
  }

  /** @param {number} delta ms */
  update(delta) {
    this._acc = Math.min(this._acc + delta, 100);
    const tick = 1000 / HZ;
    while (this._acc >= tick) {
      this._acc -= tick;
      this._records.forEach((r) => { if (r.alive) this._tick(r); });
      if (!this.running && this._h.done) {
        const done = this._h.done;
        this._h.done = null;
        done();
      }
    }
  }

  /** One tick of a record: drawn as it stands, then its script, then its drift. */
  _tick(r) {
    this._draw(r);
    this._step(r);
    r.x += r.dx;
    r.y += r.dy;
  }

  _draw(r) {
    const img = r.img;
    img.setTexture(PROP_ANIMS[this._list][this._index(r.frame)]);
    const z = this._h.zoom;
    const w = img.frame.realWidth + r.w;
    const h = img.frame.realHeight + r.h;
    if (w < 1 || h < 1) {
      img.setVisible(false);
      return;
    }
    img.setVisible(true);
    img.setPosition(Math.floor(r.x / FX) * z, Math.floor(r.y / FX) * z);
    img.setDisplaySize(w * z, h * z);
  }

  /** hud_script_step: ops until one waits or ends. */
  _step(r) {
    if (r.ended) return;
    if (r.wait > 0) {
      r.wait -= 1;
      return;
    }
    for (;;) {
      const [op, a, b] = r.ops[r.pc];
      r.pc += 1;
      switch (op) {
        case 'wait': r.wait = a; return;
        case 'at': r.x = a * FX; r.y = b * FX; break;
        case 'size': r.w = a; r.h = b; break;
        case 'drift_x': r.dx = a; break;
        case 'drift_y': r.dy = a; break;
        case 'stop': this._free(r); break;       // clears the record's live bit
        case 'frame': r.frame = a; break;
        case 'shake': this._h.shake(a); break;
        case 'go': this._h.go(); break;
        case 'sound': this._h.sound(a); break;
        case 'end': r.ended = true; return;      // the script's live bit off
        default: break;                          // the easing ops: not played
      }
      if (!r.alive) return;
    }
  }

  _free(r) {
    r.alive = false;
    r.img.destroy();
  }

  destroy() {
    this._records.forEach((r) => { if (r.alive) this._free(r); });
  }
}
