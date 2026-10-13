import Phaser from 'phaser';
import SocketManager from '../network/SocketManager.js';
import { PLAYER_COLORS } from '../../../shared/constants.mjs';
import BATTLES from '../../../shared/battles.json';
import LocalBattle from '../battle/LocalBattle';
import LocalArcade, { ARCADE, missionText } from '../battle/LocalArcade';

const EVENTS = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  JOIN_ERROR: 'join_error',
};

/**
 * MenuScene — main menu screen.
 * Allows the player to choose a game mode (coop / battle),
 * enter a player name, create or join a room.
 */
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });

    this._selectedMode = 'coop';
    this._localCount = 2;
    this._battleSet = 0;
    this._playerName = 'Player';
    this._roomCode = '';

    this._btnCoop = null;
    this._btnRace = null;
    this._btnArcade = null;
    this._arcadeRow = 0;
    this._arcadeTeams = 2;
    this._errorText = null;

    // Bound listener references for cleanup
    this._onRoomCreated = null;
    this._onRoomJoined = null;
    this._onJoinError = null;
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    const sm = SocketManager.getInstance();
    sm.connect();

    // ── Title ────────────────────────────────────────────────────────────────
    this.add.text(cx, 80, 'TRASH IT ONLINE', {
      fontSize: '40px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#ff4444',
      strokeThickness: 4,
    }).setOrigin(0.5);

    // ── Mode toggle ───────────────────────────────────────────────────────────
    this.add.text(cx, 155, 'Режим игры:', {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this._btnCoop = this._makeButton(cx - 150, 195, 'КООП', () => this._setMode('coop'));
    // The original's battle: a set of levels, places by the order of the
    // rings, battle points (F.EXE's game type 1).
    this._btnRace = this._makeButton(cx, 195, 'БИТВА', () => this._setMode('battle'));
    // The arcade (F.EXE game type 2): teams take turns at one K level.
    this._btnArcade = this._makeButton(cx + 150, 195, 'АРКАДА', () => this._setMode('arcade'));
    this._updateModeButtons();

    // ── At one keyboard ───────────────────────────────────────────────────────
    // The original's way of playing together: up to four at one computer,
    // each on his own six keys.
    const lx = cx - 190;
    const rx = cx + 190;
    this.add.text(lx, 255, '— За одним компьютером —', {
      fontSize: '15px',
      color: '#888888',
    }).setOrigin(0.5);
    this._countLabel = this.add.text(lx, 290, 'Игроков:', {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);
    this._countButtons = [1, 2, 3, 4].map((n, i) => this._makeButton(lx - 90 + i * 60, 330, String(n),
      () => this._setCount(n)));
    this._updateCountButtons();
    // A battle plays one of the original's five sets (F.EXE): click to pick.
    const setLabel = () => `Битва: набор ${this._battleSet + 1} из ${BATTLES.sets.length}, `
      + `${BATTLES.sets[this._battleSet].length} ур.`;
    this._setText = this.add.text(lx, 372, setLabel(), {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._setText.on('pointerdown', () => {
      this._battleSet = (this._battleSet + 1) % BATTLES.sets.length;
      this._setText.setText(setLabel());
    });
    // The arcade: which K level, and how many teams take turns at it.
    const rowLabel = () => {
      const r = ARCADE[this._arcadeRow];
      return `Уровень ${r.level.replace('level_', '')}: ${missionText(r.mission).toLowerCase()}`;
    };
    this._rowText = this.add.text(lx, 362, rowLabel(), {
      fontSize: '13px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._rowText.on('pointerdown', () => {
      this._arcadeRow = (this._arcadeRow + 1) % ARCADE.length;
      this._rowText.setText(rowLabel());
    });
    const teamsLabel = () => `Команд: ${this._arcadeTeams} (по очереди)`;
    this._teamsText = this.add.text(lx, 384, teamsLabel(), {
      fontSize: '13px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._teamsText.on('pointerdown', () => {
      this._arcadeTeams = (this._arcadeTeams % 4) + 1;
      this._teamsText.setText(teamsLabel());
    });
    this._updateSetLabel();
    this._makeButton(lx, 425, 'ИГРАТЬ', () => this._playLocal());
    this._makeButton(lx, 478, 'КЛАВИШИ', () => {
      this._cleanup();
      this.scene.start('KeysScene');
    });

    // ── Online ────────────────────────────────────────────────────────────────
    this.add.text(rx, 255, '— По сети —', {
      fontSize: '15px',
      color: '#888888',
    }).setOrigin(0.5);

    const nameHint = this.add.text(rx, 295, `[ ${this._playerName} ]`, {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333355',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    nameHint.on('pointerdown', () => {
      const input = window.prompt('Введите имя игрока:', this._playerName);
      if (input && input.trim()) {
        this._playerName = input.trim().substring(0, 16);
      }
      nameHint.setText(`[ ${this._playerName} ]`);
    });

    this._makeButton(rx, 350, 'СОЗДАТЬ КОМНАТУ', () => this._createRoom());

    const codeHint = this.add.text(rx, 410, '[ ____ ]', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333355',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    codeHint.on('pointerdown', () => {
      const input = window.prompt('Введите код комнаты (4 символа):');
      if (input) {
        this._roomCode = input.trim().toUpperCase().substring(0, 4);
      }
      codeHint.setText(this._roomCode ? `[ ${this._roomCode} ]` : '[ ____ ]');
    });

    this._makeButton(rx, 460, 'ВОЙТИ ПО КОДУ', () => this._joinRoom());

    // ── Error text ────────────────────────────────────────────────────────────
    this._errorText = this.add.text(cx, 540, '', {
      fontSize: '16px',
      color: '#ff4444',
    }).setOrigin(0.5);

    // ── Build stamp ───────────────────────────────────────────────────────────
    // Read this before reporting that nothing changed: if it does not match
    // the build you expect, the page is being served from cache.
    this.add.text(width - 8, height - 8, `build ${__BUILD_STAMP__}`, {
      fontSize: '11px',
      color: '#555566',
    }).setOrigin(1, 1);

    // ── Socket listeners ──────────────────────────────────────────────────────
    this._onRoomCreated = (data) => {
      console.log('[MenuScene] room_created', data);
      sm.playerId = data.playerId;
      sm.roomCode = data.code;
      sm.isHost = true;
      sm.mode = this._selectedMode;
      sm.playerName = this._playerName;

      this._cleanup();
      this.scene.start('LobbyScene', {
        roomCode: data.code,
        mode: this._selectedMode,
        hostId: data.playerId,
        players: [
          {
            id: data.playerId,
            name: this._playerName,
            color: data.color,
            ready: false,
          },
        ],
      });
    };

    this._onRoomJoined = (data) => {
      console.log('[MenuScene] room_joined', data);
      sm.roomCode = data.players
        ? (sm.roomCode || this._roomCode)
        : this._roomCode;
      sm.roomCode = this._roomCode;
      sm.isHost = false;
      sm.mode = data.mode;
      sm.playerName = this._playerName;
      sm.playerId = sm.socket ? sm.socket.id : null;

      this._cleanup();
      this.scene.start('LobbyScene', {
        roomCode: this._roomCode,
        mode: data.mode,
        hostId: data.hostId,
        players: data.players,
      });
    };

    this._onJoinError = (data) => {
      console.warn('[MenuScene] join_error', data);
      this._errorText.setText(data.message || 'Ошибка входа в комнату');
    };

    sm.on(EVENTS.ROOM_CREATED, this._onRoomCreated);
    sm.on(EVENTS.ROOM_JOINED, this._onRoomJoined);
    sm.on(EVENTS.JOIN_ERROR, this._onJoinError);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _makeButton(x, y, label, onClick) {
    const btn = this.add.text(x, y, label, {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#444466',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#6666aa' }));
    btn.on('pointerout', () => btn.setStyle({ backgroundColor: btn._bgColor || '#444466' }));
    btn.on('pointerdown', onClick);

    return btn;
  }

  _setMode(mode) {
    this._selectedMode = mode;
    this._updateModeButtons();
    this._updateSetLabel();
  }

  /** The battle set picker only means something in a battle. */
  _updateSetLabel() {
    const arcade = this._selectedMode === 'arcade';
    if (this._setText) this._setText.setVisible(this._selectedMode === 'battle');
    if (this._rowText) this._rowText.setVisible(arcade);
    if (this._teamsText) this._teamsText.setVisible(arcade);
    // in the arcade the count is of the players in each team
    if (this._countLabel) this._countLabel.setText(arcade ? 'Игроков в команде:' : 'Игроков:');
  }

  _updateModeButtons() {
    const activeColor = '#aa44aa';
    const inactiveColor = '#444466';

    if (this._btnCoop) {
      const isCoop = this._selectedMode === 'coop';
      this._btnCoop.setStyle({ backgroundColor: isCoop ? activeColor : inactiveColor });
      this._btnCoop._bgColor = isCoop ? activeColor : inactiveColor;
    }
    if (this._btnRace) {
      const isRace = this._selectedMode === 'battle';
      this._btnRace.setStyle({ backgroundColor: isRace ? activeColor : inactiveColor });
      this._btnRace._bgColor = isRace ? activeColor : inactiveColor;
    }
    if (this._btnArcade) {
      const isArcade = this._selectedMode === 'arcade';
      this._btnArcade.setStyle({ backgroundColor: isArcade ? activeColor : inactiveColor });
      this._btnArcade._bgColor = isArcade ? activeColor : inactiveColor;
    }
  }

  _setCount(n) {
    this._localCount = n;
    this._updateCountButtons();
  }

  _updateCountButtons() {
    (this._countButtons || []).forEach((btn, i) => {
      const color = i + 1 === this._localCount ? '#aa44aa' : '#444466';
      btn.setStyle({ backgroundColor: color });
      btn._bgColor = color;
    });
  }

  /** Straight into the game, everyone at this keyboard — no server. */
  _playLocal() {
    const players = PLAYER_COLORS.slice(0, this._localCount).map((color, i) => ({
      id: `p${i + 1}`, name: `ИГРОК ${i + 1}`, color, pad: i,
    }));
    if (this._selectedMode === 'battle') {
      // the original's battle is for two to four
      if (players.length < 2) {
        this._errorText.setText('Битва — от двух игроков');
        return;
      }
      const localBattle = new LocalBattle(this._battleSet, players.map((p) => p.id));
      const first = localBattle.current();
      this._cleanup();
      this.scene.start('GameScene', {
        players, mode: 'battle', myPlayerId: players[0].id, local: true,
        localBattle, levelId: first.level, battle: first.battle,
      });
      return;
    }
    if (this._selectedMode === 'arcade') {
      // every team plays with the same players' keys, one team after another
      const arcade = new LocalArcade(this._arcadeRow, this._arcadeTeams);
      this._cleanup();
      this.scene.start('GameScene', {
        players, mode: 'arcade', myPlayerId: players[0].id, local: true,
        arcade, levelId: arcade.entry.level,
      });
      return;
    }
    this._cleanup();
    this.scene.start('GameScene', {
      players, mode: this._selectedMode, myPlayerId: players[0].id, local: true,
    });
  }

  _createRoom() {
    this._errorText.setText('');
    if (this._selectedMode === 'arcade') {
      this._errorText.setText('Аркада пока только за одним компьютером');
      return;
    }
    const sm = SocketManager.getInstance();
    sm.emit(EVENTS.CREATE_ROOM, {
      mode: this._selectedMode,
      playerName: this._playerName,
    });
  }

  _joinRoom() {
    this._errorText.setText('');
    if (!this._roomCode || this._roomCode.length !== 4) {
      this._errorText.setText('Введите 4-значный код комнаты');
      return;
    }
    const sm = SocketManager.getInstance();
    sm.emit(EVENTS.JOIN_ROOM, {
      code: this._roomCode,
      playerName: this._playerName,
    });
  }

  _cleanup() {
    const sm = SocketManager.getInstance();
    sm.off(EVENTS.ROOM_CREATED, this._onRoomCreated);
    sm.off(EVENTS.ROOM_JOINED, this._onRoomJoined);
    sm.off(EVENTS.JOIN_ERROR, this._onJoinError);
  }

  shutdown() {
    this._cleanup();
  }
}
