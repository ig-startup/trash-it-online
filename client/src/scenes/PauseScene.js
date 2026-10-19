/**
 * The pause, over a level played at this keyboard (G.EXE pause_game
 * 0x1007c, see docs/re/front/pause.md). Esc stops the game; the screen is
 * dimmed, every other pixel black (screen_checker_clear 0x10010), and
 * PANEL.SPR's pause panel comes up (list 0x973c4): PAUSE bobbing, the menu
 * plate, the arrow, and Jack's face sliding in, shrinking to size.
 *
 * The menu is pause_cursor_tick's (0x1ac13), on the 0x287c50 state:
 *   0 resume / quit level / quit game — the story and the arcade
 *   1 are you sure? yeah / naah — after quit level or quit game
 *   2 resume / quit game — battle (option 0x10000000), and the clone's coop
 *   3 are you sure? yeah / naah — after its quit game
 * Up and down move the arrow, any button picks. Esc does nothing here:
 * the pause loop does not read it.
 *
 * Everything is in the original's 320 x 200 screen, moved a tick at a
 * time, 60 a second.
 */
import Phaser from 'phaser';
import { loadKeySets, LocalKeys, SOLO_EXTRA } from '../input/keySets';
import { PROP_ANIMS } from '../entities/props';

const VIEW_W = 320;
const VIEW_H = 200;
const TICK_MS = 1000 / 60;

/** The level's record states the menu writes (+0x26; F.EXE 0x20e1d). */
export const QUIT_LEVEL = 0x11;
export const QUIT_GAME = 0x10;

/** The last row of each menu (table 0x9821c). */
const LAST_ROW = [2, 1, 1, 1];
/** The arrow's y under each row, px, by menu (table 0x981ec, three a menu). */
const ARROW_Y = [[0, 14, 29], [14, 26], [4, 22], [14, 26]];
/** PAUSE bobs down and back, a step a tick (table 0x96fe6, hud_wobble_step). */
const BOB = [0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 9, 10, 12, 10, 9, 8, 6, 5, 4, 3, 2, 2, 1, 1, 0];

export default class PauseScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PauseScene' });
  }

  /**
   * @param {{menu: 0|2, players: number,
   *   done: (state: number|null) => void}} data
   *   `done` gets null to resume, else QUIT_LEVEL or QUIT_GAME
   */
  init(data) {
    this._first = data.menu === 2 ? 2 : 0;
    this._nPlayers = Math.max(1, data.players || 1);
    this._done = data.done;
  }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(Math.min(this.scale.width / VIEW_W, this.scale.height / VIEW_H));
    cam.centerOn(VIEW_W / 2, VIEW_H / 2);

    // every other pixel of the whole view black, in the original's pixels
    if (!this.textures.exists('pause_checker')) {
      const t = this.textures.createCanvas('pause_checker', 2, 2);
      const ctx = t.getContext();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillRect(1, 1, 1, 1);
      t.refresh();
    }
    const coverW = Math.ceil(this.scale.width / cam.zoom) + 2;
    const coverH = Math.ceil(this.scale.height / cam.zoom) + 2;
    this.add.tileSprite(VIEW_W / 2, VIEW_H / 2, coverW, coverH, 'pause_checker');

    const [pause, plateStory, plateSure, plateBattle, face, ...arrows] = PROP_ANIMS.pause;
    this._plates = [plateStory, plateSure, plateBattle, plateSure];
    this._arrows = arrows;
    // the list's points are each sprite's top left (draw_panel_icon 0x2e4b4)
    this._pause = this.add.image(119, 80, pause).setOrigin(0, 0);
    this._plate = this.add.image(125, 120, plateStory).setOrigin(0, 0);
    this._arrow = this.add.image(120, 121, arrows[0]).setOrigin(0, 0);
    this._face = this.add.image(-50, 30, face).setOrigin(0, 0);
    this._faceW = this._face.width;
    this._faceH = this._face.height;

    // pause_hud 0x1aaa8: battle's menu has no quit level
    this._menu = this._first;
    this._row = 0;
    this._arrowY = 0;
    this._arrowFrame = 0;
    this._bob = 0;
    this._faceX = -50;
    this._grow = 0;
    this._ticks = 0;
    this._picked = null;

    this._keys = new LocalKeys();
    const sets = loadKeySets();
    this._pads = sets.slice(0, this._nPlayers)
      .map((set, i) => this._keys.pad(set, this._nPlayers === 1 && i === 0 ? SOLO_EXTRA : {}));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._keys.destroy());
    this._acc = 0;
    this._draw();
  }

  update(_t, delta) {
    this._acc = Math.min(this._acc + delta, TICK_MS * 10);
    while (this._acc >= TICK_MS && this._picked === null) {
      this._acc -= TICK_MS;
      this._tick();
    }
  }

  /** Which of up, down and the buttons went down since the last tick, on any pad. */
  _pressed() {
    const out = { up: false, down: false, fire: false };
    this._pads.forEach((pad) => {
      ['up', 'down', 'but1', 'but2'].forEach((a) => {
        if (!pad[a]._justDown) return;
        pad[a]._justDown = false;
        out[a === 'up' || a === 'down' ? a : 'fire'] = true;
      });
    });
    return out;
  }

  _tick() {
    this._ticks += 1;
    const p = this._pressed();
    // pause_cursor_tick 0x1ac13
    if (p.down && this._row < LAST_ROW[this._menu]) this._row += 1;
    if (p.up && this._row > 0) this._row -= 1;
    if (p.fire) this._pick();
    if (this._picked !== null) return;
    // the arrow eases a quarter of the way to its row a tick
    this._arrowY += (ARROW_Y[this._menu][this._row] - this._arrowY) / 4;
    // the arrow's frames 56, 57, 58, one every 8 ticks
    if (this._ticks % 8 === 0) this._arrowFrame = (this._arrowFrame + 1) % this._arrows.length;
    this._bob = (this._bob + 1) % BOB.length;
    // Jack (0x1ab60): 128 px too big at first, 6 less a tick down to 1;
    // an eighth of the way to x 140 a tick; there, he blinks
    if (this._grow === 0) this._grow = 128;
    this._grow = Math.max(1, this._grow - 6);
    if (this._faceX < 139) this._faceX += (140 - this._faceX) / 8;
    this._draw();
  }

  /** A button on the menu (pause_cursor_tick 0x1acc4). */
  _pick() {
    const sure = this._menu === 1 || this._menu === 3;
    if (!sure) {
      if (this._row === 0) {
        this._close(null);
        return;
      }
      // quit level (row 1 of the story's) or quit game: are you sure? naah first
      this._quit = this._menu === 0 && this._row === 1 ? QUIT_LEVEL : QUIT_GAME;
      this._menu += 1;
      this._row = 1;
      return;
    }
    if (this._row === 0) {
      this._close(this._quit);
      return;
    }
    // naah: back to the menu, on resume
    this._menu -= 1;
    this._row = 0;
  }

  _close(state) {
    this._picked = state;
    const done = this._done;
    this.scene.stop();
    done(state);
  }

  _draw() {
    this._pause.y = 80 + BOB[this._bob];
    this._plate.setTexture(this._plates[this._menu]);
    this._arrow.setTexture(this._arrows[this._arrowFrame]);
    this._arrow.y = 121 + this._arrowY;
    this._face.x = Math.floor(this._faceX);
    // stretched by `grow` px each way (+0x10, +0x14), as drawn
    this._face.setDisplaySize(this._faceW + this._grow, this._faceH + this._grow);
    this._face.setVisible(this._faceX < 139 || (this._ticks & 31) >= 12);
  }
}
