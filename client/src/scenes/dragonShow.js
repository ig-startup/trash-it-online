import { PROP_ANIMS, PROP_FRAME_INFO } from '../entities/props';
import { stopMusic } from '../audio/music';

/**
 * The dragon show — level 1D's red button (`sequence_start`, VA 0x204be)
 * — see docs/re/levels/dragon-show.md.
 *
 * `sequence_tick` (0x20409) runs `dragon_steps[step]` (table 0x9ff42)
 * every tick, then counts the timer down and moves to the next step when
 * it reaches 0; a step that sets no timer moves on itself. The camera is
 * two priority points: one at the bottom centre, and one the steps move —
 * the camera framing the box round both is what pans and zooms. The face
 * and the bolts are VM.SPR, drawn stretched by the entity's +0x50 / +0x52.
 *
 * The bottom row's rubble is flung into a column about Jack's x
 * (`rubble_mode`, docs/re/logic/destroyed-block.md): `pullX` is that x, noted
 * as the show starts (0x28b96a). Left out: CD track 10 (the clone has no CD
 * audio) and the bolt's +0x54 / +0x56 jitter, which nothing is known to read.
 *
 * In the game's own units, stepped at its 60 Hz.
 */
const START_TICKS = 0x50;
const CAM_LOW = { over: 0, ticks: 1640 };
const CAM_MOVING = { over: 400, ticks: 1630 };
const FACE = { grow: 400, closer: 500, life: 0xfa };
const BOLT = { w: 100, h: 500, life: 0xfa };
const DUST = { w: 50, h: 900, step: 2 };
const DEPTH = 900;   // over the level, under the HUD

