import SOUNDS from './sounds.json';

/**
 * The game's sound effects, played the way G.EXE plays them: a sound id
 * picks one of 154 scripts (table 0x95f9c, exported by
 * scripts/export_sounds.py), and a voice steps its script once a logic
 * tick — play a bank sample at a rate, wait, slide or wobble the pitch,
 * start another sound. See docs/re/formats/sound.md.
 *
 * - Voices (`sound_voice_alloc` 0x1618f): 15 — as many sample handles as
 *   the game asks Miles for (VA 0x16f84). A free one, else the next one
 *   round the ring whose priority is no higher than the new sound's
 *   (never a 0x7fff one), stopped; else the sound is not played.
 * - `play` (op 0, 0x1633f) puts a new sample on the voice, which ends the
 *   one it was playing, at volume 100 of 127; `end` (op 10) stops it.
 * - Each tick (`voice_effects_update` 0x167e5): vibrato flips ±depth every
 *   period, the pitch slide adds its step every n ticks for so many steps,
 *   the jitter knocks `random & mask` off the rate every n ticks; then the
 *   wait counts down and, at zero, the script runs on to its next yield.
 * - The pan ops (4, 5, 15, 16) are not played: everything is centred.
 *
 * Rates are Hz; a sample at its file rate plays at its own speed.
 */
const HZ = 60;
const VOICES = 15;
const VOLUME = 100 / 127;
const LOCKED = 0x7fff;

let ctx = null;
let out = null;
const buffers = [];
const voices = [];
let ring = VOICES;
let acc = 0;
let muted = false;

const rand = (mask) => Math.floor(Math.random() * 0x10000) & mask;

/**
 * Loads and decodes the samples on the game's audio context. Call once,
 * with the Phaser game; plays before it finishes are silent.
 * @param {Phaser.Game} game
 */
export function initSfx(game) {
  if (ctx) return;
  const mgr = game.sound;
  if (!mgr || !mgr.context) return;          // no Web Audio, no sound
  ctx = mgr.context;
  out = ctx.createGain();
  out.gain.value = VOLUME;
  out.connect(mgr.destination || ctx.destination);
  for (let i = 0; i < VOICES; i += 1) voices.push({ busy: false });
  SOUNDS.samples.forEach((s, i) => {
    fetch(s.file)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { buffers[i] = buf; })
      .catch(() => {});
  });
  game.events.on('poststep', (_time, delta) => {
    acc = Math.min(acc + delta, 100);
    while (acc >= 1000 / HZ) {
      acc -= 1000 / HZ;
      voices.forEach((v) => { if (v.busy) tickVoice(v); });
    }
  });
}

/** M mutes and unmutes. */
export function toggleMute() {
  muted = !muted;
  if (out) out.gain.value = muted ? 0 : VOLUME;
  return muted;
}

/**
 * Starts sound `id` (`play_sound` 0x15de2).
 * @param {number} id  an index into the script table
 * @param {{delay?: number}} [opts]  ticks before its first op — what
 *   `blow_walk_cells` and `play_sound_staggered` write into the new voice
 *   (+0x18) so a blow's cells do not all sound at once
 * @returns {object | null} the voice, for `stopSfx`
 */
export function playSfx(id, opts = {}) {
  if (!ctx) return null;
  const script = SOUNDS.scripts[id];
  if (!script) return null;
  const v = allocVoice(script.priority);
  if (!v) return null;
  Object.assign(v, {
    busy: true,
    id,
    priority: script.priority,
    ops: script.ops,
    pc: 0,
    wait: opts.delay || 0,
    src: null,
    sample: -1,
    base: 0,
    vib: null, vibOff: 0,
    slide: null,
    jitter: null, jitterOff: 0,
  });
  if (!v.wait) run(v);
  return v;
}

/** Stops a voice `playSfx` returned, if it is still that sound. */
export function stopSfx(v, id) {
  if (v && v.busy && (id === undefined || v.id === id)) free(v);
}

function allocVoice(priority) {
  const idle = voices.find((v) => !v.busy);
  if (idle) return idle;
  ring -= 1;
  if (ring < 0) ring = VOICES;
  // from the ring's place down, then from the top down to it
  const order = [];
  for (let i = ring - 1; i >= 0; i -= 1) order.push(i);
  for (let i = VOICES - 1; i >= ring; i -= 1) order.push(i);
  for (const i of order) {
    const v = voices[i];
    if (v.priority <= priority && v.priority !== LOCKED) {
      free(v);
      return v;
    }
  }
  return null;
}

function free(v) {
  stopSample(v);
  v.busy = false;
}

function stopSample(v) {
  if (!v.src) return;
  try { v.src.stop(); } catch { /* already ended */ }
  v.src.disconnect();
  v.src = null;
}

