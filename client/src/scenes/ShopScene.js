/**
 * The hammer shop — F.EXE's hammer_shop (0x1b92a), entered from the world
 * map when the shop flies down for Jack (docs/re/front/hammer-shop.md).
 *
 * The hammer in hand is traded in on the way in, its worth added to the
 * timmy points. Thirty hammers stand in a grid of five columns by six
 * rows; the ones this world does not sell are covered. Fire on one opens
 * the three round buttons on the right — buy, watch its film, back — and
 * its card: name plate, price, girth, splat, control, range, restrike,
 * area and spread. Buying asks "buy the …?", yes or no; it is refused for
 * the hammer in hand and for one that costs more than the points. Leaving
 * without buying takes the trade-in back.
 *
 * Everything is placed in the picture's own pixels (320 x 200): an object
 * at (x + 160, y + 128) of the original's coordinates plus its frame's
 * origin, the bars at (x + 160, y + 100).
 */
import Phaser from 'phaser';
import { loadKeySets, LocalKeys, SOLO_EXTRA } from '../input/keySets';
import { writeYel } from './yelFont';

const PIC_W = 320;
const PIC_H = 200;
const TICK_MS = 1000 / 60;
/** Fade in 8 of 128 a tick (0x1b6c9); out the clone's 16 ticks. */
const FADE_IN_TICKS = 16;
const FADE_OUT_TICKS = 16;

/** The cursor's states (0xd6dba). */
const BROWSE = 1;
const MENU = 2;
const CONFIRM = 3;
const WAIT = 5;
const LEAVE = 6;

/** The grid (0x1b31a, 0x1c659): a cell is 51 x 29, column 5 the exit. */
const CELL_W = 51;
const CELL_H = 29;
const COLS = 5;
const ROWS = 6;
const EXIT_COL = 5;
/** The cursor's frames, one every 3 ticks (table 0x1b151). */
const CURSOR = [20, 21, 22, 21];
/** The round buttons, top to bottom: buy, film, back (HAMSHP_E 12-14). */
const BUTTONS = [12, 13, 14];
const BUY = 0;
const FILM = 1;
const BACK = 2;
/** A message stays 80 ticks, going back 30 (0x1ba69, 0x1bf01). */
const SAY_TICKS = 0x50;
const BACK_TICKS = 0x1e;
/** The card steps on every 5 ticks (0x1c34f): 12 steps. */
const CARD_STEP_TICKS = 5;
const CARD_STEPS = 12;
/** The card's labels (HAMSHP_E 54 + n) and their rows; values 54 + v. */
const LABEL_FRAME = 54;
const PLATE_FRAME = 23;
/** The price's digits: HAMSHP_E 69 + d (template 0x89bec), 1 apart. */
const PRICE_DIGIT = 69;
/** The money: five digits, 10000 to 1 (0x1bfed, table 0x1b161). */
const MONEY_AT = [-60 + 160, -71 + 128];
const MONEY_PLACES = [10000, 1000, 100, 10, 1];
/** A bar grows 5 px a tick (0x26efb), 4 rows high. */
const BAR_GROW = 5;
/** A ring grows 2 px a tick on its longer side (0x1c0da). */
const RING_GROW = 2;
/** The yes/no pointer's sway (table 0x1b137), a step a tick. */
const SWAY = [0, 1, 2, 3, 4, 3, 2, 1];

