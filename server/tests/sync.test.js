'use strict';

/**
 * Integration tests: network sync via socket.io
 * Spins up a real server on port 3001 and connects two clients.
 */

const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const express = require('express');
const RoomManager = require('../src/RoomManager');
const { EVENTS } = require('../../shared/constants');

const TEST_PORT = 3001;

let server;
let io;
let rooms;

/**
 * Create a connected socket.io-client and wait for 'connect'.
 */
function createClient() {
  return new Promise((resolve) => {
    const socket = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
  });
}

/**
 * Wait for a specific event on a socket, with timeout.
 */
function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}"`));
    }, timeoutMs);

    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll((done) => {
  const app = express();
  server = http.createServer(app);

  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  rooms = new RoomManager();

  io.on('connection', (socket) => {
    socket.on(EVENTS.CREATE_ROOM, ({ mode, playerName } = {}) => {
      const room = rooms.createRoom(mode, socket.id, playerName, io);
      const player = room.players.get(socket.id);
      socket.join(room.code);
      socket.emit(EVENTS.ROOM_CREATED, {
        code: room.code,
        playerId: socket.id,
        color: player.color,
      });
    });

    socket.on(EVENTS.JOIN_ROOM, ({ code, playerName } = {}) => {
      const room = rooms.findRoom(code.toUpperCase());
      if (!room) {
        socket.emit(EVENTS.JOIN_ERROR, { message: 'Room not found' });
        return;
      }
      const player = rooms.addPlayer(code.toUpperCase(), socket.id, playerName);
      if (player === false) {
        socket.emit(EVENTS.JOIN_ERROR, { message: 'Room is full' });
        return;
      }
      socket.join(room.code);
      socket.emit(EVENTS.ROOM_JOINED, {
        players: Array.from(room.players.values()),
        mode: room.mode,
        hostId: room.hostId,
      });
      socket.to(room.code).emit(EVENTS.PLAYER_JOINED, { player });
    });

    socket.on(EVENTS.PLAYER_UPDATE, (data = {}) => {
      const room = rooms.getPlayerRoom(socket.id);
      if (!room) return;
      const { x, y, state, dir } = data;
      socket.to(room.code).emit(EVENTS.PLAYER_UPDATE, {
        playerId: socket.id,
        x,
        y,
        state,
        dir,
      });
    });

    socket.on('disconnect', () => {
      const room = rooms.getPlayerRoom(socket.id);
      if (room) {
        socket.to(room.code).emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
      }
      rooms.removePlayer(socket.id);
    });
  });

  server.listen(TEST_PORT, done);
});

afterAll((done) => {
  io.close();
  server.close(done);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Network sync: player_update', () => {
  test('two clients should receive each other positions', async () => {
    const clientA = await createClient();
    const clientB = await createClient();

    // A creates a room
    const roomCreated = waitForEvent(clientA, EVENTS.ROOM_CREATED);
    clientA.emit(EVENTS.CREATE_ROOM, { mode: 'coop', playerName: 'Alice' });
    const { code } = await roomCreated;

    // B joins the room
    const roomJoined = waitForEvent(clientB, EVENTS.ROOM_JOINED);
    clientB.emit(EVENTS.JOIN_ROOM, { code, playerName: 'Bob' });
    await roomJoined;

    // B subscribes for position update
    const updateFromA = waitForEvent(clientB, EVENTS.PLAYER_UPDATE);

    // A sends position
    clientA.emit(EVENTS.PLAYER_UPDATE, { x: 100, y: 200, state: 'run', dir: 'right' });

    const update = await updateFromA;

    // B received A's update with correct playerId
    expect(update.playerId).toBe(clientA.id);
    expect(update.x).toBe(100);

    clientA.disconnect();
    clientB.disconnect();
  });

  test('position update should include all required fields', async () => {
    const clientA = await createClient();
    const clientB = await createClient();

    const roomCreated = waitForEvent(clientA, EVENTS.ROOM_CREATED);
    clientA.emit(EVENTS.CREATE_ROOM, { mode: 'coop', playerName: 'Alice' });
    const { code } = await roomCreated;

    const roomJoined = waitForEvent(clientB, EVENTS.ROOM_JOINED);
    clientB.emit(EVENTS.JOIN_ROOM, { code, playerName: 'Bob' });
    await roomJoined;

    const updatePromise = waitForEvent(clientB, EVENTS.PLAYER_UPDATE);

    clientA.emit(EVENTS.PLAYER_UPDATE, { x: 50, y: 300, state: 'idle', dir: 'left' });

    const update = await updatePromise;

    expect(update).toHaveProperty('playerId');
    expect(update).toHaveProperty('x');
    expect(update).toHaveProperty('y');
    expect(update).toHaveProperty('state');
    expect(update).toHaveProperty('dir');

    clientA.disconnect();
    clientB.disconnect();
  });

  test('client should not receive own position back', async () => {
    const clientA = await createClient();
    const clientB = await createClient();

    const roomCreated = waitForEvent(clientA, EVENTS.ROOM_CREATED);
    clientA.emit(EVENTS.CREATE_ROOM, { mode: 'coop', playerName: 'Alice' });
    const { code } = await roomCreated;

    const roomJoined = waitForEvent(clientB, EVENTS.ROOM_JOINED);
    clientB.emit(EVENTS.JOIN_ROOM, { code, playerName: 'Bob' });
    await roomJoined;

    let selfReceived = false;
    clientA.on(EVENTS.PLAYER_UPDATE, (data) => {
      if (data.playerId === clientA.id) {
        selfReceived = true;
      }
    });

    // A sends its own update
    clientA.emit(EVENTS.PLAYER_UPDATE, { x: 99, y: 99, state: 'jump', dir: 'right' });

    // Wait a bit to ensure no self-echo arrives
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(selfReceived).toBe(false);

    clientA.disconnect();
    clientB.disconnect();
  });
});
