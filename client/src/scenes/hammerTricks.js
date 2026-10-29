import { ComboWatcher, sequencesFor, WORD } from './combos';
import LooseHammer from './looseHammer';
import Apocalypse from './apocalypse';

/**
 * The hammers' tricks — see docs/re/jack/combos.md. Owns, for every Jack
 * at this keyboard, the key sequences of his hammer (combos.js), what the
 * armed flag does when a state spends it (Player._spendTrick), and the
 * hammer when it has left his hands (looseHammer.js, apocalypse.js).
 *
 * | sequence | does |
 * |---|---|
 * | arm (all hammers) | the flag; in the hard hat: flies back to the flag |
 * | warp (all hammers) | `warp_to_bell` (VA 0x1e037): to the bell, a cheat |
 * | sledge (20) | the flag; spent by an overhead windup: the sledge trick |
 * | apocalypse (29) | the flag; spent by a sideways windup: the apocalypse |
 * | dragon (33) | `dragon_sequence` (0x204c3): the dragon show |
 * | moola (34) | `moola_demolition` (0x204f4): the level is demolished |
 */
const HZ = 60;
const HAT_FLASH = 0xdc;          // jack_in_hat: palette levels 220 (VA 0x24727)
const HAT_CAMERA_TICKS = 0x46;   // …and the camera held where he was for 70 ticks
const FLAG_FLASH = 200;          // jack_stand: the hammer sent to the flag
const FLAG_NEAR_HAMMER = { r: 60, up: 25 };   // touching_own_flag_2 (VA 0x1f625)
const WARP_UP = 10;              // warp_to_bell: 10 px above the bell

