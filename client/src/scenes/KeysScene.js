import Phaser from 'phaser';
import { PLAYER_COLORS } from '../../../shared/constants.mjs';
import {
  ACTIONS, DEFAULT_KEY_SETS, loadKeySets, saveKeySets, keyLabel,
} from '../input/keySets';

const HEADINGS = { left: '←', right: '→', up: '↑', down: '↓', but1: 'КН 1', but2: 'КН 2' };
const COL_X0 = 190;
const COL_W = 100;
const ROW_Y0 = 200;
const ROW_H = 56;

/**
 * Redefining the keys, as the original's setup lets every player do: six
 * keys a player, four players. Click a key, press the new one; Escape
 * leaves it as it was. Saved on this browser.
 */
export default class KeysScene extends Phaser.Scene {
  constructor() {
    super({ key: 'KeysScene' });
  }

  create() {
    const { width } = this.scale;
    const cx = width / 2;
    this._sets = loadKeySets();
    this._waiting = null;

    this.add.text(cx, 60, 'КЛАВИШИ', {
      fontSize: '36px', fontStyle: 'bold', color: '#ffffff', stroke: '#ff4444', strokeThickness: 4,
    }).setOrigin(0.5);
    this.add.text(cx, 110,
      'КН 1 — молоток из каски и обратно (с ↑ — пылесос)\nКН 2 — прыжок, с молотком — удар', {
        fontSize: '15px', color: '#aaaaaa', align: 'center', lineSpacing: 4,
      }).setOrigin(0.5);

    ACTIONS.forEach((a, c) => {
      this.add.text(COL_X0 + c * COL_W, ROW_Y0 - 36, HEADINGS[a], {
        fontSize: '18px', color: '#ffff66',
      }).setOrigin(0.5);
    });

    this._cells = [];
    this._sets.forEach((set, p) => {
      const y = ROW_Y0 + p * ROW_H;
      const colorHex = parseInt(PLAYER_COLORS[p].replace('#', ''), 16);
      this.add.rectangle(40, y, 16, 16, colorHex);
      this.add.text(56, y, `ИГРОК ${p + 1}`, { fontSize: '16px', color: '#ffffff' }).setOrigin(0, 0.5);
      ACTIONS.forEach((a, c) => {
        const cell = this.add.text(COL_X0 + c * COL_W, y, '', {
          fontSize: '15px', color: '#ffffff', backgroundColor: '#333355', padding: { x: 8, y: 6 },
          fixedWidth: COL_W - 12, align: 'center',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        cell.on('pointerdown', () => this._listen(p, a));
        this._cells.push({ cell, p, a });
      });
    });

    this._hint = this.add.text(cx, ROW_Y0 + 4 * ROW_H + 10, '', {
      fontSize: '16px', color: '#ffcc33',
    }).setOrigin(0.5);

    this._button(cx - 110, 520, 'ПО УМОЛЧАНИЮ', () => {
      this._sets = DEFAULT_KEY_SETS.map((s) => ({ ...s }));
      saveKeySets(this._sets);
      this._waiting = null;
      this._refresh();
    });
    this._button(cx + 110, 520, 'НАЗАД', () => this.scene.start('MenuScene'));

    this._onKey = (e) => {
      if (!this._waiting) return;
      e.preventDefault();
      const { p, a } = this._waiting;
      this._waiting = null;
      if (e.code !== 'Escape') {
        this._sets[p][a] = e.code;
        saveKeySets(this._sets);
      }
      this._refresh();
    };
    window.addEventListener('keydown', this._onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', this._onKey));

    this._refresh();
  }

  _listen(p, a) {
    this._waiting = { p, a };
    this._refresh();
  }

  /** Redraws the grid; a key in more than one place shows red. */
  _refresh() {
    const uses = new Map();
    this._sets.forEach((set) => ACTIONS.forEach((a) => uses.set(set[a], (uses.get(set[a]) || 0) + 1)));
    this._cells.forEach(({ cell, p, a }) => {
      const code = this._sets[p][a];
      const waiting = this._waiting && this._waiting.p === p && this._waiting.a === a;
      cell.setText(waiting ? '…' : keyLabel(code));
      cell.setStyle({
        backgroundColor: waiting ? '#aa44aa' : (uses.get(code) > 1 ? '#883333' : '#333355'),
      });
    });
    this._hint.setText(this._waiting
      ? `Игрок ${this._waiting.p + 1}, ${HEADINGS[this._waiting.a]}: нажмите клавишу (Esc — отмена)`
      : 'Щёлкните клавишу, чтобы назначить другую');
  }

  _button(x, y, label, onClick) {
    const btn = this.add.text(x, y, label, {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#444466', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#6666aa' }));
    btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#444466' }));
    btn.on('pointerdown', onClick);
    return btn;
  }
}