export default class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
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
    const shop = this.cache.json.get('worldmaps').shop;
    this._shop = shop;
    const need = Object.entries(shop.sheets).filter(([name]) => !this.textures.exists(key(name)));
    if (!need.length) {
      this._build();
      return;
    }
    need.forEach(([name, sheet]) => this.load.image(key(name), sheet.image));
    this.load.once('complete', () => this._build());
    this.load.start();
  }

  _build() {
    const shop = this._shop;
    const story = this._story;
    Object.entries(shop.sheets).forEach(([name, sheet]) => {
      const tex = this.textures.get(key(name));
      if (!tex.has('0')) sheet.frames.forEach(([x, y, w, h], i) => tex.add(String(i), 0, x, y, w, h));
    });
    const cam = this.cameras.main;
    cam.setBackgroundColor('#000000');
    cam.setZoom(Math.min(this.scale.width / PIC_W, this.scale.height / PIC_H));
    cam.centerOn(PIC_W / 2, PIC_H / 2);

    story.enterShop(shop.worth);

    // The picture (slot 0x8a frames 90 and 89) and the hammers, twenty
    // frames a frame every 4 ticks (template 0x89ab0, 0x1c82b).
    this._put('hamshp_e', 90, 0, 0);
    this._put('hamshp_e', 89, 0, 0);
    this._grid = this._put('hshams', 0, -26, -9);
    // What this world does not sell is covered (0x1c659, table 0x8d90c).
    const open = shop.open[story.world];
    this._covers = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!open[row * COLS + col]) this._covers.push(this._put('hamshp_e', 16, col * CELL_W - 1, row * CELL_H - 2));
      }
    }
    // The hammer in hand glows in its cell (0x1c70c, table 0x89ad0).
    const cell = shop.cell[story.hammer];
    this._owned = this._put('hamshp_e', 53, (cell % COLS) * CELL_W, Math.floor(cell / COLS) * CELL_H - 3)
      .setBlendMode(Phaser.BlendModes.ADD);
    // The buttons lit (0x1b2c0), and the cursor (0x1b31a).
    this._lit = BUTTONS.map((f) => this._put('hamshp_e', f, 0, 0));
    this._cursor = this._put('hamshp_e', CURSOR[0], 0, 0);
    // The money, five digits (0x1bfb2).
    this._digits = MONEY_PLACES.map(() => this._put('hamshp_e', 0, 0, 0).setVisible(false));
    this._writeMoney();

    // The card (0x1c34f): what each step shows is made as it comes.
    this._card = [];
    this._bars = this.add.graphics();
    this._rings = [0, 1].map((f) => this._put('statspr', f, 0, 0).setVisible(false));
    this._texts = [];
    this._pointer = null;

    this._state = BROWSE;
    this._col = 0;
    this._row = 0;
    this._button = BACK;
    this._choice = 1;
    this._wait = 0;
    this._ticks = 0;
    this._cardStep = 0;
    this._cardLeft = 0;

    // The clone's own line under the screen.
    this._msg = this.add.text(PIC_W / 2, PIC_H - 2, '', {
      fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(10);

    cam.fadeIn(FADE_IN_TICKS * TICK_MS, 0, 0, 0);
    this._keys = new LocalKeys();
    const sets = loadKeySets();
    const n = Math.max(1, this._players.length);
    this._pads = sets.slice(0, n).map((set, i) => this._keys.pad(set, n === 1 && i === 0 ? SOLO_EXTRA : {}));
    this._enter = this.input.keyboard.addKey('ENTER');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._keys.destroy());
    this._acc = 0;
    this._ready = true;
    this._show();
  }

  /** An object of a sheet at the picture's (x, y) plus its frame's origin. */
  _put(name, frame, x, y) {
    const [, , , , ox, oy] = this._shop.sheets[name].frames[frame];
    return this.add.image(x + ox, y + oy, key(name), String(frame)).setOrigin(0, 0);
  }

  _place(img, name, frame, x, y) {
    const [, , , , ox, oy] = this._shop.sheets[name].frames[frame];
    return img.setFrame(String(frame)).setPosition(x + ox, y + oy);
  }

  update(_t, delta) {
    if (!this._ready) return;
    this._acc = Math.min(this._acc + delta, TICK_MS * 10);
    while (this._acc >= TICK_MS && this._ready) {
      this._acc -= TICK_MS;
      this._ticks += 1;
      this._tick();
    }
    if (this._ready) this._show();
  }

  _pressed(action) {
    return this._pads.some((p) => Phaser.Input.Keyboard.JustDown(p[action]));
  }

  /** One tick: the keys (0x1b31a, 0x1ba69), the card, the waits. */
  _tick() {
    // JustDown is read once a frame for every key, whatever the state
    const left = this._pressed('left');
    const right = this._pressed('right');
    const up = this._pressed('up');
    const down = this._pressed('down');
    let fire = Phaser.Input.Keyboard.JustDown(this._enter);
    if (this._pressed('but1')) fire = true;
    if (this._pressed('but2')) fire = true;

    const s = this._state;
    if (s === BROWSE) {
      if (left) this._col = this._col === 0 ? EXIT_COL : this._col - 1;
      if (right) this._col = this._col === EXIT_COL ? 0 : this._col + 1;
      if (this._col !== EXIT_COL) {
        if (up) this._row = this._row === 0 ? ROWS - 1 : this._row - 1;
        if (down) this._row = this._row === ROWS - 1 ? 0 : this._row + 1;
      }
      // browsing, the buttons' cursor rests on "back" (0x1b4e1)
      this._button = BACK;
      if (fire) this._fireBrowse();
    } else if (s === MENU) {
      if (up) this._button = this._button === 0 ? BACK : this._button - 1;
      if (down) this._button = this._button === BACK ? 0 : this._button + 1;
      if (fire) this._fireMenu();
    } else if (s === CONFIRM) {
      if (left) this._choice = 1;
      if (right) this._choice = 0;
      if (fire) this._fireConfirm();
    } else if (s === WAIT || s === LEAVE) {
      if (this._wait > 0) {
        this._wait -= 1;
      } else if (s === WAIT) {
        this._clearTexts();
        this._state = BROWSE;
      } else {
        this._leave();
        return;
      }
    }
    if (this._state === MENU) this._cardTick();
    else this._clearCard();
  }

  /** The cursor's cell: column * 6 + row (0x1b5c6), the exit 30. */
  _item() {
    return this._shop.items[this._col * ROWS + this._row];
  }

  _fireBrowse() {
    if (this._col === EXIT_COL) {
      this._leave();
      return;
    }
    // a hammer this world sells (table 0x8d90c); else only a sound
    if (!this._shop.open[this._story.world][this._row * COLS + this._col]) return;
    this._state = MENU;
    this._cardStep = 0;
    this._cardLeft = 0;
  }

  _fireMenu() {
    const item = this._item();
    if (this._button === BUY) {
      if (item.hammer === this._story.hammer) {
        this._say(this._shop.words.owned);
        this._wait = SAY_TICKS;
        this._state = WAIT;
        return;
      }
      // "buy the" / "<name> ?" / "yes ~ no" (0x1bd0b, 0x1bd81, 0x1bdb5)
      this._write(this._shop.words.buyThe, -24 + 160, -67 + 128);
      this._write(`${item.name} ?`, -24 + 160, -45 + 128);
      this._write(this._shop.words.yesNo, -24 + 160, -23 + 128);
      this._choice = 1;
      this._pointer = this._put('yelmedft', 43, 0, 0);
      this._texts.push(this._pointer);
      this._state = CONFIRM;
    } else if (this._button === FILM) {
      // state 7 plays the hammer's film, D\SMK\<sla, slb ...>.SMK: not on
      // the clone's disc
      this._msg.setText('ФИЛЬМЫ МОЛОТКОВ В КЛОНЕ НЕ ПОКАЗЫВАЮТСЯ');
    } else {
      this._wait = BACK_TICKS;
      this._state = WAIT;
    }
  }

  _fireConfirm() {
    this._clearTexts();
    if (this._choice !== 1) {
      this._wait = BACK_TICKS;
      this._state = WAIT;
      return;
    }
    const r = this._story.buy(this._item());
    if (r === 'poor') {
      this._say(this._shop.words.poor);
      this._wait = SAY_TICKS;
      this._state = WAIT;
      return;
    }
    this._say(this._shop.words.bought);
    this._writeMoney();
    this._wait = SAY_TICKS;
    this._state = LEAVE;
  }

  _say(text) {
    this._clearTexts();
    this._write(text, -24 + 160, -37 + 128);
  }

  /** Words in YELMEDFT, each line centred on x (yelFont.js). */
  _write(text, x, y) {
    const { images } = writeYel(this, {
      key: key('yelmedft'), frames: this._shop.sheets.yelmedft.frames, font: this._shop.font,
    }, text, x, y);
    this._texts.push(...images);
  }

  _clearTexts() {
    this._texts.forEach((t) => t.destroy());
    this._texts = [];
    this._pointer = null;
  }

  /** 0x1bfed: the money in five digits, the leading noughts left out. */
  _writeMoney() {
    const money = this._story.timmies;
    let x = MONEY_AT[0];
    MONEY_PLACES.forEach((place, i) => {
      const d = Math.floor(money / place) % 10;
      const img = this._digits[i];
      if (d === 0 && money < place && i !== MONEY_PLACES.length - 1) {
        img.setVisible(false);
        return;
      }
      this._place(img, 'hamshp_e', d, x, MONEY_AT[1]).setVisible(true);
      x += this._shop.sheets.hamshp_e.frames[d][2];
    });
  }

  /**
   * 0x1c34f: the card builds up a step every 5 ticks — the plate, then
   * TIMMIES and the price, GIRTH, SPLAT, CONTROL, RANGE, RESTRIKE, AREA,
   * SPREAD.
   */
  _cardTick() {
    if (this._cardStep >= CARD_STEPS) {
      this._growCard();
      return;
    }
    if (this._cardLeft > 0) {
      this._cardLeft -= 1;
      this._growCard();
      return;
    }
    this._cardLeft = CARD_STEP_TICKS - 1;
    const item = this._item();
    const step = this._cardStep;
    this._cardStep += 1;
    // a label: x -205, y dy - 156 (0x1c7e6)
    const label = (n, dy, dx = 0) => this._card.push(this._put('hamshp_e', LABEL_FRAME + n, -205 + 160 + dx, dy - 156 + 128));
    // a bar of two parts: red from 0, green after it (0x1c2e4, 0x26efb)
    const bar = (dy, a, b) => {
      this._barList.push({ x: 160 - 62, y: 100 + dy - 61, len: a, shown: 0, part: 0 });
      if (b !== undefined) this._barList.push({ x: 160 - 62 + a, y: 100 + dy - 61, len: b, shown: 0, part: 1 });
    };
    switch (step) {
      case 0:
        this._barList = [];
        this._card.push(this._put('hamshp_e', PLATE_FRAME + item.plate, -252 + 160, -240 + 128));
        break;
      case 1: {
        label(0, 0);
        let x = -205 + 160;
        for (const ch of String(item.price)) {
          const f = PRICE_DIGIT + Number(ch);
          this._card.push(this._put('hamshp_e', f, x, -156 + 128));
          x += this._shop.sheets.hamshp_e.frames[f][2] + 1;
        }
        break;
      }
      case 2:
        label(1, 15);
        bar(15, item.girth[0], item.girth[1]);
        break;
      case 3:
        label(2, 30);
        bar(30, item.splat[0], item.splat[1]);
        break;
      case 4:
        label(3, 45);
        this._card.push(this._put('hamshp_e', LABEL_FRAME + item.control, -205 + 160, 45 - 156 + 128));
        break;
      case 5:
        label(4, 60);
        bar(60, item.range);
        break;
      case 6:
        label(5, 75);
        this._card.push(this._put('hamshp_e', LABEL_FRAME + item.restrike, -205 + 160, 75 - 156 + 128));
        break;
      case 7:
        label(6, 90);
        this._ring(0, -62 + 160, -2 + 128, item.area);
        break;
      case 8:
        label(7, 92, 0x78);
        this._ring(1, 58 + 160, -2 + 128, item.spread);
        break;
      default:
        break;
    }
    this._growCard();
  }

  /**
   * STATSPR's ring, grown to the hammer's w x h (template 0x89a30,
   * shop_ring_tick 0x1c0da): from nothing, the longer side 2 px a tick and
   * the other in proportion — 4 each when square — both set to w x h once
   * the width is there. obj_draw keeps the frame's centre across and its
   * bottom, the stretch going to both sides and up.
   */
  _ring(i, x, y, [w, h]) {
    const r = this._rings[i];
    r.setPosition(x, y).setVisible(true);
    r.want = { w, h };
    r.size = { w: 0, h: 0 };
    r.base = { x: r.x, y: r.y, fw: r.frame.width, fh: r.frame.height };
    r.setDisplaySize(1, 1);
  }

  _growCard() {
    const g = this._bars;
    g.clear();
    (this._barList || []).forEach((b) => {
      b.shown = Math.min(b.len, b.shown + BAR_GROW);
      const [edge, mid] = this._shop.bar[b.part];
      g.fillStyle(edge).fillRect(b.x, b.y, b.shown, 1).fillRect(b.x, b.y + 3, b.shown, 1);
      g.fillStyle(mid).fillRect(b.x, b.y + 1, b.shown, 2);
    });
    this._rings.forEach((r) => {
      if (!r.visible || !r.want) return;
      const { w, h } = r.want;
      const square = w === h;
      r.size.w += square ? 2 * RING_GROW : w > h ? RING_GROW : (RING_GROW * w) / h;
      r.size.h += square ? 2 * RING_GROW : h > w ? RING_GROW : (RING_GROW * h) / w;
      if (r.size.w >= w) r.size = { w, h };
      const dw = Math.floor(r.size.w);
      const dh = Math.floor(r.size.h);
      const b = r.base;
      r.setDisplaySize(Math.max(1, dw), Math.max(1, dh))
        .setPosition(b.x + Math.trunc((b.fw - dw) / 2), b.y + (b.fh - dh));
    });
  }

  _clearCard() {
    if (!this._card.length && !this._barList) return;
    this._card.forEach((o) => o.destroy());
    this._card = [];
    this._barList = null;
    this._bars.clear();
    this._rings.forEach((r) => r.setVisible(false));
    this._cardStep = 0;
    this._cardLeft = 0;
  }

  /** What every object shows this tick. */
  _show() {
    const t = this._ticks;
    const browsing = this._state === BROWSE;
    // the grid and the ?s never hide: the card is drawn over them (depth 1
    // against 499 and 498; neither tick touches its visible bit)
    this._grid.setFrame(String(Math.floor(t / 4) % 20));
    // 0x1c70c: shown browsing, drawn half and half through HAMSHP_E.STP
    // (template mode 0xa00d, -2); the brightness it writes is never drawn
    this._owned.setVisible(browsing).setAlpha(0.5);
    // 0x1b2c0: browsing, only "back" stays lit
    this._lit.forEach((b, i) => b.setVisible(!browsing || i === BACK));
    // 0x1b31a: on a hammer, the brackets; on the buttons, the button in
    // colour 254 (the brightness 0x80 / 0x46 it writes is never drawn)
    if (browsing && this._col !== EXIT_COL) {
      this._place(this._cursor, 'hamshp_e', CURSOR[Math.floor(t / 3) & 3], this._col * CELL_W, this._row * CELL_H - 2);
      this._cursor.clearTint();
    } else {
      this._place(this._cursor, 'hamshp_e', BUTTONS[this._button], 0, 0);
      this._cursor.setTintFill(this._shop.silhouette);
    }
    // 0x1b182: the pointer sways between yes and no, an arrow at the choice
    if (this._pointer) {
      const f = this._choice === 1 ? 43 : 42;
      const sway = SWAY[t & 7] * (this._choice === 1 ? -1 : 1);
      this._place(this._pointer, 'yelmedft', f, -4 - 24 + 160 + sway, -21 + 128);
    }
  }

  _leave() {
    this._ready = false;
    this._story.leaveShop();
    this.cameras.main.fadeOut(FADE_OUT_TICKS * TICK_MS, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('WorldMapScene', { players: this._players, story: this._story });
    });
  }
}

/** @returns {string} the texture key of one of the shop's sheets */
function key(name) {
  return `shop_${name}`;
}
