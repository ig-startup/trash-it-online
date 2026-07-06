'use strict';

const RoomManager = require('../src/RoomManager');

describe('RoomManager', () => {
  let rm;

  beforeEach(() => {
    rm = new RoomManager();
  });

  test('should create a room with unique 4-char code', () => {
    const room = rm.createRoom('coop', 'socket-host-1', 'Player 1');
    expect(room).toBeDefined();
    expect(typeof room.code).toBe('string');
    expect(room.code).toHaveLength(4);
    expect(/^[A-Z]{4}$/.test(room.code)).toBe(true);
  });

  test('should find room by code', () => {
    const room = rm.createRoom('coop', 'socket-host-2', 'Player 2');
    const found = rm.findRoom(room.code);
    expect(found).not.toBeNull();
    expect(found.code).toBe(room.code);
  });

  test('should return null for unknown code', () => {
    const found = rm.findRoom('XXXX');
    expect(found).toBeNull();
  });

  test('should add player to room', () => {
    const room = rm.createRoom('coop', 'socket-host-3', 'Host');
    const player = rm.addPlayer(room.code, 'socket-p2', 'Player 2');
    expect(player).not.toBe(false);
    expect(player.id).toBe('socket-p2');
    expect(player.name).toBe('Player 2');
    expect(room.players.size).toBe(2); // host + new player
  });

  test('should remove player from room', () => {
    const room = rm.createRoom('coop', 'socket-host-4', 'Host');
    rm.addPlayer(room.code, 'socket-p2', 'Player 2');
    expect(room.players.size).toBe(2);

    rm.removePlayer('socket-p2');
    expect(room.players.size).toBe(1);
    expect(room.players.has('socket-p2')).toBe(false);
  });

  test('should delete room when last player leaves', () => {
    const room = rm.createRoom('coop', 'socket-host-5', 'Host');
    const code = room.code;

    rm.removePlayer('socket-host-5');
    expect(rm.findRoom(code)).toBeNull();
  });

  test('should regenerate code on collision', () => {
    // Patch generateCode to return same code twice then different
    let callCount = 0;
    const fixedCode = 'AAAA';
    const altCode = 'BBBB';

    // Create first room with code AAAA
    rm._rooms.set(fixedCode, { code: fixedCode });

    // Spy on generateCode to return AAAA first (collision), then BBBB
    const original = rm.generateCode.bind(rm);
    rm.generateCode = () => {
      callCount++;
      if (callCount === 1) return fixedCode; // collision
      if (callCount === 2) return altCode;   // new unique code
      return original();
    };

    const room = rm.createRoom('coop', 'socket-host-6', 'Host');
    expect(room.code).toBe(altCode);
    expect(callCount).toBe(2);
  });

  test('should reject room join if full (4 players)', () => {
    const room = rm.createRoom('coop', 'socket-host-7', 'Host');
    rm.addPlayer(room.code, 'socket-p2', 'Player 2');
    rm.addPlayer(room.code, 'socket-p3', 'Player 3');
    rm.addPlayer(room.code, 'socket-p4', 'Player 4');

    expect(room.players.size).toBe(4);

    const result = rm.addPlayer(room.code, 'socket-p5', 'Player 5');
    expect(result).toBe(false);
    expect(room.players.size).toBe(4);
  });
});
