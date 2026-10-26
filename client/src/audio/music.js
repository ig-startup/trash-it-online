import MUSIC from './music.json';

/**
 * The level music, played the way Miles plays an XMI sequence on its wave
 * synthesizer: each note starts a wave library patch — a phrase of 2-4 s,
 * not an instrument — pitched by its key against the patch's root, and
 * cuts it at its duration. Ticks are XMIDI's fixed 120 Hz; the sequence
 * loops forever between its FOR and NEXT controllers (`music_start`
 * 0x170b6: loop count 0). See docs/re/formats/sound.md.
 *
 * The three sequences of a section's .XMI are one tune at three volumes
 * (channel volume 43, 85, 127): the AUDIO CONF setting picks one through
 * table 0x96afa, or none (docs/re/front/options.md). The clone has no
 * AUDIO CONF yet, so it plays F.EXE's default, setting 3: the quiet one.
 *
 * Every section plays 0A's tune: G.EXE loads "0a.WVL" for all of them
 * (audio_init 0x16cc7), and this copy's has only the patches 0A.XMI uses.
 */
const TICK_HZ = 120;
const LOOKAHEAD = 1.0;    // s of notes scheduled ahead
const PUMP_MS = 250;
const FADE = 0.01;        // s, so a cut phrase does not click

/** Sequence per AUDIO CONF setting (`+0x2c`), table 0x96afa; -1 is none. */
const TUNE_BY_SETTING = [2, -1, 1, 0];
const SETTING = 3;        // front_init's default

let ctx = null;
let out = null;
const buffers = [];
let play = null;          // {tune, i, tick, at, sources} while a tune runs
let paused = null;        // the tick a paused tune stopped at
let pump = null;

/**
 * Loads and decodes the phrases on the game's audio context. Call once,
 * with the Phaser game.
 * @param {Phaser.Game} game
 */
export function initMusic(game) {
  if (ctx) return;
  const mgr = game.sound;
  if (!mgr || !mgr.context) return;
  ctx = mgr.context;
  out = ctx.createGain();
  out.connect(mgr.destination || ctx.destination);
  MUSIC.patches.forEach((p, i) => {
    fetch(p.file)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { buffers[i] = buf; })
      .catch(() => {});
  });
}

/** music_start (0x170b6): the level's tune from its start, looping. */
export function startMusic() {
  stopMusic();
  const n = TUNE_BY_SETTING[SETTING];
  const tune = MUSIC.tunes[n];
  if (!ctx || !tune) return;
  begin(tune, 0);
}

/** AIL_stop_sequence: level_finish, cd_play_track, the pause. */
export function stopMusic() {
  paused = null;
  halt();
}

/** pause_game (0x1007c) sets 2: the sequence stops where it is ... */
export function pauseMusic() {
  if (!play) return;
  const at = tickNow();
  const tune = play.tune;
  halt();
  paused = { tune, tick: at };
}

/** ... and 4 when it is over: AIL_resume_sequence, from there on. */
export function resumeMusic() {
  if (!paused) return;
  const { tune, tick } = paused;
  paused = null;
  begin(tune, tick);
}

function begin(tune, tick) {
  // the first note at or after `tick`
  let i = tune.notes.findIndex((nt) => nt[0] >= tick);
  if (i < 0) i = tune.notes.length;
  play = { tune, i, tick, at: ctx.currentTime + 0.05, sources: new Set() };
  pump = setInterval(schedule, PUMP_MS);
  schedule();
}

function halt() {
  if (pump) clearInterval(pump);
  pump = null;
  if (!play) return;
  play.sources.forEach((s) => { try { s.stop(); } catch { /* not started */ } });
  play = null;
}

/** Where the tune is now, in its own ticks (for a pause). */
function tickNow() {
  let t = play.tick + (ctx.currentTime - play.at) * TICK_HZ;
  const loop = play.tune.loop;
  // scheduled past the NEXT already: still before it, by as much
  if (loop && t < play.tick) t = loop[1] - (play.tick - t);
  return Math.max(0, t);
}

/** Puts every note of the next LOOKAHEAD seconds on the audio clock. */
function schedule() {
  const p = play;
  if (!p) return;
  const { notes, loop } = p.tune;
  const until = ctx.currentTime + LOOKAHEAD;
  for (;;) {
    const nt = notes[p.i];
    const atLoopEnd = loop && (!nt || nt[0] >= loop[1]);
    if (atLoopEnd) {
      // NEXT: back to the FOR, the clock carried on from the loop's end
      p.at += (loop[1] - p.tick) / TICK_HZ;
      p.tick = loop[0];
      p.i = notes.findIndex((n) => n[0] >= loop[0]);
      continue;
    }
    if (!nt) { if (!p.sources.size) halt(); return; }
    const when = p.at + (nt[0] - p.tick) / TICK_HZ;
    if (when > until) return;
    note(p, nt, when);
    p.i += 1;
  }
}

function note(p, [, patch, key, gain, dur], when) {
  const buf = buffers[patch];
  if (!buf || when < ctx.currentTime) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 2 ** ((key - MUSIC.patches[patch].root) / 12);
  const g = ctx.createGain();
  const off = when + dur / TICK_HZ;
  g.gain.setValueAtTime(gain, when);
  g.gain.setValueAtTime(gain, off - FADE);
  g.gain.linearRampToValueAtTime(0, off);
  src.connect(g).connect(out);
  src.start(when);
  src.stop(off);
  p.sources.add(src);
  src.onended = () => p.sources.delete(src);
}
