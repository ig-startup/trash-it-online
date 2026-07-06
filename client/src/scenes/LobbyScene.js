import Phaser from 'phaser';
import SocketManager from '../network/SocketManager.js';

const EVENTS = {
  PLAYER_READY: 'player_ready',
  START_GAME: 'start_game',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_READY_CHANGED: 'player_ready_changed',
  GAME_STARTED: 'game_started',
};

/**
 * LobbyScene — waiting room before the game starts.
 *
 * init(data) expects:
 *   { players: Player[], mode: string, hostId: string, roomCode: string }
 *
 * where Player = { id, name, color, ready }
 */
export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });

    this._players = [];
    this._mode = 'coop';
    this._hostId = null;
    this._roomCode = '';
    this._isReady = false;

    this._playerListContainer = null;
    this._startBtn = null;
    this._readyBtn = null;

    // Bound listeners for cleanup
    this._onPlayerJoined = null;
    this._onPlayerLeft = null;
    this._onPlayerReadyChanged = null;
    this._onGameStarted = null;
  }

  init(data) {
    this._players = data.players ? [...data.players] : [];
    this._mode = data.mode || 'coop';
    this._hostId = data.hostId || null;
    this._roomCode = data.roomCode || SocketManager.getInstance().roomCode || '';
    this._isReady = false;
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const sm = SocketManager.getInstance();

    // ── Title ────────────────────────────────────────────────────────────────
    this.add.text(cx, 40, 'ЛОББИ', {
      fontSize: '32px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5);

    // ── Mode label ────────────────────────────────────────────────────────────
    const modeLabel = this._mode === 'race' ? 'ГОНКА' : 'КООП';
    this.add.text(cx, 80, `Режим: ${modeLabel}`, {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    // ── Room code ─────────────────────────────────────────────────────────────
    this.add.text(cx, 125, 'Код комнаты:', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);

    this.add.text(cx, 160, this._roomCode, {
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#ffdd44',
      stroke: '#aa8800',
      strokeThickness: 3,
      letterSpacing: 8,
    }).setOrigin(0.5);

    this.add.text(cx, 190, 'Поделитесь кодом с другими игроками', {
      fontSize: '13px',
      color: '#666666',
    }).setOrigin(0.5);

    // ── Player list ───────────────────────────────────────────────────────────
    this.add.text(cx, 225, 'Игроки:', {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this._playerListContainer = this.add.container(0, 250);
    this._renderPlayerList();

    // ── Ready button ──────────────────────────────────────────────────────────
    this._readyBtn = this._makeButton(cx, 490, 'ГОТОВ', () => this._toggleReady());

    // ── Start button (host only) ──────────────────────────────────────────────
    this._startBtn = this._makeButton(cx, 545, 'СТАРТ', () => this._startGame());
    this._updateStartButton();

    // Host indicator
    if (sm.isHost) {
      this.add.text(cx, 580, '★ Вы хост', {
        fontSize: '13px',
        color: '#ffdd44',
      }).setOrigin(0.5);
    }

    // ── Socket listeners ──────────────────────────────────────────────────────
    this._onPlayerJoined = (data) => {
      console.log('[LobbyScene] player_joined', data);
      const player = data.player;
      if (!this._players.find((p) => p.id === player.id)) {
        this._players.push(player);
      }
      this._renderPlayerList();
      this._updateStartButton();
    };

    this._onPlayerLeft = (data) => {
      console.log('[LobbyScene] player_left', data);
      this._players = this._players.filter((p) => p.id !== data.playerId);
      this._renderPlayerList();
      this._updateStartButton();
    };

    this._onPlayerReadyChanged = (data) => {
      console.log('[LobbyScene] player_ready_changed', data);
      const player = this._players.find((p) => p.id === data.playerId);
      if (player) {
        player.ready = data.ready;
      }
      this._renderPlayerList();
      this._updateStartButton();
    };

    this._onGameStarted = (data) => {
      console.log('[LobbyScene] game_started', data);
      this._cleanup();
      this.scene.start('GameScene', {
        levelId: data.levelId,
        players: this._players,
        mode: this._mode,
        hostId: this._hostId,
        roomCode: this._roomCode,
      });
    };

    sm.on(EVENTS.PLAYER_JOINED, this._onPlayerJoined);
    sm.on(EVENTS.PLAYER_LEFT, this._onPlayerLeft);
    sm.on(EVENTS.PLAYER_READY_CHANGED, this._onPlayerReadyChanged);
    sm.on(EVENTS.GAME_STARTED, this._onGameStarted);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _renderPlayerList() {
    this._playerListContainer.removeAll(true);

    const { width } = this.scale;
    const cx = width / 2;
    const itemH = 44;

    this._players.forEach((player, i) => {
      const y = i * itemH;

      // Color rectangle
      const color = Phaser.Display.Color.HexStringToColor(player.color || '#888888').color;
      const rect = this.add.rectangle(cx - 120, y + itemH / 2, 28, 28, color);

      // Player name
      const nameText = this.add.text(cx - 98, y + itemH / 2, player.name, {
        fontSize: '17px',
        color: '#ffffff',
      }).setOrigin(0, 0.5);

      // Ready status
      const readyLabel = player.ready ? '✓ Готов' : '…';
      const readyColor = player.ready ? '#44dd44' : '#888888';
      const readyText = this.add.text(cx + 100, y + itemH / 2, readyLabel, {
        fontSize: '15px',
        color: readyColor,
      }).setOrigin(0.5);

      this._playerListContainer.add([rect, nameText, readyText]);
    });
  }

  _toggleReady() {
    this._isReady = !this._isReady;
    const sm = SocketManager.getInstance();
    sm.emit(EVENTS.PLAYER_READY);

    // Update local state immediately
    const localPlayer = this._players.find((p) => p.id === sm.playerId);
    if (localPlayer) {
      localPlayer.ready = this._isReady;
    }

    this._readyBtn.setStyle({
      backgroundColor: this._isReady ? '#228822' : '#444466',
    });
    this._readyBtn.setText(this._isReady ? 'НЕ ГОТОВ' : 'ГОТОВ');

    this._renderPlayerList();
    this._updateStartButton();
  }

  _startGame() {
    const sm = SocketManager.getInstance();
    if (!sm.isHost) return;
    const allReady = this._players.length > 0 && this._players.every((p) => p.ready);
    if (!allReady) return;
    sm.emit(EVENTS.START_GAME);
  }

  _updateStartButton() {
    const sm = SocketManager.getInstance();
    const isHost = sm.isHost;
    const allReady = this._players.length > 0 && this._players.every((p) => p.ready);

    if (!isHost) {
      this._startBtn.setVisible(false);
      return;
    }

    this._startBtn.setVisible(true);
    const canStart = allReady;
    this._startBtn.setStyle({
      backgroundColor: canStart ? '#226622' : '#333333',
      color: canStart ? '#ffffff' : '#666666',
    });
    this._startBtn.setInteractive(canStart ? { useHandCursor: true } : false);
  }

  _makeButton(x, y, label, onClick) {
    const btn = this.add.text(x, y, label, {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#444466',
      padding: { x: 20, y: 9 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => {
      if (btn.input && btn.input.enabled) {
        btn.setStyle({ backgroundColor: '#6666aa' });
      }
    });
    btn.on('pointerout', () => {
      // Reset is handled externally via _updateStartButton / _toggleReady
    });
    btn.on('pointerdown', onClick);

    return btn;
  }

  _cleanup() {
    const sm = SocketManager.getInstance();
    sm.off(EVENTS.PLAYER_JOINED, this._onPlayerJoined);
    sm.off(EVENTS.PLAYER_LEFT, this._onPlayerLeft);
    sm.off(EVENTS.PLAYER_READY_CHANGED, this._onPlayerReadyChanged);
    sm.off(EVENTS.GAME_STARTED, this._onGameStarted);
  }

  shutdown() {
    this._cleanup();
  }
}