export default class HammerTricks {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} hammer  the catalogue index every Jack here swings
   * @param {object} env  what the scene gives the tricks to work with
   * @param {() => {x: number, y: number}|null} env.bell  the bell's spot
   * @param {() => void} env.dragon  sequence_start: the dragon show
   * @param {(player: any) => void} env.moola  the demolition count and its camera
   * @param {(x: number, y: number, ticks: number) => void} env.camPoint
   * @param {(levels: {r: number, g: number, b: number}) => void} env.flash  palette levels at once
   * @param {() => any[]} env.solids  LooseObjects' rectangles
   * @param {(rects: any[], x: number, y: number, from: number) => any} env.floorAt
   * @param {() => number} env.ground
   * @param {(hit: object) => void} env.impact  a heavy hammer striking a block
   * @param {(follow: object, ticks: number, opts?: object) => {ticks: number}} env.camTrack
   * @param {() => void} env.shake
   * @param {() => ({x: number, y: number, width: number}|null)} env.cam
   * @param {(hold: object|null) => void} env.camHold
   * @param {(x: number, y: number, force: number, mask: number) => {struck: boolean, broke: boolean}} env.blowAt
   */
  constructor(scene, hammer, env) {
    this._scene = scene;
    this._hammer = hammer;
    this._env = env;
    this._jacks = [];
  }

  /** @param {{player: any, pad: any}} j  one Jack at this keyboard */
  add(j) {
    const own = {
      j, acc: 0, word: 0, upWas: false, loose: null, flight: null,
    };
    own.watcher = new ComboWatcher(sequencesFor(this._hammer), (name) => this._fire(own, name));
    const { player } = j;
    player.canRetrieveHammer = () => !!own.loose && own.loose.overOwner();
    player.on('sledge_slam', () => this._slam(own));
    player.on('trick', (kind) => { if (kind === 'apocalypse') this._apocalypse(own); });
    player.on('hat_to_flag', ({ x, y }) => {
      this._env.flash({ r: HAT_FLASH, g: HAT_FLASH, b: HAT_FLASH });
      this._env.camPoint(x, y, HAT_CAMERA_TICKS);
    });
    player.on('hammer_retrieved', () => {
      if (own.loose) own.loose.takenBack();
      own.loose = null;
    });
    this._jacks.push(own);
  }

  /** The input word as the game has it: L R U D BUT1 BUT2 = 1 2 4 8 0x10 0x20. */
  static wordOf(pad) {
    return (pad.left.isDown ? WORD.LEFT : 0) | (pad.right.isDown ? WORD.RIGHT : 0)
      | (pad.up.isDown ? WORD.UP : 0) | (pad.down.isDown ? WORD.DOWN : 0)
      | (pad.but1.isDown ? WORD.BUT1 : 0) | (pad.but2.isDown ? WORD.BUT2 : 0);
  }

  /**
   * combos_check, before the Jack's state runs (jack_frame_setup, VA 0x2187b):
   * every sequence steps once per original tick.
   */
  before(delta) {
    this._jacks.forEach((own) => {
      own.word = HammerTricks.wordOf(own.j.pad);
      for (own.acc += (delta * HZ) / 1000; own.acc >= 1; own.acc -= 1) own.watcher.step(own.word);
    });
  }

  /** hammer_tricks_disarm (VA 0x2ba7d): the flag lasts one tick. */
  after() {
    this._jacks.forEach((own) => { own.j.player.trickArmed = false; });
  }

  /** @param {number} delta ms */
  update(delta) {
    this._jacks.forEach((own) => {
      if (own.loose) own.loose.update(delta);
      if (own.flight) own.flight.update(delta);
      this._upAtFlag(own);
    });
  }

  _fire(own, name) {
    switch (name) {
      case 'arm': case 'sledge': case 'apocalypse':
        own.j.player.trickArmed = true;            // arm_hammer_trick (0x1dead)
        break;
      case 'warp': this._warp(own.j.player); break;
      case 'dragon': this._env.dragon(); break;
      case 'moola': this._env.moola(own.j.player); break;
      default: break;
    }
  }

  /** warp_to_bell (VA 0x1e037): the bell's spot, 10 px above. His speed is left as it was. */
  _warp(player) {
    const spot = this._env.bell();
    if (!spot) return;
    const { x, y } = player.body.velocity;
    player.body.reset(spot.x, spot.y - WARP_UP);
    player.body.setVelocity(x, y);
  }

  _hooks() {
    return {
      solids: this._env.solids,
      floorAt: this._env.floorAt,
      ground: this._env.ground(),
      impact: this._env.impact,
      camTrack: this._env.camTrack,
      shake: this._env.shake,
    };
  }

  /** sledge_v3_trick's 8th tick: the sledge leaves his hands (VA 0x2a4d8). */
  _slam(own) {
    const { player } = own.j;
    if (own.loose) own.loose.destroy();
    player.loseHammer();
    own.loose = new LooseHammer(this._scene, player, this._hooks());
    own.loose.slam();
  }

  /** apocalypse_start (VA 0x15260). */
  _apocalypse(own) {
    if (own.flight) return;
    const { player } = own.j;
    if (own.loose) own.loose.destroy();
    own.loose = new LooseHammer(this._scene, player, this._hooks());
    own.loose.flip = player.facingLeft;
    const env = this._env;
    own.flight = new Apocalypse(own.loose, {
      word: () => own.word,
      cam: () => env.cam() || { x: player.x, y: player.y, width: 320 },
      hold: env.camHold,
      track: (f) => env.camTrack(f, 1e9, { priority: true }),
      point: env.camPoint,
      blowAt: env.blowAt,
      shake: env.shake,
      ground: env.ground(),
      done: () => { own.flight = null; },
    });
  }

  /**
   * jack_stand (VA 0x22892): UP pressed alone, standing at his flag with his
   * loose hammer lying somewhere else, sends it to the flag — the palette
   * flashes and his timmies go up as angels.
   */
  _upAtFlag(own) {
    const { player, pad } = own.j;
    const up = pad.up.isDown;
    const pressed = up && !own.upWas;
    own.upWas = up;
    const hm = own.loose;
    if (!pressed || !hm || own.word !== WORD.UP || player.state !== 'stand') return;
    if (!player.hammerAway || hm.mode !== 'lying' || hm.busy || !player.atOwnFlag()) return;
    const flag = player.flag;
    const near = Math.abs(hm.x - flag.x) < FLAG_NEAR_HAMMER.r
      && Math.abs(hm.y - FLAG_NEAR_HAMMER.up - flag.y) < FLAG_NEAR_HAMMER.r;
    if (near || !hm.sendToFlag()) return;
    this._env.flash({ r: FLAG_FLASH, g: FLAG_FLASH, b: FLAG_FLASH });
    player.emit('spill', 1e9);
  }

  destroy() {
    this._jacks.forEach((own) => { if (own.loose) own.loose.destroy(); });
    this._jacks = [];
  }
}
