import Phaser from 'phaser';
import {
  ensureJackTextures, applyJackFrame, PLAYER_WIDTH, FULL_HEIGHT,
} from './drawJack';
import {
  PROP_ANIMS, PROP_FRAME_INFO, HAMMER_BY_SLOT, HOOVER_BY_SLOT, hasProps,
} from './props';
import { JACK_FRAME_INFO, JACK_SCALE } from './jackSprites';
import { MAX_CHARGE } from '../../../shared/constants.mjs';

/**
 * The original's physics, in its own units: pixels per frame, and pixels
 * per frame squared, at its own tick rate. Our levels are its pixels 1:1,
 * so the only conversion needed is that rate.
 *
 * `ORIGINAL_HZ` is the game's tick: one logic frame per vertical retrace
 * (main loop VA 0x2c654 → 0x2cb6e), and both of its video set-ups are
 * 480-line modes that retrace at 60Hz. It only falls back on a 13ms
 * catch-up step when the machine cannot keep up. See "Movement and
 * gravity" in scripts/formats/README.md.
 */
const ORIGINAL_HZ = 60;
const GRAVITY = 0.28125 * ORIGINAL_HZ * ORIGINAL_HZ;  // VA 0x22d31: vy += 0x4800
const TERMINAL = 24 * ORIGINAL_HZ;                    // clamped at 0x180000
const JUMP = -4.5 * ORIGINAL_HZ;                      // VA 0x22bc5, out of the walk
/**
 * Holding the jump key lifts him further (state 0x22b91): from the eighth
 * tick on, while the key stays down and he is still rising, `vy -= boost`,
 * the boost starting at 0x5400 and shrinking by 0x6f0 a tick until it is
 * spent — about twelve ticks. A tap is the bare 36 px hop; a held jump
 * goes roughly half as high again.
 */
const JUMP_BOOST = 0x5400;
const JUMP_BOOST_DECAY = 0x6f0;
const JUMP_BOOST_AFTER = 7;      // ticks
/**
 * The hop nearly every state in the game can do: -2.0 px/frame, which
 * lifts him seven pixels. Not a jump — a stumble over a kerb. Kept here
 * because it turns up in almost every one of the 46 states and is the
 * only other upward impulse in the game, so it is worth not
 * rediscovering. Nothing uses it yet.
 */
// eslint-disable-next-line no-unused-vars
const STEP_UP = -2.0 * ORIGINAL_HZ;

/** 16.16 per tick → px/s, and per tick² → px/s². */
const perS = (v) => (v / 65536) * ORIGINAL_HZ;
const perS2 = (v) => (v / 65536) * ORIGINAL_HZ * ORIGINAL_HZ;
const TICK_MS = 1000 / ORIGINAL_HZ;

/**
 * Top speed and acceleration belong to the animation being played, not to
 * Jack: `play_anim` copies them in from a table of eight (VA 0xa10d4 →
 * 0xa1172). These are the two the clone's states use.
 */
const PROFILES = {
  // profile 1 — the run, standing, the skid
  run: { top: perS(350000), accel: perS2(12000), turn: perS2(12000) },
  // profile 0 — the windups and strikes, the hat, the hoover
  slow: { top: perS(100000), accel: perS2(4000), turn: perS2(8000) },
  // profile 4 — pushing
  push: { top: perS(200000), accel: perS2(8000), turn: perS2(10000) },
};
const EASE_INTO_TOP = 1 / 32;      // the original's `>> 5` above the cap
const FRICTION = perS2(2000);      // every tick, keys or not (VA 0x22d31)
const AT_REST = perS(399);         // below this the shared step stops him
const SKID_BRAKE = perS2(5000);    // the skid brakes on its own (VA 0x2266d)
const SKID_STOP = perS(10000);     // …and hands over to standing below this
const WINDUP_NUDGE = perS(0x8000); // a tap of a direction while winding up
const MAX_STEP_MS = 50;         // ignore hitches longer than this
const FALL_VELOCITY = 80;       // downward speed at which rising becomes falling
const ANIM_CATCHUP_LIMIT = 8;   // frames one tick may make up after a hitch

/**
 * Jack's states, and the animation each one shows.
 *
 * The game keeps 46 of these, one function apiece, and switching is a
 * single call; `scripts/formats/states.py` lifts the whole graph out of
 * `G.EXE` and `scripts/formats/anims.py` gives each state's animation.
 * The ones below are the states the clone has mechanics for, named after
 * the game's own and using its animation slots — the addresses are the
 * state functions they correspond to.
 *
 * Writing this as flags and timers instead is what made the skid play
 * twice, the strikes look wrong, and the hard hat need a key held down.
 *
 * `loop` keeps the animation running; without it the state ends when the
 * animation does and hands over to `next`, unless `hold` keeps it on its
 * last frame for the logic to end. `locks` means input is ignored until
 * then. `profile` is the movement profile the game's animation carries.
 * `slot` is the game's own animation slot, which also picks the hammer's
 * frames (a strike's is `slotFrom` + its charge).
 *
 * The slot numbers are `play_anim`'s own. Until 2026-10-06 these comments
 * used a table read eight bytes early, and named every state after the
 * animation two slots along — see scripts/formats/anims.py.
 */
/** Slot 70 / 71 as (pose, frame) pairs: hatReach is sheet frames 71-90, hooverOut 113-122. */
const range = (pose, from, to) => {
  const out = [];
  for (let i = from; from <= to ? i <= to : i >= to; i += from <= to ? 1 : -1) out.push([pose, i]);
  return out;
};
const SHEET_STRIP_DRAW = [...range('hatReach', 0, 10), ['hatReach', 10], ...range('hooverOut', 9, 0)];
const SHEET_STRIP_STOW = [...range('hooverOut', 0, 9), ['hatReach', 10], ['hatReach', 10],
  ...range('hatReach', 9, 0)];
// Slots 11 and 10: the hammer out of the hat (sheet 90-81, 81, 80-71) and
// back in (71-90). Their hammer lists carry the show / hide flags.
const HAMMER_STRIP_DRAW = [...range('hatReach', 19, 10), ['hatReach', 10], ...range('hatReach', 9, 0)];
const HAMMER_STRIP_STOW = range('hatReach', 0, 19);

