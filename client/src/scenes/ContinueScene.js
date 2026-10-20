/**
 * "Continue?" — what a lost story level asks before the map comes back
 * (F.EXE continue_screen 0x1590e, see docs/re/front/continue.md). Five
 * glass tubes with a Jack in each are the lives; YES and NO rise from the
 * bottom, CONTINUE? drops from the top; left picks yes, right no, fire
 * answers. A yes costs a life and goes back to the map; a no ends the game.
 *
 * Everything is placed in the picture's own pixels (320 x 200, its top
 * left at the original's (-160, -128)) and moved a tick at a time, 60 a
 * second, with the original's 16.16 speeds as fractions.
 */
import Phaser from 'phaser';
import { loadKeySets, LocalKeys, SOLO_EXTRA } from '../input/keySets';

const PIC_W = 320;
const PIC_H = 200;
const TICK_MS = 1000 / 60;
/** Fade in 4 of 128 a tick, out 16 (fade_start 0x1aaff, fade_step 0x1ab8d). */
const FADE_IN_TICKS = 32;
const FADE_OUT_TICKS = 8;
/** After fire the screen runs 60 more ticks (0x12bf2 with 0x3c). */
const AFTER_FIRE_TICKS = 60;
const YES = 1;
const NO = 2;

/**
 * The words (template 0x87038, continue_word_tick 0x15415): the frame of
 * CNTGRB_E, where it starts, its speed and slowing (px a tick), the ticks
 * it waits, the answer it stands for, and how it leaves after fire.
 */
const WORDS = [
  { frame: 1, x: 0, y: 278, vy: -8, ay: 1 / 4, wait: 30, pick: NO, away: 6 / 16 },
  { frame: 0, x: 0, y: 278, vy: -8, ay: 1 / 4, wait: 20, pick: YES, away: 2 / 16 },
  { frame: 2, x: 0, y: -32, vy: 8, ay: -1 / 4, wait: 0, pick: 0, away: -4 / 16 },
];

/** The mist (template 0x86ff8, continue_mist_tick 0x154b0): frame, start, drift. */
const MIST = [
  { frame: 0, x: 110, y: 28, dx: 3 / 16 },
  { frame: 1, x: -20, y: 78, dx: 5 / 16 },
  { frame: 2, x: -20, y: 88, dx: 7 / 16 },
];
/** Past x 155 (picture 315) a strip goes back to -330 (picture -170). */
const MIST_WRAP_AT = 315;
const MIST_WRAP_TO = -170;

