'use strict';

const GameRoom = require('../src/GameRoom');
const { EVENTS } = require('../../shared/constants');

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
    expect(complete.data).toMatchObject({ winnerId: null });
  });

  // -----------------------------------------------------------------------
  // Test 6: bell_hit in race → level_complete with winnerId=socketId
  // -----------------------------------------------------------------------
  test('should handle bell_hit in race mode', () => {
    const raceRoom = new GameRoom({ code: 'RACE', mode: 'race', hostId: 'host-1', io });
    raceRoom.startGame(LEVEL_DATA);
    raceRoom.handleBellHit('player-2');
    const complete = io._emitted.find((e) => e.event === EVENTS.LEVEL_COMPLETE);
    expect(complete).toBeDefined();
    expect(complete.data).toMatchObject({ winnerId: 'player-2' });
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
});