const STATES = {
  // 0x22892, slot 1 — standing, the hub nearly everything returns to
  stand: { slot: 1, anim: 'idle', ms: 400, loop: true, profile: 'run' },
  // 0x22275, slot 0 — the run, empty-handed
  walk: { slot: 0, anim: 'run', ms: 70, loop: true, profile: 'run' },

  // The hammer is a mode. 0x22fa5 takes it out of the hard hat (slot 11)
  // and 0x2320a puts it back (slot 10); with it Jack stands in 0x23499
  // (slot 4, sheet frame 34) and walks the slower cycle of 0x236b9 (slot 3).
  hammerDraw: { slot: 11, strip: HAMMER_STRIP_DRAW, ms: 35, next: 'hammerStand', locks: true, brakes: true },
  hammerStow: { slot: 10, strip: HAMMER_STRIP_STOW, ms: 35, next: 'stand', locks: true, brakes: true },
  hammerStand: { slot: 4, anim: 'standHammer', ms: 400, loop: true, armed: true, profile: 'slow' },
  hammerWalk: { slot: 3, anim: 'walkHammer', ms: 70, loop: true, armed: true, profile: 'slow' },
  // 0x2266d, slot 2 — a frame every fourth tick, held on the last until
  // the braking has stopped him
  skid: { slot: 2, anim: 'skid', ms: 4 * TICK_MS, hold: true, profile: 'run' },
  // 0x23a27, slot 6 — the sideways windup. Its frames step with the charge,
  // not with a clock, so `ms` is unused.
  windupSide: { slot: 6, anim: 'hammerSide', ms: Infinity, hold: true, profile: 'slow' },
  // 0x23cef, slots 15-21 — the strike, one frame a tick; which of the two
  // frame lists depends on the charge (see SIDE_STRIKES)
  strikeSide: { slotFrom: 15, anim: 'hammerSide', ms: TICK_MS, next: 'hammerStand', locks: true, brakes: true },
  // 0x23f0f, slot 7 — the overhead windup
  windupOver: { slot: 7, anim: 'hammerOver', ms: Infinity, hold: true, profile: 'slow' },
  // 0x24174, slots 24-27 — the overhead swing, padded longer the more it
  // was charged (see OVER_STRIKES)
  strikeOver: { slotFrom: 24, anim: 'hammerOver', ms: TICK_MS, next: 'hammerStand', locks: true, brakes: true },
  // 0x25813, slot 31 — in the air
  fall: { slot: 31, anim: 'fall', ms: 80, loop: true, profile: 'slow' },
  // 0x25a3e, slot 32 — hitting the ground
  land: { slot: 32, anim: 'land', ms: 45, next: 'stand' },
  // 0x22b91, slot 5 — the jump: frames 6-12 of the sheet, which sit inside
  // the run pose, a frame every fourth tick and held on the last
  rise: { slot: 5, anim: 'run', frames: [5, 6, 7, 8, 9, 10, 11], ms: 4 * TICK_MS, hold: true, profile: 'run' },
  // The hard hat: 0x24346 (slot 12) to duck in, 0x24727 / 0x2498a (slots
  // 22, 23) still and moving, 0x244c0 (slot 13) to come back out. The
  // states loop among themselves until he does, so Down toggles it.
  hatIn: { slot: 12, anim: 'helmetIn', ms: 45, next: 'hat', locks: true },
  hat: { slot: 23, anim: 'helmetMove', ms: 60, loop: true, profile: 'slow' },
  hatOut: { slot: 13, anim: 'helmetIn', ms: 45, next: 'stand', locks: true, reverse: true },

  // The hoover. 0x2a88c draws it in one strip, slot 70: Jack reaches into
  // his hard hat (sheet frames 71-81) and pulls the hoover out (122-113);
  // the hammer goes into the hat on the way. Then he carries it — 0x24e55
  // standing (slot 28), 0x250d9 walking (slot 29), profile 0, so it slows
  // him to a walk — until 0x2ab7a puts it away, slot 71, the same strip
  // backwards. Both are frames of two of the client's poses, hence `strip`.
  hooverDraw: {
    slot: 70, strip: SHEET_STRIP_DRAW, ms: 35, next: 'hooverIdle', locks: true,
  },
  hooverIdle: { slot: 28, anim: 'hooverIdle', ms: 400, loop: true, hoover: true, profile: 'slow' },
  hooverWalk: { slot: 29, anim: 'hooverWalk', ms: 70, loop: true, hoover: true, profile: 'slow' },
  hooverStow: {
    // …and the strip brings the hammer back out of the hat (its list sets
    // the show flag), so he ends up holding it.
    slot: 71, strip: SHEET_STRIP_STOW, ms: 35, next: 'hammerStand', locks: true,
  },

  // Carrying. 0x267e3 / 0x26971 bend down and search while Down is held
  // (slots 44, 50 — frames 223-224), then lift (45, the whole 223-230);
  // 0x26fe0 stands holding it overhead (slot 40), 0x270e1 walks with it
  // (37), 0x27a94 is in the air with it (48). From standing, Down puts it
  // down (0x27356, slot 45) and Up takes aim (0x2767d, slot 47); a button
  // lets fly (0x27954, slot 41). No hammer list belongs to any of these
  // slots: his hands are full.
  pickBend: { slot: 44, anim: 'pickUp', frames: [0, 1], ms: 2 * TICK_MS, hold: true, brakes: true },
  pickUp: { slot: 45, anim: 'pickUp', ms: 2 * TICK_MS, next: 'carryIdle', locks: true, brakes: true },
  carryIdle: { slot: 40, anim: 'carryIdle', ms: 400, loop: true, carry: true, profile: 'slow' },
  carryWalk: { slot: 37, anim: 'carryWalk', ms: 70, loop: true, carry: true, profile: 'slow' },
  carryFall: { slot: 48, anim: 'carryWalk', ms: 70, loop: true, carry: true, profile: 'slow' },
  putDown: { slot: 45, anim: 'pickUp', ms: 2 * TICK_MS, next: 'stand', locks: true, brakes: true, reverse: true },
  // The aim's frames step with its own schedule (see THROW), so `ms` is unused.
  throwAim: { slot: 47, anim: 'throwAim', ms: Infinity, hold: true, carry: true },
  throwRelease: { slot: 41, anim: 'throwRelease', ms: 4 * TICK_MS, next: 'stand', locks: true, brakes: true },

  // A falling block on him (VA 0x21aef). Pinned under it: 0x29c92 (slot
  // 62, the standing frame, squashed) or, in the hard hat, 0x29e16 (slot
  // 68, the hat). Then flattened, 0x29f7a (slot 65), and the tumble back
  // up, 0x2a2fe (slot 64) — or out of the hat with a wobble, 0x2a199.
  pinned: { slot: 62, anim: 'idle', ms: Infinity, hold: true, crushed: true },
  pinnedHat: { slot: 68, anim: 'helmetMove', frames: [0], ms: Infinity, hold: true, crushed: true },
  flattened: { slot: 65, anim: 'flat', ms: Infinity, hold: true, crushed: true },
  hatPop: { slot: 69, anim: 'helmetMove', frames: [0], ms: Infinity, hold: true, crushed: true },
  tumble: { slot: 64, anim: 'tumble', ms: 3 * TICK_MS, next: 'stand', locks: true, brakes: true },

  // Ladders. 0x25bda climbs (slot 33), its frame picked by his height, not
  // a clock; 0x299b6 tops out onto the platform (slot 60) and 0x29b15 steps
  // off a top onto the ladder (slot 61, the same list backwards). Their
  // frames are set by the ladder logic, so `ms` is unused.
  climb: { slot: 33, anim: 'climb', ms: Infinity, hold: true, ladder: true },
  topOut: { slot: 60, anim: 'topOut', ms: Infinity, hold: true, ladder: true },
  stepOn: { slot: 61, anim: 'topOut', ms: Infinity, hold: true, ladder: true },

  // Pushing. Up held on the run goes into 0x2820b (slot 38): arms out,
  // leaning in, his frame picked by his x; slowing to a stop there, or Up
  // held standing, is 0x28691 (slot 52), the same stance still. Both take
  // hold of what can be pushed — see `pushing`.
  push: { slot: 38, anim: 'push', ms: Infinity, hold: true, push: true, profile: 'push' },
  pushStand: { slot: 52, anim: 'pushStand', ms: 400, loop: true, push: true, profile: 'push' },

  // Caught on a sucker's cup (VA 0x194d6 sets his `+0x40 |= 0x400020` and
  // holds him there) until it throws him. Which frame he shows there is
  // not traced; the fall's is ours.
  caught: { slot: 31, anim: 'fall', ms: Infinity, hold: true, caught: true },
};

/**
 * Pushing (0x2820b): pushing back the other way faster than this skids
 * him (0x2bf20, 2.75 px/tick); with no direction he brakes by the skid's
 * 5000 a tick until under 10000, then stands in the stance (0x283da).
 */
const PUSH_SKID = perS(0x2bf20);

/**
 * Ladders (see "Ladders" in scripts/formats/README.md). He climbs at 2
 * px/tick either way. Topping out and stepping off a top each run twelve
 * frames two ticks apart, lifting him by half a frame's entry in the table
 * at VA 0xa130e a tick — 25 px in all — before he is set on the top. Off a
 * ladder by any way but the top, he cannot catch hold of one in the air
 * for 15 ticks (`+0x15c`). From a run or in the air he catches one only
 * slower than 5 px/tick.
 */
