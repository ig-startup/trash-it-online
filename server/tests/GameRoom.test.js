'use strict';

const GameRoom = require('../src/GameRoom');
const { EVENTS, HAMMER_FORCE } = require('../../shared/constants');

// Sample level data matching tech-spec format
const LEVEL_DATA = {
  id: 'level_01',
  timeLimit: 5,
  destructibles: [
    { id: 'obj_1', x: 500, y: 568, width: 64, height: 32, hp: 2 },
    { id: 'obj_2', x: 600, y: 568, width: 64, height: 32, hp: 1 },
  ],
  bell: { x: 2800, y: 400 },
};

/**
 * Create a mock io object that tracks emitted events.
 */
function makeMockIo() {
  const emitted = [];
  const mockRoom = {
    emit: jest.fn((event, data) => {
      emitted.push({ event, data });
    }),
  };
  const io = {
    to: jest.fn(() => mockRoom),
    _room: mockRoom,
    _emitted: emitted,
  };
  return io;
}

describe('GameRoom', () => {
  let io;
  let room;

  beforeEach(() => {
    jest.useFakeTimers();
    io = makeMockIo();
    room = new GameRoom({ code: 'ABCD', mode: 'coop', hostId: 'host-1', io });
    room.addPlayer({ id: 'player-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Test 1: startGame transitions state to 'playing'
  // -----------------------------------------------------------------------
  test('should start game and transition to playing state', () => {
    room.startGame(LEVEL_DATA);
    expect(room.state).toBe('playing');
  });

  // -----------------------------------------------------------------------
  // Test 2: repeated startGame is ignored
  // -----------------------------------------------------------------------
  test('should reject start if already playing', () => {
    room.startGame(LEVEL_DATA);
    const emitCountBefore = io._room.emit.mock.calls.length;
    room.startGame(LEVEL_DATA); // second call — must be a no-op
    const emitCountAfter = io._room.emit.mock.calls.length;
    expect(room.state).toBe('playing');
    expect(emitCountAfter).toBe(emitCountBefore); // no extra emits
  });

  // -----------------------------------------------------------------------
  // Test 3: timer is active after startGame
  // -----------------------------------------------------------------------
  test('should start timer on game start', () => {
    room.startGame(LEVEL_DATA);
    jest.advanceTimersByTime(1000);
    // After 1 second a timer_tick must have been emitted
    const ticks = io._emitted.filter((e) => e.event === EVENTS.TIMER_TICK);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Test 4: level_failed emitted on timeout
  // -----------------------------------------------------------------------
  test('should emit level_failed on timeout', () => {
    room.startGame(LEVEL_DATA); // timeLimit = 5 seconds
    jest.advanceTimersByTime(6000); // advance past timeLimit
    const failed = io._emitted.find((e) => e.event === EVENTS.LEVEL_FAILED);
    expect(failed).toBeDefined();
    expect(failed.data).toMatchObject({ reason: 'timeout' });
    expect(room.state).toBe('ended');
  });

  // -----------------------------------------------------------------------
  // Test 5: bell_hit in coop → level_complete with winnerId=null
  // -----------------------------------------------------------------------
  test('should handle bell_hit in coop mode', () => {
    room.startGame(LEVEL_DATA);
    room.handleBellHit('player-1');
    const complete = io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE);
    expect(complete).toBeDefined();
    expect(complete.data).toMatchObject({ winnerId: null, places: ['player-1'] });
  });

  // The bell takes one ring per player (G.EXE VA 0x212d4, 0x34114).
  test('the level waits until every player has rung', () => {
    room.addPlayer({ id: 'player-2' });
    room.startGame(LEVEL_DATA);
    expect(room.handleBellHit('player-2')).toBe(false);
    expect(room.handleBellHit('player-2')).toBe(false);      // once each
    const rang = io._emitted.filter((e) => e.event === EVENTS.PLAYER_RANG);
    expect(rang).toEqual([{ event: EVENTS.PLAYER_RANG, data: { playerId: 'player-2', place: 1 } }]);
    expect(io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE)).toBeUndefined();
    expect(room.state).toBe('playing');

    expect(room.handleBellHit('player-1')).toBe(true);
    const complete = io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE);
    expect(complete.data.places).toEqual(['player-2', 'player-1']);
    expect(room.state).toBe('ended');
  });

  test('a player who leaves is not waited for', () => {
    room.addPlayer({ id: 'player-2' });
    room.startGame(LEVEL_DATA);
    room.handleBellHit('player-1');
    room.players.delete('player-2');
    expect(room.finishIfAllRang()).toBe(true);
    expect(io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE)).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Test 7: object_hit decreases hp; at hp=0 emits object_destroyed
  // -----------------------------------------------------------------------
  test('should handle object_hit', () => {
    room.startGame(LEVEL_DATA);

    // First hit — hp goes from 2 → 1, no destroy event yet
    room.handleObjectHit('player-1', 'obj_1');
    const destroyed1 = io._emitted.filter((e) => e.event === EVENTS.OBJECT_DESTROYED);
    expect(destroyed1.length).toBe(0);

    // Second hit — hp goes to 0, object_destroyed must fire
    room.handleObjectHit('player-1', 'obj_1');
    const destroyed2 = io._emitted.filter((e) => e.event === EVENTS.OBJECT_DESTROYED);
    expect(destroyed2.length).toBe(1);
    expect(destroyed2[0].data).toMatchObject({ objectId: 'obj_1' });

    // Hit on obj_2 with hp=1 — destroyed immediately
    room.handleObjectHit('player-1', 'obj_2');
    const destroyed3 = io._emitted.filter((e) => e.event === EVENTS.OBJECT_DESTROYED);
    expect(destroyed3.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Test 8: events in lobby state are ignored
  // -----------------------------------------------------------------------
  test('should not handle events when not playing', () => {
    // state is 'lobby' — bell_hit must be ignored
    room.handleBellHit('player-1');
    expect(room.state).toBe('lobby');
    const complete = io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE);
    expect(complete).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // A bonus clock puts time back on the level's timer
  // -----------------------------------------------------------------------
  test('should add a clock\'s seconds while playing, and not otherwise', () => {
    room.addTime(25);
    expect(room.timeLeft).toBe(0);
    room.startGame(LEVEL_DATA);
    const before = room.timeLeft;
    room.addTime(25);
    expect(room.timeLeft).toBe(before + 25);
    const tick = io._emitted.filter((e) => e.event === EVENTS.TIMER_TICK).pop();
    expect(tick.data).toEqual({ timeLeft: before + 25 });
    room.addTime('lots');
    expect(room.timeLeft).toBe(before + 25);
  });

  // -----------------------------------------------------------------------
  // Test 9: timer is cleared after level_complete
  // -----------------------------------------------------------------------
  test('should cleanup timer on game end', () => {
    room.startGame(LEVEL_DATA);
    room.handleBellHit('player-1');
    expect(room.state).toBe('ended');

    const emitCountAfterEnd = io._room.emit.mock.calls.length;
    // Advance time — no more timer_tick events must appear
    jest.advanceTimersByTime(5000);
    const emitCountAfterAdvance = io._room.emit.mock.calls.length;
    expect(emitCountAfterAdvance).toBe(emitCountAfterEnd);
  });

  // -----------------------------------------------------------------------
  // Battles (F.EXE VA 0x212d2, 0x13fa1, 0x13e80)
  // -----------------------------------------------------------------------
  describe('a battle', () => {
    let battle;
    const level = { id: 'level_1B', timeLimit: 600, destructibles: [] };
    const ring = (...ids) => ids.forEach((id) => battle.handleBellHit(id));
    const completes = () => io._emitted.filter((e) => e.event === EVENTS.LEVEL_COMPLETE);

    beforeEach(() => {
      battle = new GameRoom({ code: 'BATL', mode: 'battle', hostId: 'a', io });
      ['a', 'b'].forEach((id) => battle.addPlayer({ id }));
    });

    test('plays the set the host picked, in its order', () => {
      expect(battle.startBattle(0)).toMatchObject({ level: 'level_1B', hammer: 1 });
      battle.startGame(level);
      ring('b', 'a');
      expect(battle.nextBattleStep()).toMatchObject({ level: 'level_2B', hammer: 23, active: null });
    });

    test('scores the places 2 and 1 between two', () => {
      battle.startBattle(0);
      battle.startGame(level);
      ring('b', 'a');
      expect(completes()[0].data).toMatchObject({ places: ['b', 'a'], award: { b: 2, a: 1 }, points: { a: 1, b: 2 } });
    });

    test('cuts the clock of the last one left to a minute', () => {
      battle.addPlayer({ id: 'c' });
      battle.startBattle(1);
      battle.startGame(level);
      ring('a');
      expect(battle.timeLeft).toBe(600);
      ring('b');
      expect(battle.timeLeft).toBe(60);
    });

    test('a player who never rings scores nothing when the time runs out', () => {
      battle.startBattle(0);
      battle.startGame({ ...level, timeLimit: 2 });
      battle.onLevelEnd = jest.fn();
      ring('a');
      jest.advanceTimersByTime(2000);
      expect(battle.onLevelEnd).toHaveBeenCalled();
      expect(completes()[0].data).toMatchObject({ places: ['a'], award: { a: 2 }, timeout: true });
    });

    test('a shared top is played off, on the last level, with guitars', () => {
      battle.startBattle(0);
      for (let i = 0; i < 5; i += 1) {
        battle.startGame(level);
        ring(i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a');   // b 2,1,2,1,2 = 8; a 1,2,1,2,1 = 7
        if (i < 4) battle.nextBattleStep();
      }
      // one more swing to a: 7 + 1 = 8 against 8 — make it level
      battle.battle.points.a = 8;
      const step = battle.nextBattleStep();
      expect(step).toMatchObject({ level: 'level_DB', hammer: 36 });
      expect(step.active.sort()).toEqual(['a', 'b']);

      battle.startGame(level, step.active);
      ring('a', 'b');
      expect(battle.nextBattleStep()).toMatchObject({ over: true, winners: ['a'] });
    });

    test('a tie-break waits only for those in it', () => {
      battle.addPlayer({ id: 'c' });
      battle.startBattle(0);
      battle.startGame(level, ['a', 'b']);
      expect(battle.handleBellHit('c')).toBe(false);
      ring('a');
      expect(battle.handleBellHit('b')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // The original's own hit points, on a level that has tough blocks: 0C.
  // -----------------------------------------------------------------------
  describe('with a real level', () => {
    const LEVEL_0C = require('../../client/public/levels/level_0C.json');
    const destroyedIds = () => io._emitted
      .filter((e) => e.event === EVENTS.OBJECT_DESTROYED)
      .map((e) => e.data.objectId);

    test('an unbreakable block is not even tracked', () => {
      const hard = LEVEL_0C.destructibles.find((o) => o.solid);
      room.startGame(LEVEL_0C);
      room.handleObjectHit('player-1', hard.id, 1e9);
      expect(destroyedIds()).not.toContain(hard.id);
    });

    test('a fully charged sledge only dents a tough block', () => {
      // The starting hammer is weak against these: 0C's blocks are 1000+
      // hit points and a full charge is 75. Breaking takes many blows.
      const tough = LEVEL_0C.destructibles
        .find((o) => !o.solid && o.hp > HAMMER_FORCE);
      room.startGame(LEVEL_0C);
      room.handleObjectHit('player-1', tough.id, HAMMER_FORCE);
      expect(destroyedIds()).not.toContain(tough.id);
      room.handleObjectHit('player-1', tough.id, tough.hp);
      expect(destroyedIds()).toContain(tough.id);
    });
  });
});