export default class DragonShow {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}} at  the level's bottom centre
   * @param {object} hooks
   * @param {(x: number, y: number, ticks: number) => {x: number, y: number}} hooks.camPoint
   *   a priority camera point, which the show may move
   * @param {import('./tint').default} hooks.tint
   * @param {() => void} hooks.shake
   * @param {() => void} hooks.blast  damage_bottom_row: the level brought down from below
   * @param {() => number} [hooks.jackX]  where Jack stands as the show starts
   */
  constructor(scene, at, hooks) {
    this._scene = scene;
    this._at = at;
    this._h = hooks;
    this.step = 0;
    this.timer = 0;
    this._acc = 0;
    this._point = null;
    this._fall = 0;     // 0x28bf7e: written, never read
    this.pullX = at.x;
    this._shown = [];   // {sprite, life, tick?}
    this._steps = [
      () => {},
      () => this._face(),
      () => {},
      () => this._faceCloser(),
      () => {},
      () => this._lightning(),
      () => {},
      () => { this._point.x -= 1000; this.step += 1; },      // dragon_cam_left 0x200b4
      () => { this.timer = 0x172; this.step += 1; },         // dragon_pan_start 0x200c7
      () => this._panRise(),
      () => this._blast(),
      () => { this._point.y -= 7; this._fall -= 6; },        // dragon_rise_on 0x2022e
      () => this._paletteBack(),
      () => this._settle(),
      () => { this.step = 0; this.timer = 0; },              // dragon_end 0x202d1
      () => {},
    ];
  }

  /** sequence_start (0x204be): an 80-tick wait before the face. */
  start() {
    stopMusic();   // cd_play_track(10) stops the XMI, CD or no CD
    this.pullX = this._h.jackX ? this._h.jackX() : this._at.x;   // 0x28b96a
    this.step = 0;
    this.timer = START_TICKS;
    this._fall = 0;
  }

  get running() {
    return this.step !== 0 || this.timer !== 0;
  }

  update(delta) {
    for (this._acc += (delta * 60) / 1000; this._acc >= 1; this._acc -= 1) this._tick();
  }

  _tick() {
    this._steps[this.step]();
    if (this.timer !== 0) {
      this.timer -= 1;
      if (this.timer === 0) this.step += 1;
    }
    this._shown = this._shown.filter((s) => {
      if (s.tick) s.tick(s);
      s.life -= 1;
      if (s.life > 0) return true;
      s.sprite.destroy();
      return false;
    });
  }

  /**
   * A VM.SPR (or DUST.SPR) frame drawn stretched, as `draw_queue_entity`
   * (0x2d5e9) does: `w` and `h` more than the frame, its centre across and
   * its bottom kept.
   */
  _stretched(key, x, y, w, h) {
    const info = PROP_FRAME_INFO[key];
    const img = this._scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH);
    if (!info) return img.setPosition(x - w / 2, y - h).setDisplaySize(w, h);
    return img.setPosition(x - info.ax - w / 2, y - info.ay - h)
      .setDisplaySize(info.w + w, info.h + h);
  }

  _spawnFace(grow) {
    const { x, y } = this._at;
    const key = PROP_ANIMS.vm && PROP_ANIMS.vm[0];
    if (!key) return;
    this._shown.push({ sprite: this._stretched(key, x, y, grow, grow), life: FACE.life });
  }

  /** Step 1, dragon_face (0x1fef9): the camera points, the face, the palette dimmed. */
  _face() {
    this.timer = 400;
    this.step += 1;
    const { x, y } = this._at;
    this._h.camPoint(x, y - CAM_LOW.over, CAM_LOW.ticks);
    this._point = this._h.camPoint(x, y - CAM_MOVING.over, CAM_MOVING.ticks);
    this._spawnFace(FACE.grow);
    this._h.tint.to({ r: 100, g: 100, b: 100 });
  }

  /** Step 3, dragon_face_closer (0x2000c): the face bigger, the palette darker. */
  _faceCloser() {
    this._h.tint.to({ r: 0x46, g: 0x46, b: 0x46 });
    this.step += 1;
    this._spawnFace(FACE.closer);
    this.timer = 0x8c;
  }

  /**
   * Step 5, dragon_lightning (0x1fecf → spawn_vm 0x2030e): a bolt, which
   * `vm_flicker` (0x20370) steps through frames 1-4 every other tick,
   * mirroring it at random and flickering the palette 100…131.
   */
  _lightning() {
    this.timer = 0x11d;
    this.step += 1;
    const keys = PROP_ANIMS.vm;
    if (!keys || keys.length < 5) return;
    const { x, y } = this._at;
    let frame = 1;
    let n = 0;
    const entry = { sprite: this._stretched(keys[frame], x, y, BOLT.w, BOLT.h), life: BOLT.life };
    entry.tick = () => {
      n += 1;
      if (n & 1) return;
      frame = frame === 4 ? 1 : frame + 1;
      entry.sprite.destroy();
      entry.sprite = this._stretched(keys[frame], x, y, BOLT.w, BOLT.h).setFlipX(Math.random() < 0.5);
      const v = 100 + Math.floor(Math.random() * 32);
      this._h.tint.set({ r: v, g: v, b: v });
    };
    this._shown.push(entry);
  }

  /**
   * Step 9, dragon_pan_rise (0x200e4): the point 4 px right a tick, the red
   * pulsing; with 70 ticks left the screen turns red and the point goes back
   * to the bottom centre, then up 12 px a tick.
   */
  _panRise() {
    this._point.x += 4;
    const r = (this.timer & 0x3f) < 0x20 ? 0x96 : 100;
    this._h.tint.to({ r }, 2);
    if (this.timer === 0x46) {
      this._h.tint.to({ r: 0xdc, g: 0, b: 0 }, 2);
      this._point.x = this._at.x;
      this._point.y = this._at.y;
    }
    if (this.timer < 0x46) {
      this._point.y -= 12;
      this._fall -= 10;
    }
  }

  /**
   * Step 10, dragon_blast (0x20189): a flash, the shake, every block on the
   * bottom row struck from below, a column of dust from the bottom centre.
   */
  _blast() {
    this._point.x = this._at.x;
    this._h.tint.set({ r: 0x80, g: 0xff, b: 0xff });
    this._h.shake();
    this._h.blast();
    this._dustColumn();
    this.step += 1;
    this.timer = 0x37;
  }

  /** spawn_sized_effect (0x2053b): DUST.SPR, 50 × 900 more, from half its height up. */
  _dustColumn() {
    const keys = PROP_ANIMS.dust;
    if (!keys || !keys.length) return;
    const x = this._at.x;
    const y = this._at.y - (DUST.h >> 1);
    let i = 0;
    const entry = { sprite: this._stretched(keys[0], x, y, DUST.w, DUST.h), life: keys.length * DUST.step };
    entry.tick = () => {
      const f = Math.floor((i += 1) / DUST.step);
      if (f >= keys.length) return;
      entry.sprite.destroy();
      entry.sprite = this._stretched(keys[f], x, y, DUST.w, DUST.h);
    };
    this._shown.push(entry);
  }

  /** Step 12, dragon_palette_back (0x2024c): the palette back to the level's own. */
  _paletteBack() {
    this._h.tint.to({ r: 0x80, g: 0x80, b: 0x80 });
    this.timer = 0x118;
    this.step += 1;
  }

  /** Step 13, dragon_settle (0x20293): the point up 2 a tick while 0x28bf7e climbs back. */
  _settle() {
    if (this._fall < 0) {
      this._fall += 2;
      this._point.y -= 2;
    }
    if (this.timer === 1) this._fall = 0;
  }

  destroy() {
    this._shown.forEach((s) => s.sprite.destroy());
    this._shown = [];
  }
}