const LADDER_TOP = 5;   // the ladder probe's answer at a ladder's top
const LADDER = {
  climb: 2,
  stepTicks: 2,
  lift: [0, -2, -3, 0, 0, -1, -3, -3, -3, -3, -2, -5],
  frames: 12,
  stepDown: 9,          // 0x29b15 drops him this far onto the ladder at once
  belowTop: 31,         // …and leaves him this far under the top's edge
  regrab: 15,
  topOutRise: 25,       // what the strip lifts him, should there be no top
  probeUp: 30,          // the ladder probe's row, over his feet (box 0xa0264)
  grabSpeed: perS(0x50000),
};

/**
 * Under a falling block (see "A falling block on Jack" in the formats
 * README). Squash is the block's descent since it touched him; past 32 px
 * he shoots out. Flattened he lies 150 ticks, flapping ±0x3000 a tick with
 * 0x1500 of friction; out of the hat he falls at half gravity while his
 * width and height spring back (kicked 0x28000 / -0x20000, each pulled
 * back by half its offset a tick).
 */
const CRUSH = {
  squashOut: 32,
  popOut: -6,          // px/tick, without the hat
  popHat: -4,          // px/tick, in it
  flatTicks: 150,
  flap: 0x3000 / 65536,
  flapFriction: 0x1500 / 65536,
  flatFriction: 4000 / 65536,
  wobbleW: 0x28000 / 65536,
  wobbleH: -0x20000 / 65536,
};

/** States in which the hoover is out and sucking. */
const HOOVER_STATES = new Set(['hooverIdle', 'hooverWalk']);

/**
 * Picking up (VA 0x26971 → 0x21d51): the game searches the sprites whose
 * template category has bit 0 — dynamite of the hammer kind, `LEAD`, the
 * saws, timmies — and takes the first that Jack's frame overlaps and whose
 * frame holds his grab point, 11 px ahead of his feet and 5 up (VA 0xa0288).
 *
 * Throwing (0x2767d, then 0x27954): while he aims, the throw's frame steps
 * 3, 8, 13 ticks apart up to the last, and only then is the arc drawn
 * (VA 0x15bcb). A direction ahead or back moves the reach index (0..31,
 * from 16), Up and Down the lift index (0..7, from 4), one a tick; the
 * object leaves at `vx = ±reach[i]`, `vy = -lift[j]` px/tick, from 10 px
 * ahead of him and 41 up. Tables at VA 0x93eb0 and 0x93f30.
 */
export const THROW = {
  reach: Array.from({ length: 32 }, (_, i) => 0.5 + (2.5 * i) / 31),
  lift: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
  reachStart: 16,
  liftStart: 4,
  frameSteps: [3, 8, 13],   // ticks into the aim at which its frame steps
  fromAhead: 10,
  fromUp: 41,
};
const GRAB_AHEAD = 11;
const GRAB_UP = 5;
/** Where a carried object sits: on his head. Ours — the game's is not traced. */
export const CARRY_UP = 41;

/**
 * Holding the hammer key winds up; letting go strikes. The frame index of
 * the windup *is* the charge: it steps when the frame timer reaches a
 * threshold that grows with every step (VA 0x23a66, 0x23f4d).
 */
const WINDUPS = {
  // sideways: steps 1, 2, 3 … ticks apart, full (6) after 21 ticks
  windupSide: { first: 1, grow: 1, max: MAX_CHARGE, strike: 'strikeSide' },
  // overhead: 5, 10, 15 ticks apart, full (3) after 30
  windupOver: { first: 5, grow: 5, max: 3, strike: 'strikeOver' },
};

/**
 * The strikes' frame lists, as indices into the client's pose, and the
 * frames on which the blow lands. Sideways: slots 15-18 share the short
 * list and 19-21 the long one, so charge picks one (VA 0x23cef plays slot
 * 15 + charge); the blow lands on the first frame 54. Overhead: slot
 * 24 + charge, and the blow lands on every frame the list flags (0x8000).
 * All read out of the animation table by scripts/formats/anims.py.
 */
const SIDE_SHORT = [10, 12, 14, 17, 17, 17, 17, 14, 12];
const SIDE_LONG = [10, 12, 14, 16, 17, 17, 17, 17, 17, 16, 15, 14, 13, 12, 11, 10, 9];
const SIDE_STRIKES = (charge) => (charge <= 3
  ? { seq: SIDE_SHORT, impacts: [3] }
  : { seq: SIDE_LONG, impacts: [4] });
