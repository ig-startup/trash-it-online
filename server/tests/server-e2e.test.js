'use strict';

/**
 * End-to-end tests against the real `src/index.js`.
 *
 * The other integration test (`sync.test.js`) rebuilds the socket wiring
 * inside the test, so nothing covered the actual entry point: static file
 * serving, the host-only start_game guard, level progression after the bell.
 * Here the server is booted as its own process, exactly as `npm start` does.
 */

const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { io: ioc } = require('socket.io-client');
const { HAMMER_FORCE } = require('../../shared/constants');

const PORT = 3123;
const URL = `http://localhost:${PORT}`;

let child;

/** Resolves once the server answers /health, or rejects after ~5s. */
function waitForHealth(attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${URL}/health`, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => {
      if (attempt > 50) reject(new Error('server never came up'));
      else setTimeout(() => resolve(waitForHealth(attempt + 1)), 100);
    });
  });
}

/** GET a path, resolving to { status, body }. */
function get(p) {
  return new Promise((resolve, reject) => {
    http.get(URL + p, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function connect() {
  return new Promise((resolve) => {
    const s = ioc(URL, { transports: ['websocket'], forceNew: true });
    s.once('connect', () => resolve(s));
  });
}

/** Resolves with the next `event` on `sock`. */
function once(sock, event, ms = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    sock.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

beforeAll(async () => {
  child = fork(path.join(__dirname, '..', 'src', 'index.js'), [], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  await waitForHealth();
}, 20000);

afterAll(() => {
  if (child) child.kill();
});

describe('HTTP', () => {
  test('health check answers ok', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });
});

describe('room lifecycle over the real server', () => {
  let host;
  let guest;
  let code;

  afterAll(() => {
    if (host) host.close();
    if (guest) guest.close();
  });

  test('host creates a room and a guest joins it', async () => {
    host = await connect();
    guest = await connect();

    host.emit('create_room', { mode: 'coop', playerName: 'Host' });
    const created = await once(host, 'room_created');
    expect(created.code).toHaveLength(4);
    expect(created.playerId).toBe(host.id);
    code = created.code;

    const seen = once(host, 'player_joined');
    guest.emit('join_room', { code, playerName: 'Guest' });
    const joined = await once(guest, 'room_joined');

    expect(joined.players).toHaveLength(2);
    expect(joined.hostId).toBe(host.id);
    expect(joined.players[0].color).not.toBe(joined.players[1].color);
    expect((await seen).player.id).toBe(guest.id);
  });

  test('a guest cannot start the game', async () => {
    let started = false;
    host.once('game_started', () => { started = true; });
    guest.emit('start_game');
    await new Promise((r) => setTimeout(r, 300));
    expect(started).toBe(false);
  });

  test('the host starts the game and both clients get the same level', async () => {
    const forGuest = once(guest, 'game_started');
    host.emit('start_game');
    const [a, b] = await Promise.all([once(host, 'game_started'), forGuest]);
    expect(a.levelId).toBeTruthy();
    expect(b.levelId).toBe(a.levelId);
  });

  test('player_update reaches the other player and not the sender', async () => {
    let echoed = false;
    host.once('player_update', () => { echoed = true; });
    const relayed = once(guest, 'player_update');
    host.emit('player_update', { x: 42, y: 99, state: 'run', dir: 1 });

    const upd = await relayed;
    expect(upd).toMatchObject({ playerId: host.id, x: 42, y: 99, dir: 1 });
    expect(echoed).toBe(false);
  });

  // The first block in a level is often one the original marks unbreakable,
  // so pick one the room actually tracks.
  const SOFT_BLOCK = require('../../client/src/levels/level_0C.json')
    .destructibles.find((o) => !o.solid).id;

  test('an unbreakable block is not even tracked', async () => {
    let destroyed = false;
    guest.once('object_destroyed', () => { destroyed = true; });
    host.emit('object_hit', { objectId: 'o0', force: HAMMER_FORCE });
    await new Promise((r) => setTimeout(r, 300));
    expect(destroyed).toBe(false);
  });

  test('a blow too weak to matter leaves the block standing', async () => {
    // Blocks carry the original's own hit points now, in the thousands, so
    // a nominal hit does nothing. This is the half of the model that is
    // easy to break by accident.
    let destroyed = false;
    guest.once('object_destroyed', () => { destroyed = true; });
    host.emit('object_hit', { objectId: SOFT_BLOCK, force: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(destroyed).toBe(false);
  });

  test('a full-force blow breaks it and tells the room which one went', async () => {
    // Ids come from the level json exported from the original game ("o0", …),
    // and the client sends that same string back, with the force it applied.
    const destroyed = once(guest, 'object_destroyed');
    host.emit('object_hit', { objectId: SOFT_BLOCK, force: HAMMER_FORCE });
    expect(await destroyed).toEqual({ objectId: SOFT_BLOCK });
  });

  test('the clock ticks for everyone', async () => {
    const tick = await once(host, 'timer_tick', 3000);
    expect(typeof tick.timeLeft).toBe('number');
  });

  test('the bell ends the level and the room moves on to the next one', async () => {
    const complete = once(guest, 'level_complete');
    host.emit('bell_hit');
    expect(await complete).toHaveProperty('winnerId', null); // coop: nobody "wins"

    const next = await once(guest, 'game_started', 9000);
    expect(next.levelId).toBeTruthy();
  }, 15000);

  test('leaving the room notifies the others', async () => {
    const guestId = guest.id;
    const left = once(host, 'player_left');
    guest.close();
    expect((await left).playerId).toBe(guestId);
  });
});
