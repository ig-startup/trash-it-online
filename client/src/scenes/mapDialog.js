/**
 * The world map's dialog (F.EXE 0x1eaf4, template 0x8a13a — see
 * docs/re/front/map-dialog.md): LSSHOP's metal sign drops from the top of
 * the screen, its words come up in YELMEDFT, and a yes/no is asked.
 *
 * - 'play' (mode 3): "timmy points available: N", "play level?";
 * - 'replay' (mode 0): a won level bought back — "buy your way in for
 *   N timmies", and the continue it gave;
 * - 'gate' (mode 1/2): "timmy toll gate", what it costs and what is in
 *   hand, then "open gate?" or "try again!".
 *
 * Everything is in screen pixels (320 x 200), an object at the original's
 * (x + 160, y + 128) plus its frame's origin; the scene puts the objects
 * where its screen is drawn (`origin`) and keeps them on that camera.
 */
import { writeYel } from './yelFont';

/** The sign: LSSHOP frame 1 at (-154, -384), 16 px a tick down, slowed by 0x84d0. */
const SIGN = { frame: 1, x: -154 + 160, y: -384 + 128, vy: 16, ay: -0x84d0 / 0x10000 };
/** Going: 6 px a tick down, then 3 a tick per tick up, gone at -80 (0x1f1c6, 0x1f362). */
const AWAY = { vy: 6, ay: -3, gone: -80 };
/** The pointer: YELMEDFT 43 (yes) or 42 (no), swaying 0 1 2 1 every 4 ticks (0x1e9da). */
const YES_FRAME = 43;
const NO_FRAME = 42;
const SWAY = [0, 1, 2, 1];

export default class MapDialog {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {number} opts.originX where the screen's x 0 is in the scene
   * @param {string} opts.signKey LSSHOP's texture; `signFrames` its frames
   * @param {object} opts.yel YELMEDFT: {key, frames, font}
   * @param {object} opts.words worlds.json `dialog`
   * @param {(o: Phaser.GameObjects.GameObject) => void} opts.pin keeps an object on the screen's camera
   * @param {object} ask what Story.fire asked
   */
  constructor(scene, opts, ask) {
    this.scene = scene;
    this.o = opts;
    this.ask = ask;
    const [, , , , ox, oy] = opts.signFrames[SIGN.frame];
    this._signOrigin = [ox, oy];
    this.sign = scene.add.image(0, 0, opts.signKey, String(SIGN.frame)).setOrigin(0, 0).setDepth(100);
    opts.pin(this.sign);
    this.y = SIGN.y;
    this.vy = SIGN.vy;
    this.ay = SIGN.ay;
    this.phase = 'in';
    this.texts = [];
    this.pointer = null;
    this.choice = null;
    this.ticks = 0;
    this._place();
  }

  _place() {
    const [ox, oy] = this._signOrigin;
    this.sign.setPosition(this.o.originX + SIGN.x + ox, Math.floor(this.y) + oy);
  }

  /** A line of words at the original's y, centred on x 0. */
  _say(text, y) {
    const { images, tilde } = writeYel(this.scene, this.o.yel, text, this.o.originX + 160, y + 128);
    images.forEach((i) => { i.setDepth(101); this.o.pin(i); });
    this.texts.push(...images);
    return tilde;
  }

  _count(n) {
    const w = this.o.words;
    return `${n} ${n === 1 ? w.timmy : w.timmies}`;
  }

  /** The words, once the sign has stopped (0x1eba2 …). */
  _write() {
    const w = this.o.words;
    const a = this.ask;
    let tilde = null;
    if (a.kind === 'replay') {
      this._say(`${w.available}${a.points}`, -72);
      this._say(w.buyYourWay, -29);
      this._say(w.inFor, -13);
      this._say(this._count(a.cost), 3);
      this._say(a.continues ? w.oneContinue : w.noContinues, 19);
      tilde = this._say(w.yesNo, 41);
    } else if (a.kind === 'gate') {
      this._say(w.tollGate, -64);
      this._say(w.youNeed, -40);
      this._say(this._count(a.price), -24);
      this._say(w.youHave, -8);
      this._say(this._count(a.have), 8);
      if (a.price <= a.have) {
        this._say(w.openGate, 32);
        tilde = this._say(w.yesNo, 48);
      } else {
        // its '~' stands twelve lines down, off the sign: any button goes
        this._say(w.tryAgain, 32);
        this.okOnly = true;
      }
    } else {
      this._say(`${w.available}${a.points}`, -56);
      this._say(w.playLevel, 0);
      tilde = this._say(w.yesNo, 24);
    }
    if (tilde) {
      this._tilde = tilde;
      const [, , , , ox, oy] = this.o.yel.frames[YES_FRAME];
      this.pointer = this.scene.add.image(tilde.x + ox, tilde.y + oy, this.o.yel.key, String(YES_FRAME))
        .setOrigin(0, 0).setDepth(101).setVisible(false);
      this.o.pin(this.pointer);
    }
  }

  /**
   * One tick. @param {{left: boolean, right: boolean, fire: boolean}} keys
   * @returns {null|'yes'|'no'|'done'} 'yes' or 'no' when answered, 'done'
   *   once the sign is gone
   */
  tick(keys) {
    this.ticks += 1;
    if (this.phase === 'in') {
      if (this.vy <= 0) {
        this.vy = 0;
        this.phase = 'ask';
        this._write();
      } else {
        this.y += this.vy;
        this.vy += this.ay;
      }
      this._place();
      return null;
    }
    if (this.phase === 'ask') {
      // left yes, right no; fire answers — yes unless no was picked
      if (keys.left) this.choice = 'yes';
      if (keys.right) this.choice = 'no';
      if (this.pointer && this.choice) {
        const f = this.choice === 'yes' ? YES_FRAME : NO_FRAME;
        const [, , , , ox, oy] = this.o.yel.frames[f];
        const sway = SWAY[(this.ticks >> 2) & 3] * (this.choice === 'yes' ? -1 : 1);
        this.pointer.setFrame(String(f)).setPosition(this._tilde.x + ox + sway, this._tilde.y + oy).setVisible(true);
      }
      if (!keys.fire) return null;
      const answer = this.okOnly ? 'no' : (this.choice === 'no' ? 'no' : 'yes');
      this.leave();
      return answer;
    }
    // going: up and off the top
    this.y += this.vy;
    this.vy += this.ay;
    this._place();
    if (this.vy < AWAY.gone) {
      this.sign.destroy();
      return 'done';
    }
    return null;
  }

  /** The words go, the sign flies off (0x1f1c6). */
  leave() {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    if (this.pointer) this.pointer.destroy();
    this.pointer = null;
    this.phase = 'away';
    this.vy = AWAY.vy;
    this.ay = AWAY.ay;
  }

  destroy() {
    this.leave();
    this.sign.destroy();
  }
}