const OVER_FAST = [4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const OVER_STRIKES = [
  { seq: OVER_FAST, impacts: [2, 3] },
  { seq: OVER_FAST, impacts: [2, 3] },
  { seq: [4, 4, 5, 6, 7, 7, 7, 7, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15, 15], impacts: [3, 4] },
  {
    seq: [4, 4, 4, 5, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 10, 10, 11, 12, 13,
      14, 14, 15, 15, 15, 15],
    impacts: [5, 6],
  },
];

// A hammer-list word: the SPA.SPR frame, and two sticky switches.
const HAMMER_FRAME = 0x3fff;
const HAMMER_HIDE = 0x4000;
const HAMMER_SHOW = 0x8000;

const HITBOX_TEXTURE = 'jack_hitbox';

/**
 * A blank texture the exact size of Jack's body. The player object itself
 * wears it and stays invisible: its only job is physics and hit tests, so
 * its size never changes. The visible frames live on a separate image (see
 * `art` below), because the real sheet frames differ in size from pose to
 * pose and would otherwise drag the physics body around with them.
 */
function ensureHitboxTexture(scene) {
  if (scene.textures.exists(HITBOX_TEXTURE)) return;
  const gfx = scene.make.graphics({ x: 0, y: 0, add: false });
  gfx.generateTexture(HITBOX_TEXTURE, PLAYER_WIDTH, FULL_HEIGHT);
  gfx.destroy();
}

/**
 * Player — local player entity, "Jack" the construction worker.
 *
 * Drawn with the real frames decoded from the original 1997 sprite sheet
 * (see jackSprites.js), recoloured per player; falls back to the hand-drawn
 * frame set in drawJack.js if those aren't loaded.
 */
export default class Player extends Phaser.Physics.Arcade.Image {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color, e.g. '#ff4444' — the overalls colour
   * @param {string} playerId
   * @param {boolean} isLocal
   */
  constructor(scene, x, y, color, playerId, isLocal = true) {
    ensureHitboxTexture(scene);
    super(scene, x, y, HITBOX_TEXTURE);

    /** @type {Record<string, string[]>} pose name → texture keys */
    this._frames = ensureJackTextures(scene, playerId, color);
    this.playerId = playerId;
    this.playerColor = color;
    this.isLocal = isLocal;

    /** Current state — a key of STATES, named after the game's own. */
    this.state = 'stand';

    this._bellHit = false; // prevent repeated bell events
    this._animTimer = 0;
    this._animFrame = 0;
    this._facingLeft = false;
    this._seq = null;          // a strike's own frame list, while it plays
    this._impacts = null;      // …and the frames its blow lands on
    this._strikeCharge = 0;
    this._charge = 0;          // the windup's charge, which is its frame
    this._chargeTicks = 0;
    this._chargeStep = 0;
    this._skidVx = 0;          // the skid's speed last tick, for the bounce
    this._jumpBoost = 0;       // what is left of a held jump's extra lift
    this._hammerHidden = true;  // in the hat, per the game's list flags
    this._hammerOut = false;    // the hammer mode: out of the hat, in hand
    this._jumpTicks = 0;

    /** What he holds overhead — an opaque handle the scene owns — or null. */
    this.carried = null;
    /**
     * Set by the scene: given the grab point, the thing there that can be
     * picked up, or null.
     * @type {null | ((x: number, y: number) => any)}
     */
    this.findPickup = null;
    /**
     * Set by the scene: the falling block over his head, if any, as
     * `{ id, bottom, vy }` — vy in px/tick (VA 0x60a00 reads the map the
     * falling groups are stamped into).
     * @type {null | (() => ({id: any, bottom: number, vy: number} | null))}
     */
    this.findCrusher = null;
    this._crush = null;        // the pin: which block, and where it touched
    this._squashX = 1;         // art scale on top of the frame's own
    this._squashY = 1;
    this._reach = THROW.reachStart;
    this._lift = THROW.liftStart;
    this._aimTicks = 0;
    /**
     * Set by the scene: the probes his ladder states make of the tile map —
     * `at(x, feet)` the ladder probe (0, 4 or 5), `topUnder(x, feet)` a
     * ladder's top under him, `topAt(x, y)` the top of the block at a point,
     * `floor(x, from, to)` what stops him climbing down.
     */
    this.ladder = null;
    this._regrab = 0;          // ticks before he may catch a ladder in the air
    this._ladderTicks = 0;     // into a top-out or a step-off
    this._ladderTarget = 0;    // the y it ends on

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(PLAYER_WIDTH, FULL_HEIGHT);
    // The game clamps falling at 24 px/frame (0x180000 in 16.16).
    this.body.setMaxVelocityY(TERMINAL);
    if (scene.physics.world.gravity.y !== GRAVITY) {
      scene.physics.world.gravity.y = GRAVITY;
    }
    this.body.setOffset(0, 0);
    this.setOrigin(0.5, 1); // feet at y
    this.setVisible(false); // the body is a hit box; `art` is what you see

    this.art = scene.add.image(x, y, this._frames.idle[0]);
    applyJackFrame(this.art, this._frames.idle[0], true);

    // The hammer is its own sprite, as in the game: Jack's frames do not
    // include it. It stands on his position and shows the frame the game's
    // list for the current animation names (see HAMMER_BY_SLOT).
    this.hammer = null;
    this._hammerKey = null;
    if (hasProps(scene)) {
      this.hammer = scene.add.image(x, y, PROP_ANIMS.hammer[0]).setScale(JACK_SCALE);
      this.hammer.setVisible(false);
    }
    // So is the hoover (VAC.SPR, VA 0x615ca): it follows him and shows the
    // frame its own list names, hidden until the list switches it on.
    this.vac = null;
    this._vacKey = null;
    this._vacHidden = true;
    this._vacFrame = -1;
    if (hasProps(scene) && PROP_ANIMS.vac) {
      this.vac = scene.add.image(x, y, PROP_ANIMS.vac[0]).setScale(JACK_SCALE);
      this.vac.setVisible(false);
    }

    // Follow the body only after physics has moved it, so the art never
    // trails the camera by a frame.
    this._syncArt = this._syncArt.bind(this);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this._syncArt);
    // The scene restarts on every new level; take the art and the hook with us.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Keeps the visible frames on top of the physics body.
   *
   * Both images are mirrored about their anchor, Jack's feet, as the game
   * draws them. Phaser's own flip mirrors a frame about its middle instead,
   * which shifts it by `w - 2 * anchor` — up to 20 px on a strike frame,
   * and far more on a hammer frame whose anchor lies outside it.
   */
  _syncArt() {
    if (!this.art || !this.art.active) return;
    const flip = this._facingLeft;
    this.art.setPosition(this.x, this.y);
    this.art.setFlipX(flip);
    Player._anchor(this.art, JACK_FRAME_INFO[this.art.texture.key + '|' + this.art.frame.name]
      || JACK_FRAME_INFO[this.art.texture.key], flip);
    this.art.setScale(JACK_SCALE * this._squashX, JACK_SCALE * this._squashY);

    if (this.vac && this.vac.visible) {
      this.vac.setPosition(this.x, this.y);
      this.vac.setFlipX(flip);
      Player._anchor(this.vac, PROP_FRAME_INFO[this._vacKey], flip);
    }

    if (!this.hammer || !this.hammer.visible) return;
    this.hammer.setPosition(this.x, this.y);
    this.hammer.setFlipX(flip);
    Player._anchor(this.hammer, PROP_FRAME_INFO[this._hammerKey], flip);
  }

  /** Puts a frame's anchor on the object's position, mirrored if `flip`. */
  static _anchor(obj, info, flip) {
    if (!info) return;
    obj.setOrigin((flip ? info.w - info.ax : info.ax) / info.w, info.ay / info.h);
  }

  /**
   * The SPA.SPR frame the hammer shows now, or null where the game's
   * animation carries no hammer list (the hoover's).
   */
  _hammerFrame(spec) {
    const slot = spec.slotFrom !== undefined ? spec.slotFrom + this._strikeCharge : spec.slot;
    const list = HAMMER_BY_SLOT[slot];
    if (!list || !list.length) return null;
    return list[Math.min(this._animFrame, list.length - 1)];
  }

  /** True while the hoover is out and able to suck. */
  get hooverOut() {
    return HOOVER_STATES.has(this.state);
  }

  /**
   * Where the hoover sucks, or null when it is not working: from VAC
   * frame 10 on (the frames it is held in), a 32 px box 40 px ahead of his
   * feet and 8 up (VA 0x61769 → 0x61472). Its height is the same 32 the
   * game passes for the width — read as such, not traced further.
   */
  get hooverBox() {
    if (this._vacFrame < 10) return null;
    const x = this._facingLeft ? this.x - 72 : this.x + 40;
    return new Phaser.Geom.Rectangle(x, this.y - 8, 32, 32);
  }

  /** Where the nozzle is — what sucked things are drawn towards (VA 0x6151c, ±0x28). */
  get nozzle() {
    return { x: this.x + (this._facingLeft ? -40 : 40), y: this.y };
  }

  /** Where the carried object sits now: on his head, or at his feet while he bends for it. */
  get carryPoint() {
    const dir = this._facingLeft ? -1 : 1;
    const bending = (this.state === 'pickUp' && this._animFrame < 4)
      || (this.state === 'putDown' && this._animFrame >= 4);
    if (bending) return this._feetAhead();
    if (this.state === 'throwAim') return { x: this.x + dir * THROW.fromAhead, y: this.y - THROW.fromUp };
    return { x: this.x, y: this.y - CARRY_UP };
  }

  /**
   * The throw as aimed, in px/tick from the throw's own start point, or
   * null until the aim has wound up far enough for the game to draw its arc.
   */
  get aim() {
    if (this.state !== 'throwAim' || this._aimTicks < THROW.frameSteps[2]) return null;
    return this._throwVelocity();
  }

  /** His grab point's column, at his feet. */
  _feetAhead() {
    return { x: this.x + (this._facingLeft ? -1 : 1) * GRAB_AHEAD, y: this.y };
  }

  _throwVelocity() {
    const dir = this._facingLeft ? -1 : 1;
    return {
      x: this.x + dir * THROW.fromAhead,
      y: this.y - THROW.fromUp,
      vx: dir * THROW.reach[this._reach],
      vy: -THROW.lift[this._lift],
    };
  }

  /** Lets go of what he holds without throwing it — it went off, or was taken. */
  dropCarried() {
    if (!this.carried) return;
    this.carried = null;
    if (STATES[this.state] && STATES[this.state].carry) this._enter('stand', this.scene.time.now);
  }

  /**
   * One tick while he holds something: walking with it, putting it down,
   * taking aim and letting fly. Returns true when it has handled the tick.
   */
  _carryTick(cursors, body, dt, now, onGround, buttonDown) {
    if (this.state === 'throwAim') {
      body.setVelocityX(this._brake(body.velocity.x, dt));
      this._aimTicks += dt * ORIGINAL_HZ;
      this._animFrame = THROW.frameSteps.filter((t) => this._aimTicks >= t).length;
      this._showFrame(STATES.throwAim);
      // A direction ahead throws further, back nearer; Up and Down lift.
      const ahead = this._facingLeft ? cursors.left.isDown : cursors.right.isDown;
      const back = this._facingLeft ? cursors.right.isDown : cursors.left.isDown;
      if (ahead) this._reach = Math.min(THROW.reach.length - 1, this._reach + 1);
      else if (back) this._reach = Math.max(0, this._reach - 1);
      if (cursors.up.isDown) this._lift = Math.min(THROW.lift.length - 1, this._lift + 1);
      else if (cursors.down.isDown) this._lift = Math.max(0, this._lift - 1);
      if (buttonDown) {
        const shot = this._throwVelocity();
        const handle = this.carried;
        this.carried = null;
        this._enter('throwRelease', now);
        this.emit('throw', { handle, ...shot });
      }
      return true;
    }

    if (!onGround) {
      this._steer(cursors, body, dt, PROFILES.slow);
      this._enter('carryFall', now);
      return true;
    }
    if (Phaser.Input.Keyboard.JustDown(cursors.down)) {
      body.setVelocityX(0);
      this._enter('putDown', now);
      return true;
    }
    if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
      this._reach = THROW.reachStart;
      this._lift = THROW.liftStart;
      this._aimTicks = 0;
      this._enter('throwAim', now);
      return true;
    }
    const moved = this._steer(cursors, body, dt, PROFILES.slow);
    this._enter(moved ? 'carryWalk' : 'carryIdle', now);
    return true;
  }

  /** True when Jack is facing left. */
  get facingLeft() {
    return this._facingLeft;
  }

  /**
   * One tick of Jack, on the game's keyboard layout (mode 2): six keys,
   * LEFT RIGHT UP DOWN BUT1 BUT2, and every action a combination of them.
   * See "The keyboard layout, state by state" in scripts/formats/README.md.
   *
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {{but1: boolean, but2: boolean, but2Pressed: boolean}} keys
   *   BUT1 pressed this tick; BUT2 held, and pressed this tick (the scene
   *   latches taps shorter than a frame)
   * @param {number} delta  ms since the last tick
   */
  update(cursors, keys = {}, delta = 1000 / 60) {
    const { but1 = false, but2 = false, but2Pressed = false } = keys;
    const body = this.body;
    const onGround = body.blocked.down;
    const now = this.scene.time.now;
    const ms = Math.min(delta, MAX_STEP_MS);
    const dt = ms / 1000;
    const across = cursors.left.isDown || cursors.right.isDown;

    this._advanceAnim(now);
    const spec = STATES[this.state] || STATES.stand;

    // ── Under a falling block ─────────────────────────────────────────────
    if (spec.crushed) {
      this._crushTick(body, dt, now, onGround);
      return;
    }
    if (spec.caught) {
      body.setVelocity(0, 0);
      return;
    }
    if (this._checkCrusher(body, now, onGround)) return;
    this._regrab = Math.max(0, this._regrab - dt * ORIGINAL_HZ);

    // ── On a ladder ───────────────────────────────────────────────────────
    if (spec.ladder) {
      this._ladderTick(cursors, body, dt, now, but2Pressed);
      return;
    }

    // ── States that own the player until their animation is done ──────────
    if (spec.locks) {
      body.setVelocityX(spec.brakes ? this._brake(body.velocity.x, dt) : 0);
      return;
    }

    // ── Winding up: BUT2 held charges, letting go strikes ─────────────────
    const windup = WINDUPS[this.state];
    if (windup) {
      this._windup(windup, cursors, body, ms, but2, now);
      return;
    }

    // ── Carrying: his hands are full until he puts it down or throws it ──
    if (spec.carry) {
      if (!this.carried) {
        this._enter('stand', now);
      } else {
        this._carryTick(cursors, body, dt, now, onGround, but1 || but2Pressed);
        return;
      }
    }

    // ── Bent down for something: searches while Down alone is held ───────
    if (this.state === 'pickBend') {
      body.setVelocityX(this._brake(body.velocity.x, dt));
      const alone = cursors.down.isDown && !across && !cursors.up.isDown;
      if (!alone) {
        this._enter('stand', now);
        return;
      }
      const dir = this._facingLeft ? -1 : 1;
      const found = this.findPickup && this.findPickup(this.x + dir * GRAB_AHEAD, this.y - GRAB_UP);
      if (found) {
        // The press that bent him down is spent: putting it down again
        // takes a fresh one (ours — the game tests Down held, VA 0x20f1d).
        Phaser.Input.Keyboard.JustDown(cursors.down);
        this.carried = found;
        this._enter('pickUp', now);
        this.emit('pickup', found);
      }
      return;
    }

    // ── The hard hat: Down went in, Up comes out (0x244c0) ────────────────
    if (this.state === 'hat') {
      if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
        body.setVelocityX(0);
        this._enter('hatOut', now);
        return;
      }
      this._steer(cursors, body, dt, PROFILES.slow);
      return;
    }

    // ── The hoover: BUT1 puts it away (0x2ab7a, 0x25468) ──────────────────
    if (HOOVER_STATES.has(this.state)) {
      if (but1) {
        body.setVelocityX(0);
        this._enter('hooverStow', now);
        return;
      }
      const moved = this._steer(cursors, body, dt, PROFILES.slow);
      this._enter(moved ? 'hooverWalk' : 'hooverIdle', now);
      return;
    }

    // ── BUT1: the hammer in and out of the hat; with UP, the hoover ───────
    if (but1 && onGround) {
      body.setVelocityX(0);
      if (cursors.up.isDown) this._enter('hooverDraw', now);
      else this._enter(this._armed ? 'hammerStow' : 'hammerDraw', now);
      return;
    }

    // ── With the hammer out, BUT2 swings it (0x23499, 0x236b9) ────────────
    // Held alone, the sideways windup; with a direction, the overhead one.
    if (this._armed && onGround) {
      if (but2) {
        this._charge = 0;
        this._chargeTicks = 0;
        this._chargeStep = 0;
        this._enter(across ? 'windupOver' : 'windupSide', now);
        this.emit('hammer_swing');
        return;
      }
      const moved = this._steer(cursors, body, dt, PROFILES.slow);
      this._enter(moved ? 'hammerWalk' : 'hammerStand', now);
      return;
    }

    // ── Empty-handed: Down ducks into the hat from standing, and picks up
    // when he is still moving with the arrows let go (0x225d7) ─────────
    if (onGround && !this._armed) {
      const downAlone = cursors.down.isDown && !across && !cursors.up.isDown;
      const still = Math.abs(body.velocity.x) <= AT_REST;
      if (downAlone && !still) {
        this._enter('pickBend', now);
        return;
      }
      if (still && Phaser.Input.Keyboard.JustDown(cursors.down)) {
        body.setVelocityX(0);
        // On a ladder's top, Down goes down it (0x22a05) — before the hat.
        const top = this.ladder ? this.ladder.topUnder(this.x, this.y) : null;
        if (top !== null) this._stepOnLadder(top, now);
        else this._enter('hatIn', now);
        return;
      }
    }

    // ── Up at a ladder climbs it (0x22a99, 0x22598, 0x22e16) ──────────────
    if (!this._armed && !spec.push && cursors.up.isDown && this.ladder
        && (onGround || this._regrab <= 0)
        && Math.abs(body.velocity.x) < LADDER.grabSpeed
        && this.ladder.at(this.x, this.y)) {
      this._grabLadder(now);
      return;
    }

    // ── Up held anywhere else on the ground: the pushing stance ───────────
    if (spec.push) {
      this._pushTick(cursors, body, dt, now, onGround, but2Pressed);
      return;
    }
    if (!this._armed && onGround && cursors.up.isDown
        && (this.state === 'walk' || this.state === 'stand')) {
      this._enter(this.state === 'walk' ? 'push' : 'pushStand', now);
      return;
    }

    // ── The skid brakes by itself; a direction key runs again ─────────────
    if (this.state === 'skid' && onGround && !across) {
      if (but2Pressed) {
        this._jump(now);
        return;
      }
      // Skidding into a wall bounces him back a quarter as fast (VA 0x227ea).
      // Physics has already stopped him by now, so it is last tick's speed.
      const into = (this._skidVx > 0 && body.blocked.right) || (this._skidVx < 0 && body.blocked.left);
      if (into) body.setVelocityX(-this._skidVx / 4);
      const vx = body.velocity.x;
      this._skidVx = vx;
      if (Math.abs(vx) < SKID_STOP) {
        body.setVelocityX(0);
        this._enter('stand', now);
      } else {
        body.setVelocityX(vx - Math.sign(vx) * SKID_BRAKE * dt);
      }
      return;
    }

    // ── Moving ────────────────────────────────────────────────────────────
    const profile = PROFILES[spec.profile] || PROFILES.run;
    const moving = this._steer(cursors, body, dt, profile);

    // BUT2 jumps — only empty-handed; with the hammer out it swings.
    if (but2Pressed && onGround) {
      this._jump(now);
      return;
    }

    if (this.state === 'rise' && this._jumpBoost > 0) {
      if (!but2 || body.velocity.y >= 0) {
        this._jumpBoost = 0;
      } else {
        this._jumpTicks += dt * ORIGINAL_HZ;
        if (this._jumpTicks > JUMP_BOOST_AFTER) {
          body.setVelocityY(body.velocity.y - perS2(this._jumpBoost) * dt);
          this._jumpBoost = Math.max(0, this._jumpBoost - JUMP_BOOST_DECAY * dt * ORIGINAL_HZ);
        }
      }
    }

    if (!onGround) {
      this._enter(body.velocity.y > FALL_VELOCITY ? 'fall' : 'rise', now);
      return;
    }

    // Landing after a fall plays its own short animation.
    if (this.state === 'fall') {
      this._enter('land', now);
      return;
    }
    if (this.state === 'land') return; // let it finish

    if (moving) this._enter('walk', now);
    else if (Math.abs(body.velocity.x) >= SKID_STOP) {
      this._skidVx = body.velocity.x;
      this._enter('skid', now);
    }
    else {
      body.setVelocityX(0);
      this._enter('stand', now);
    }
  }

  /**
   * Every tick (VA 0x21aef): a falling block over him. In the air it turns
   * a rise into a fall, or adds half its speed to his; on the ground it
   * pins him — unless his hands are full, when what he holds drops.
   * Returns true when it has taken the tick.
   */
  _checkCrusher(body, now, onGround) {
    const c = this.findCrusher && this.findCrusher();
    if (!c) return false;
    if (!onGround) {
      if (body.velocity.y < 0) body.setVelocityY(-body.velocity.y);
      else body.setVelocityY(body.velocity.y + (c.vy * ORIGINAL_HZ) / 2);
      return false;
    }
    if (this.carried) {
      this.emit('putdown', { handle: this.carried, ...this._feetAhead() });
      this.carried = null;
      this._enter('stand', now);
      return true;
    }
    const inHat = this.state === 'hat' || this.state === 'hatIn';
    this._crush = { id: c.id, contact: c.bottom, ticks: 0, w: 0, h: 0, vw: 0, vh: 0 };
    body.setVelocity(0, 0);
    body.setAllowGravity(false);
    body.checkCollision.up = false;
    this._hammerOut = false;
    this._hammerHidden = true;
    this._enter(inHat ? 'pinnedHat' : 'pinned', now);
    return true;
  }

  /** One tick pinned, flattened or popping out of the hat. */
  _crushTick(body, dt, now, onGround) {
    const k = this._crush || { ticks: 0, w: 0, h: 0, vw: 0, vh: 0 };
    const ticks = dt * ORIGINAL_HZ;
    k.ticks += ticks;

    if (this.state === 'pinned' || this.state === 'pinnedHat') {
      body.setVelocity(0, 0);
      const c = this.findCrusher && this.findCrusher();
      const squash = c && c.id === k.id ? Math.max(0, c.bottom - k.contact) : null;
      if (squash === null || squash > CRUSH.squashOut) {
        this._squashX = 1;
        this._squashY = 1;
        body.setAllowGravity(true);
        if (this.state === 'pinned') {
          // Out at -6 and flattened, flung a random way (rand >> 15).
          const fling = Math.random() * 2;
          body.setVelocity((Math.random() < 0.5 ? -1 : 1) * fling * ORIGINAL_HZ,
            (CRUSH.popOut + Math.random() * 2) * ORIGINAL_HZ);
          k.ticks = 0;
          this._enter('flattened', now);
        } else {
          body.setVelocity(0, CRUSH.popHat * ORIGINAL_HZ);
          body.setGravityY(-this.scene.physics.world.gravity.y / 2);
          Object.assign(k, { w: 0, h: 0, vw: CRUSH.wobbleW, vh: CRUSH.wobbleH, ticks: 0 });
          this._enter('hatPop', now);
        }
        return;
      }
      this._squashY = Math.max(0.15, (FULL_HEIGHT - squash) / FULL_HEIGHT);
      this._squashX = (PLAYER_WIDTH + squash / 2) / PLAYER_WIDTH;
      return;
    }

    if (this.state === 'hatPop') {
      // Width and height spring back about their rest (VA 0x2a1f0).
      k.w += k.vw * ticks;
      k.vw -= k.w * 0.5 * ticks;
      k.h += k.vh * ticks;
      k.vh -= k.h * 0.5 * ticks;
      this._squashX = Math.max(0.3, (PLAYER_WIDTH + k.w) / PLAYER_WIDTH);
      this._squashY = Math.max(0.3, (FULL_HEIGHT + k.h) / FULL_HEIGHT);
      if (onGround && body.velocity.y >= 0 && k.ticks > 2) {
        this._squashX = 1;
        this._squashY = 1;
        body.setGravityY(0);
        body.checkCollision.up = true;
        this._crush = null;
        this._enter('hat', now);
      }
      return;
    }

    // Flattened: through the air with friction, then flapping on the floor.
    if (!onGround) {
      const vx = body.velocity.x / ORIGINAL_HZ;
      const slowed = Math.abs(vx) > 9999 / 65536 ? vx - Math.sign(vx) * CRUSH.flatFriction * ticks : 0;
      body.setVelocityX(slowed * ORIGINAL_HZ);
      return;
    }
    const phase = Math.floor(k.ticks) & 0x1f;
    const back = Math.floor(k.ticks) & 0x20;
    const ahead = this._facingLeft ? -1 : 1;
    let vx = body.velocity.x / ORIGINAL_HZ;
    if (phase < 0x14) vx += (back ? -ahead : ahead) * CRUSH.flap * ticks;
    vx = Math.abs(vx) > 9999 / 65536 ? vx - Math.sign(vx) * CRUSH.flapFriction * ticks : 0;
    body.setVelocityX(vx * ORIGINAL_HZ);
    const frame = (phase < 0x10) === !back ? 1 : 2;
    if (this._animFrame !== frame) {
      this._animFrame = frame;
      this._showFrame(STATES.flattened);
    }
    if (k.ticks > CRUSH.flatTicks) {
      body.checkCollision.up = true;
      this._crush = null;
      body.setVelocityY(JUMP * 0.6);
      this._enter('tumble', now);
    }
  }

  /** Onto the ladder: no gravity, and the probes instead of collisions. */
  _grabLadder(now) {
    const body = this.body;
    body.setVelocity(0, 0);
    body.setAllowGravity(false);
    body.checkCollision.none = true;
    this._enter('climb', now);
    this._climbFrame();
  }

  /** Off the top onto the ladder (0x29b15): 9 px down at once, then the strip. */
  _stepOnLadder(top, now) {
    this._grabLadder(now);
    this._ladderTicks = 0;
    this._ladderTarget = top;
    this.body.reset(this.x, this.y + LADDER.stepDown);
    this._enter('stepOn', now);
    this._animFrame = LADDER.frames - 1;
    this._showFrame(STATES.stepOn);
  }

  /** Back to gravity and collisions, leaving the ladder by any way. */
  _offLadder() {
    this.body.setAllowGravity(true);
    this.body.checkCollision.none = false;
  }

  /** The climb's frame is his height: `(y >> 1) & 15` (VA 0x25de3). */
  _climbFrame() {
    this._animFrame = (Math.floor(this.y) >> 1) & 15;
    this._showFrame(STATES.climb);
  }

  /**
   * One tick on a ladder. Climbing (0x25bda): Up and Down move him 2 px a
   * tick and nothing else steers; the jump leaves; a floor under him going
   * down stands him on it; running out of ladder going up tops him out if
   * he was at its top, and otherwise, either way, he falls. Topping out and
   * stepping off run their strips (0x299b6, 0x29b15).
   */
  _ladderTick(cursors, body, dt, now, but2Pressed) {
    const ticks = dt * ORIGINAL_HZ;
    body.setVelocity(0, 0);
    const x = this.x;

    if (this.state === 'topOut' || this.state === 'stepOn') {
      this._ladderTicks += ticks;
      const step = Math.floor(this._ladderTicks / LADDER.stepTicks);
      const out = this.state === 'topOut';
      const f = out ? 1 + step : LADDER.frames - 1 - step;
      if (out ? f >= LADDER.frames : f <= 0) {
        if (out) {
          body.reset(x, this._ladderTarget);
          this._enter('stand', now);
        } else {
          body.reset(x, this._ladderTarget + LADDER.belowTop);
          this._enter('climb', now);
          this._climbFrame();
        }
        return;
      }
      const lift = LADDER.lift[f] / 2;
      body.reset(x, this.y + (out ? lift : -lift) * ticks);
      this._animFrame = f;
      this._showFrame(STATES[this.state]);
      return;
    }

    if (but2Pressed) {
      this._regrab = LADDER.regrab;
      this._jump(now);
      return;
    }
    const dir = cursors.up.isDown ? -1 : (cursors.down.isDown ? 1 : 0);
    const to = this.y + dir * LADDER.climb * ticks;
    if (dir > 0) {
      const floor = this.ladder.floor(x, this.y, to);
      if (floor !== null) {
        body.reset(x, floor);
        this._enter('stand', now);
        return;
      }
    }
    if (dir !== 0) {
      if (this.ladder.at(x, to)) {
        body.reset(x, to);
      } else if (dir < 0 && this.ladder.at(x, this.y) === LADDER_TOP) {
        // Out of ladder at its top: up onto the platform it holds, whose
        // top is the block's 30 px over his feet (0x25d80).
        this._ladderTicks = 0;
        const top = this.ladder.topAt(x, this.y - LADDER.probeUp);
        this._ladderTarget = top === null ? this.y - LADDER.topOutRise : top;
        this._enter('topOut', now);
        return;
      } else {
        this._regrab = LADDER.regrab;
        this._enter('fall', now);
        return;
      }
    }
    this._climbFrame();
  }

  /** Held on a sucker at (x, y), his feet on its cup. */
  holdAt(x, y) {
    const body = this.body;
    if (this.state !== 'caught') {
      // Hands full, what he holds drops, as under a falling block (ours).
      if (this.carried) {
        this.emit('putdown', { handle: this.carried, ...this._feetAhead() });
        this.carried = null;
      }
      body.setAllowGravity(false);
      body.checkCollision.none = true;
      this._enter('caught', this.scene.time.now);
    }
    body.reset(x, y);
  }

  /** Thrown off it straight up, at `vy` px/tick, from (x, y). */
  thrownUp(x, y, vy) {
    const body = this.body;
    body.setAllowGravity(true);
    body.checkCollision.none = false;
    body.reset(x, y);
    body.setVelocity(0, vy * ORIGINAL_HZ);
    this._jumpBoost = 0;
    this._enter('rise', this.scene.time.now);
  }

  /** True while he is in the stance that takes hold of what can be pushed. */
  get pushing() {
    return !!(STATES[this.state] && STATES[this.state].push);
  }

  /** One tick of pushing (0x2820b) or standing in the stance (0x28691). */
  _pushTick(cursors, body, dt, now, onGround, but2Pressed) {
    const across = cursors.left.isDown || cursors.right.isDown;
    if (!onGround) {
      this._enter('fall', now);
      return;
    }
    if (!cursors.up.isDown) {
      this._enter(across ? 'walk' : 'stand', now);
      return;
    }
    if (but2Pressed) {
      this._jump(now);
      return;
    }
    if (this.state === 'pushStand') {
      body.setVelocityX(0);
      if (across) this._enter('push', now);
      return;
    }
    const vx = body.velocity.x;
    if (across) {
      const dir = cursors.left.isDown ? -1 : 1;
      if (Math.sign(vx) === -dir && Math.abs(vx) > PUSH_SKID) {
        this._skidVx = vx;
        this._enter('skid', now);
        return;
      }
      this._steer(cursors, body, dt, PROFILES.push);
    } else if (Math.abs(vx) < SKID_STOP) {
      body.setVelocityX(0);
      this._enter('pushStand', now);
      return;
    } else {
      body.setVelocityX(vx - Math.sign(vx) * SKID_BRAKE * dt);
    }
    // His frame is where he is: (x >> 3) & 15, run backwards facing left.
    const f = (Math.floor(this.x) >> 3) & 15;
    this._animFrame = this._facingLeft ? 15 - f : f;
    this._showFrame(STATES.push);
  }

  /** The jump (0x22b91): -4.5 px/tick, more while BUT2 stays down. */
  _jump(now) {
    this.body.setVelocityY(JUMP);
    this._jumpBoost = JUMP_BOOST;
    this._jumpTicks = 0;
    this._enter('rise', now);
  }

  /** True while the hammer is out of the hat and in his hands. */
  get _armed() {
    return this._hammerOut;
  }

  /**
   * One tick of a windup. While the key is held the charge steps each time
   * the frame timer reaches a threshold, and the threshold grows by `grow`
   * after every step. Letting go strikes with whatever has built up.
   */
  _windup(w, cursors, body, ms, swingHeld, now) {
    body.setVelocityX(this._brake(body.velocity.x, ms / 1000));
    if (Phaser.Input.Keyboard.JustDown(cursors.left)) body.setVelocityX(body.velocity.x - WINDUP_NUDGE);
    if (Phaser.Input.Keyboard.JustDown(cursors.right)) body.setVelocityX(body.velocity.x + WINDUP_NUDGE);

    if (swingHeld) {
      this._chargeTicks += ms / TICK_MS;
      const threshold = w.first + this._chargeStep * w.grow;
      if (this._charge < w.max && this._chargeTicks >= threshold) {
        this._chargeTicks = 0;
        this._chargeStep += 1;
        this._charge += 1;
        this._animFrame = this._charge;
        this._showFrame(STATES[this.state]);
      }
      return;
    }

    const charge = this._charge;
    const { seq, impacts } = w.strike === 'strikeSide'
      ? SIDE_STRIKES(charge)
      : OVER_STRIKES[charge];
    this._enter(w.strike, now, { seq, impacts, charge });
  }

  /** The braking a windup, a strike and the skid share: ∓5000 a tick. */
  _brake(vx, dt) {
    if (Math.abs(vx) < SKID_STOP) return 0;
    return vx - Math.sign(vx) * SKID_BRAKE * dt;
  }

  /**
   * Applies the direction keys the way the original does (VA 0x257c0):
   * build up at the profile's rate, push back at its turn rate when the key
   * is against the motion, and ease off by an eighth-of-a-quarter of the
   * excess when above the cap. Friction comes off on top, every tick, keys
   * or not (VA 0x22d31). Returns true while a key is held.
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors
   * @param {Phaser.Physics.Arcade.Body} body
   * @param {number} dt seconds
   * @param {{top: number, accel: number, turn: number}} profile px/s, px/s²
   */
  _steer(cursors, body, dt, profile) {
    let vx = body.velocity.x;
    const held = cursors.left.isDown || cursors.right.isDown;
    if (held) {
      const dir = cursors.left.isDown ? -1 : 1;
      this._facingLeft = dir < 0;
      if (Math.sign(vx) === -dir) {
        vx += dir * profile.turn * dt;
      } else if (Math.abs(vx) < profile.top) {
        vx = dir * Math.min(profile.top, Math.abs(vx) + profile.accel * dt);
      } else {
        vx -= (vx - dir * profile.top) * Math.min(1, EASE_INTO_TOP * dt * ORIGINAL_HZ);
      }
    }
    if (Math.abs(vx) <= AT_REST) vx = 0;
    else vx -= Math.sign(vx) * Math.min(Math.abs(vx), FRICTION * dt);
    body.setVelocityX(vx);
    return held;
  }

  /**
   * Switches state, restarting its animation. A strike brings its own
   * frame list (`seq`), the frames its blow lands on, and the charge.
   */
  _enter(name, now, strike = null) {
    if (this.state === name) return;
    const prev = this.state;
    this.state = name;
    const spec = STATES[name] || STATES.stand;
    if (STATES[prev] && STATES[prev].ladder && !spec.ladder) this._offLadder();
    // In hand once it is out of the hat, until it goes back in — or into
    // the hat with the hoover's strip, or with him when he ducks.
    if (name === 'hammerStand' && (prev === 'hammerDraw' || prev === 'hooverStow')) this._hammerOut = true;
    if (name === 'hammerStow' || name === 'hooverDraw' || name === 'hatIn') this._hammerOut = false;
    // Putting down lets go at the end, with the object back at his feet.
    if (prev === 'putDown' && this.carried) {
      const handle = this.carried;
      this.carried = null;
      this.emit('putdown', { handle, ...this._feetAhead() });
    }
    this._seq = strike ? strike.seq : (spec.frames || null);
    this._impacts = strike ? strike.impacts : null;
    this._strikeCharge = strike ? strike.charge : 0;
    this._animFrame = spec.startFrame || 0;
    this._animTimer = now;
    this._showFrame(spec);
  }

  /**
   * Steps the current animation, and ends the state when a one-shot
   * animation runs out. A strike announces its blow on the frames that
   * carry it — once each, which is what makes the force worth anything.
   */
  _advanceAnim(now) {
    // Consume the elapsed time rather than stepping one frame per tick:
    // a 22ms frame on a 60Hz display would otherwise take 33ms, and an
    // eighteen-frame strike would run half again as long as it should.
    let guard = 0;
    for (;;) {
      const spec = STATES[this.state] || STATES.stand;
      if (now - this._animTimer < spec.ms || guard > ANIM_CATCHUP_LIMIT) break;
      guard += 1;
      this._animTimer += spec.ms;
      this._animFrame += 1;

      if (this._animFrame >= this._length(spec)) {
        if (spec.loop) {
          this._animFrame = spec.startFrame || 0;
        } else if (spec.hold) {
          this._animFrame = this._length(spec) - 1;
        } else {
          this._enter(spec.next || 'stand', now);
          return;
        }
      }
      if (this._impacts && this._impacts.includes(this._animFrame)) {
        this.emit('hammer_impact', {
          charge: this._strikeCharge,
          overhead: this.state === 'strikeOver',
        });
      }
    }
    this._showFrame(STATES[this.state] || STATES.stand);
  }

  /** Frames in the current state: its strike list, or its whole pose. */
  _length(spec) {
    if (spec.strip) return spec.strip.length;
    return this._seq ? this._seq.length : this._frameCount(spec.anim);
  }

  /** Draws the current frame of a state's animation. */
  _showFrame(spec) {
    if (spec.strip) {
      const [pose, at] = spec.strip[Math.min(this._animFrame, spec.strip.length - 1)];
      this._show(pose, at);
    } else {
      const total = this._frameCount(spec.anim);
      let i = spec.reverse ? total - 1 - this._animFrame : this._animFrame;
      if (this._seq) i = this._seq[Math.min(this._animFrame, this._seq.length - 1)];
      this._show(spec.anim, Phaser.Math.Clamp(i, 0, total - 1));
    }
    if (this.hammer) {
      const word = this._hammerFrame(spec);
      if (word !== null) {
        // The list's flag bits switch the hammer off and on, and stay
        // switched (VA 0x20905); ducking into the hat puts it away too
        // (slot 12, VA 0x20940).
        if (word & HAMMER_HIDE) this._hammerHidden = true;
        if (word & HAMMER_SHOW) this._hammerHidden = false;
        if (spec.slot === 12 && (word & HAMMER_FRAME) <= 15) this._hammerHidden = true;
        this._hammerKey = PROP_ANIMS.hammer[word & HAMMER_FRAME];
        this.hammer.setTexture(this._hammerKey);
      }
      this.hammer.setVisible(word !== null && !this._hammerHidden);
    }
    if (this.vac) {
      // Slots without a hoover list put it away (VA 0x617c7); the rest
      // show it, with the same sticky switches as the hammer's list.
      const list = spec.slot !== undefined ? HOOVER_BY_SLOT[spec.slot] : null;
      if (!list || !list.length) {
        this._vacHidden = true;
        this._vacFrame = -1;
      } else {
        const word = list[Math.min(this._animFrame, list.length - 1)];
        if (word & HAMMER_HIDE) this._vacHidden = true;
        if (word & HAMMER_SHOW) this._vacHidden = false;
        this._vacFrame = this._vacHidden ? -1 : word & HAMMER_FRAME;
        this._vacKey = PROP_ANIMS.vac[word & HAMMER_FRAME];
        this.vac.setTexture(this._vacKey);
      }
      this.vac.setVisible(!this._vacHidden);
    }
  }

  /** How many frames a pose has, 1 if it is missing. */
  _frameCount(pose) {
    const keys = this._frames[pose];
    return keys && keys.length ? keys.length : 1;
  }

  /**
   * Shows one frame of a pose.
   * @returns {boolean} false when the pose is not in the frame set
   */
  _show(pose, frame = 0) {
    const keys = this._frames[pose];
    if (!keys || !keys.length) return false;
    applyJackFrame(this.art, keys[frame % keys.length]);
    return true;
  }

  resetBellHit() {
    this._bellHit = false;
  }

  get bellHit() {
    return this._bellHit;
  }

  set bellHit(v) {
    this._bellHit = v;
  }

  /** Also tears down the separate art image and its post-update hook. */
  destroy(fromScene) {
    if (this.scene) {
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this._syncArt);
    }
    if (this.art) {
      this.art.destroy();
      this.art = null;
    }
    if (this.vac) {
      this.vac.destroy();
      this.vac = null;
    }
    if (this.hammer) {
      this.hammer.destroy();
      this.hammer = null;
    }
    super.destroy(fromScene);
  }
}