function startSample(v, index, rate) {
  stopSample(v);
  const buf = buffers[index];
  const info = SOUNDS.samples[index];
  v.sample = index;
  v.base = rate === -1 || rate === 0xffff ? info.rate : rate;
  if (!buf || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (info.loop) {
    src.loop = true;
    [src.loopStart, src.loopEnd] = info.loop;
  }
  src.connect(out);
  src.onended = () => { if (v.src === src) v.src = null; };
  v.src = src;
  setRate(v);
  src.start();
}

function setRate(v) {
  if (!v.src) return;
  const hz = Math.max(100, (v.base + v.vibOff - v.jitterOff) & 0xffff);
  v.src.playbackRate.value = hz / SOUNDS.samples[v.sample].rate;
}

/** One logic tick of a voice: its effects, then its script. */
function tickVoice(v) {
  if (v.vib) {
    if (v.vib.count === 0) {
      v.vib.count = v.vib.period;
      v.vib.up = !v.vib.up;
      v.vibOff = v.vib.up ? -v.vib.depth : v.vib.depth;
      setRate(v);
    } else v.vib.count -= 1;
  }
  if (v.slide) {
    if (v.slide.count === 0) {
      v.slide.count = v.slide.every;
      if (v.slide.steps === 0) v.slide = null;
      else {
        v.slide.steps -= 1;
        v.base += v.slide.step;
        setRate(v);
      }
    } else v.slide.count -= 1;
  }
  if (v.jitter) {
    if (v.jitter.count === 0) {
      v.jitter.count = v.jitter.every;
      v.jitterOff = rand(v.jitter.mask);
      setRate(v);
    } else v.jitter.count -= 1;
  }
  if (!v.busy) return;
  if (v.wait > 0) v.wait -= 1;
  else run(v);
}

/** Runs ops until one yields (`sound_script_run` 0x1631c). */
function run(v) {
  for (let guard = 0; guard < 400 && v.busy; guard += 1) {
    const op = v.ops[v.pc];
    if (!op) { free(v); return; }
    v.pc += 1;
    const [code, a, b, c, , e] = op;
    switch (code) {
      case 0: startSample(v, a, b); break;                       // play
      case 17: startSample(v, a, b + rand(e)); break;            // play, rate + random & mask
      case 1: stopSample(v); break;                              // stop_sample
      case 2: v.wait = a - 1; return;                            // wait
      case 20: v.wait = a + rand(b) - 1; return;                 // wait_rand
      case 3: v.base = a; setRate(v); break;                     // rate
      case 6: v.slide = { step: a, steps: b, every: c, count: c }; break;   // pitch_slide
      case 7: v.vib = { depth: a, period: b, count: b, up: false }; break;
      case 8: v.slide = null; break;
      case 9: v.vib = null; v.vibOff = 0; setRate(v); break;
      case 10: free(v); return;                                  // end
      case 11: playSfx(a); break;                                // sound
      case 18: v.jitter = { mask: a, every: b, count: b }; break;
      case 19: v.jitter = null; v.jitterOff = 0; setRate(v); break;
      default: break;                                            // pan, nop, skip
    }
  }
}

/** Sound ids the clone plays — the game's own, from the calls in G.EXE. */
export const SFX = {
  JUMP: 0x6f,             // jack_jump, jack_land, jack_hurt_flying
  STEP: 0x1a,             // jack_walk, frames 2 and 10
  HAT_REACH: 0x10,        // jack_hammer_to_hat: hammer or hoover in or out
  WINDUP_SIDE: 0x0c,      // jack_windup_side
  WINDUP_OVER: 0x0d,      // jack_windup_over
  CLIMB_UP: 0x53,         // jack_climb, frames 0 and 8
  CLIMB_DOWN: 0x54,
  PICK_UP: 0x6c,          // jack_take_hold
  THROW: 0x6b,            // jack_aim, on letting go
  FLATTENED: 0x6e,        // jack_flattened
  FLY_HOME: 0x98,         // jack_fly_to_flag
  HAT_HOP: 0x52,          // jack_in_hat, the hop
  HAT_IN: 0x11,           // jack_in_hat
  HAT_OUT: 0x3e,          // jack_out_of_hat
  HARD_LANDING: 0x57,     // jack_hard_landing
  STUNG: 0x0b,            // jack_touch_spike, jack_flung_by
  DEPOSIT: 0x6d,          // jack_stand: timmies dropped at his flag
  BLOCKS_DOWN: 0x28,      // blow_walk_cells: the blow broke something
  BELL_RUNG: 0x5a,        // bell_touch_tick, every ring
  BELL_LAST: 0x43,        // bell_touch_tick, the last one: level over
  BELL_FREED_PCT: 0x8f,   // bell_wait_percent
  BELL_FREED_BINS: 0x82,  // bell_wait_option_800
  DYNA_STRUCK: 0x58,      // dyna_hammer_state
  DYNA_LIT: 0x38,         // dyna_lit_hop, dyna_touched_outcome
  DYNA_BOOM: 0x59,        // dyna_explode
  TELLY_PAD: 0x36,        // telly_pad_state, opening and closing
  TELLY_SEND: 0x37,       // telly_send
  GOT: 0x64,              // spawn_got_popup
  GIT_STEP: 0x19,         // git_tick
  GIT_STRUCK: 0x6a,       // git_struck_puff, bomb_blow
  HOOVER_DRAW: 0x16,      // hoover_tick
  HOOVER_AWAY: 0x17,
  HOOVER_SUCK: 0x18,      // hoover_suck_box
  SEESAW_TIP: 0x4f,
  SEESAW_LAUNCH: 0x4e,
  SUCKER_CATCH: 0x49,
  SUCKER_WOBBLE: 0x4d,
  CANNON_FIRE: 0x13,
  UFO: 0x84,
  UFO_BEAM: 0x86,
  UFO_ZAP: 0x87,
  PANEL_A: 0x8d,          // jack_touch_panel, rubble_extra_life_tick
  PANEL_B: 0x8c,
  CLOCK_LAST: 0x63,       // hud_clock_tick
  PAUSE_MOVE: 0x01,
  PAUSE_PICK: 0x30,
};

/** What a blow sounds like on each material, table 0x9fefe. */
export const BLOW_BY_MATERIAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** What a block sounds like when struck or landed on, table 0x9ff14. */
export const LAND_BY_MATERIAL = [36, 38, 3, 4, 37, 34, 35, 8, 9, 33];
