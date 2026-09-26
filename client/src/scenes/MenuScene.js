import Phaser from 'phaser';
import SocketManager from '../network/SocketManager.js';

const EVENTS = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  JOIN_ERROR: 'join_error',
};

/**
 * MenuScene — main menu screen.
 * Allows the player to choose a game mode (coop / race),
 * enter a player name, create or join a room.
 */
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });

    this._selectedMode = 'coop';
    this._playerName = 'Player';
    this._roomCode = '';

    this._btnCoop = null;
    this._btnRace = null;
    this._errorText = null;

    // Bound listener references for cleanup
    this._onRoomCreated = null;
    this._onRoomJoined = null;
    this._onJoinError = null;
  }

  create() {
    const { width } = this.scale;
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

    this._btnCoop = this._makeButton(cx - 75, 195, 'КООП', () => this._setMode('coop'));
    this._btnRace = this._makeButton(cx + 75, 195, 'ГОНКА', () => this._setMode('race'));
    this._updateModeButtons();

    // ── Player name ───────────────────────────────────────────────────────────
    this.add.text(cx, 255, 'Имя игрока:', {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    const nameHint = this.add.text(cx, 285, `[ ${this._playerName} ]`, {
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

    // ── Create room ───────────────────────────────────────────────────────────
    this.add.text(cx, 355, '— Создать комнату —', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);

    this._makeButton(cx, 390, 'СОЗДАТЬ КОМНАТУ', () => this._createRoom());

    // ── Join room ─────────────────────────────────────────────────────────────
    this.add.text(cx, 450, '— Войти по коду —', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);

    const codeHint = this.add.text(cx, 480, '[ ____ ]', {
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

    this._makeButton(cx, 530, 'ВОЙТИ', () => this._joinRoom());

    // ── Error text ────────────────────────────────────────────────────────────
    this._errorText = this.add.text(cx, 580, '', {
      fontSize: '16px',
      color: '#ff4444',
    }).setOrigin(0.5);

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
      const isRace = this._selectedMode === 'race';
      this._btnRace.setStyle({ backgroundColor: isRace ? activeColor : inactiveColor });
      this._btnRace._bgColor = isRace ? activeColor : inactiveColor;
    }
  }

  _createRoom() {
    this._errorText.setText('');
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