export default class ContinueScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ContinueScene' });
  }

  /** @param {{players: object[], story: import('../story/Story').default}} data */
  init(data) {
    this._players = data.players || [];
    this._story = data.story;
    this._ready = false;
  }

  preload() {
    this.load.json('worldmaps', 'worldmap/worlds.json');
  }

  create() {
    const screen = this.cache.json.get('worldmaps').continue;
    this._screen = screen;
    const need = Object.entries(screen.sheets).filter(([name]) => !this.textures.exists(key(name)));
    if (!need.length) {
      this._build();
      return;
    }
    need.forEach(([name, sheet]) => this.load.image(key(name), sheet.image));
    this.load.once('complete', () => this._build());
    this.load.start();
  }

  _build() {
    const { sheets, flash } = this._screen;
    Object.entries(sheets).forEach(([name, sheet]) => {
      const tex = this.textures.get(key(name));
      if (!tex.has('0')) sheet.frames.forEach(([x, y, w, h], i) => tex.add(String(i), 0, x, y, w, h));
    });
    this._flash = flash;
    const cam = this.cameras.main;
    cam.setBackgroundColor('#000000');
    cam.setZoom(Math.min(this.scale.width / PIC_W, this.scale.height / PIC_H));
    cam.centerOn(PIC_W / 2, PIC_H / 2);

    // An object stands at its point plus its frame's origin.
    const put = (name, frame, x, y) => {
      const [, , , , ox, oy] = sheets[name].frames[frame];
      return this.add.image(x + ox, y + oy, key(name), String(frame)).setOrigin(0, 0);
    };
    this._put = put;
    put('continbg', 0, 0, 0);

    // The lives (continue_screen_init 0x154cb): the first 5 - L tubes are
    // shown empty; six or more, a Jack and "+ L-5".
    const lives = this._story.lives;
    if (lives < 6) {
      for (let i = 0; i < 5 && i !== 5 - lives; i++) put('continbg', 2 + i, 0, 0);
    } else {
      put('contpanl', 11, 15, 30);
      this._writeNumber(` + ${lives - 5}`, 40, 36);
    }

    // Drawn with +0x1c = -2: through MIST.STP, light added to what is
    // behind (see docs/re/front/continue.md, obj_draw_blend 0x26347).
    this._mist = MIST.map((m) => ({
      ...m, img: put('conmist', m.frame, m.x, m.y).setBlendMode(Phaser.BlendModes.ADD),
    }));
    this._words = WORDS.map((w) => ({ ...w, ay0: w.ay, img: put('cntgrb_e', w.frame, w.x, w.y), lit: false }));

    this._choice = YES;
    this._done = false;
    this._ticks = 0;
    this._fadeIn = FADE_IN_TICKS;
    this._after = -1;
    cam.fadeIn(FADE_IN_TICKS * TICK_MS, 0, 0, 0);

    this._keys = new LocalKeys();
    const sets = loadKeySets();
    const n = Math.max(1, this._players.length);
    this._pads = sets.slice(0, n).map((set, i) => this._keys.pad(set, n === 1 && i === 0 ? SOLO_EXTRA : {}));
    this._enter = this.input.keyboard.addKey('ENTER');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._keys.destroy());
    this._acc = 0;
    this._ready = true;
  }

  /** " + N" in CONTPANL: digits are frames 0-9, "+" frame 10 (0x1d45e). */
  _writeNumber(text, x, y) {
    const sheet = this._screen.sheets.contpanl;
    let at = x;
    for (const ch of text) {
      // the writer's spacing is not read: a space is a digit's width,
      // and each glyph is set its own width on
      const frame = ch === '+' ? 10 : ch >= '0' && ch <= '9' ? Number(ch) : -1;
      if (frame < 0) {
        at += sheet.frames[0][2];
        continue;
      }
      this._put('contpanl', frame, at, y);
      at += sheet.frames[frame][2];
    }
  }

  update(_t, delta) {
    if (!this._ready) return;
    this._acc = Math.min(this._acc + delta, TICK_MS * 10);
    while (this._acc >= TICK_MS && this._ready) {
      this._acc -= TICK_MS;
      this._tick();
    }
  }

  /** One tick: the choice (0x15818) while asking, then every object. */
  _tick() {
    this._ticks += 1;
    if (this._fadeIn > 0) this._fadeIn -= 1;
    if (this._after < 0) {
      this._read();
      // the question is over once answered and faded in (0x1590e)
      if (this._done && this._fadeIn === 0) this._after = AFTER_FIRE_TICKS;
    } else if (this._after > 0) {
      this._after -= 1;
      if (this._after === 0) {
        this.cameras.main.fadeOut(FADE_OUT_TICKS * TICK_MS, 0, 0, 0);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this._answer());
      }
    }
    this._mist.forEach((m) => {
      m.x += m.dx;
      if (Math.floor(m.x) > MIST_WRAP_AT) m.x = MIST_WRAP_TO + (m.x - Math.floor(m.x));
      const [, , , , ox] = this._screen.sheets.conmist.frames[m.frame];
      m.img.x = Math.floor(m.x) + ox;
    });
    this._words.forEach((w) => this._wordTick(w));
  }

  /** The input of 0x15818: fire answers, left picks yes, right no. */
  _read() {
    const fire = this._enter.isDown || this._pads.some((p) => p.but1.isDown || p.but2.isDown);
    if (fire && !this._done) {
      this._done = true;
      // YES falls at 1/8 a tick per tick, NO at 3/8, CONTINUE? rises at 1/4
      this._words.forEach((w) => { w.ay = w.away; });
    }
    if (this._pads.some((p) => p.left.isDown)) this._choice = YES;
    if (this._pads.some((p) => p.right.isDown)) this._choice = NO;
  }

  /** continue_word_tick 0x15415: wait, move, stop at speed 0, flash if picked. */
  _wordTick(w) {
    if (w.wait > 0) {
      w.wait -= 1;
      return;
    }
    w.y += w.vy;
    w.vy += w.ay;
    if (!this._done) {
      if (w.ay > 0 ? w.vy >= 0 : w.vy <= 0) {
        w.vy = 0;
        w.ay = 0;
      }
      w.lit = w.pick === this._choice;
    }
    const [, , , , , oy] = this._screen.sheets.cntgrb_e.frames[w.frame];
    w.img.y = Math.floor(w.y) + oy;
    // obj_draw 0x234bf: 6 ticks in 16 the picked word is a silhouette in
    // colour 254 (the remap table at 0x943dc)
    if (w.lit && (this._ticks & 15) < 6) w.img.setTintFill(this._flash);
    else w.img.clearTint();
  }

  _answer() {
    this._ready = false;
    if (this._choice === YES) {
      this._story.carryOn();
      this.scene.start('WorldMapScene', { players: this._players, story: this._story, result: 'continued' });
      return;
    }
    // no: the game is over (0x12654, state 0xf)
    this.cameras.main.resetFX();
    this.cameras.main.setZoom(1).centerOn(this.scale.width / 2, this.scale.height / 2);
    this.children.removeAll(true);
    this.add.text(this.scale.width / 2, this.scale.height / 2, 'ИГРА ОКОНЧЕНА', {
      fontSize: '40px', color: '#ff4444', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);
    this.time.delayedCall(3000, () => this.scene.start('MenuScene'));
  }
}

/** @returns {string} the texture key of one of the screen's sheets */
function key(name) {
  return `continue_${name}`;
}
