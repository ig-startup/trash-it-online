'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const RoomManager = require('./RoomManager');
const { EVENTS } = require('../../shared/constants');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;
const rooms = new RoomManager();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[connect] socket=${socket.id}`);

  // --- create_room ---
  socket.on(EVENTS.CREATE_ROOM, ({ mode, playerName } = {}) => {
    if (!mode || !playerName) {
      socket.emit(EVENTS.JOIN_ERROR, { message: 'mode and playerName are required' });
      return;
    }

    const room = rooms.createRoom(mode, socket.id, playerName, io);
    const player = room.players.get(socket.id);

    socket.join(room.code);
    socket.emit(EVENTS.ROOM_CREATED, {
      code: room.code,
      playerId: socket.id,
      color: player.color,
    });

    console.log(`[create_room] code=${room.code} host=${socket.id} name=${playerName}`);
  });

  // --- join_room ---
  socket.on(EVENTS.JOIN_ROOM, ({ code, playerName } = {}) => {
    if (!code || !playerName) {
      socket.emit(EVENTS.JOIN_ERROR, { message: 'code and playerName are required' });
      return;
    }

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

    // Send current state to the joining player
    socket.emit(EVENTS.ROOM_JOINED, {
      players: Array.from(room.players.values()),
      mode: room.mode,
      hostId: room.hostId,
    });

    // Notify everyone else in the room
    socket.to(room.code).emit(EVENTS.PLAYER_JOINED, { player });

    console.log(`[join_room] code=${room.code} socket=${socket.id} name=${playerName}`);
  });

  // --- player_ready ---
  socket.on(EVENTS.PLAYER_READY, () => {
    const room = rooms.getPlayerRoom(socket.id);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    player.ready = true;

    io.to(room.code).emit(EVENTS.PLAYER_READY_CHANGED, {
      playerId: socket.id,
      ready: true,
    });

    console.log(`[player_ready] socket=${socket.id} room=${room.code}`);
  });

  // --- start_game --- (host only)
  socket.on(EVENTS.START_GAME, () => {
    const room = rooms.getPlayerRoom(socket.id);
    if (!room) return;
    if (socket.id !== room.hostId) return; // only host can start

    // Use a minimal level descriptor; client sends full level data later
    room.startGame('level_01');
    io.to(room.code).emit(EVENTS.GAME_STARTED, { levelId: 'level_01' });
    console.log(`[start_game] room=${room.code} host=${socket.id}`);
  });

  // --- player_update ---
  socket.on(EVENTS.PLAYER_UPDATE, (data = {}) => {
    const room = rooms.getPlayerRoom(socket.id);
    if (!room) return;

    const { x, y, state, dir } = data;

    // Broadcast to everyone else in the room (not the sender)
    socket.to(room.code).emit(EVENTS.PLAYER_UPDATE, {
      playerId: socket.id,
      x,
      y,
      state,
      dir,
    });
  });

  // --- bell_hit ---
  socket.on(EVENTS.BELL_HIT, () => {
    const room = rooms.getPlayerRoom(socket.id);
    if (!room) return;
    room.handleBellHit(socket.id);
    console.log(`[bell_hit] room=${room.code} socket=${socket.id}`);
  });

  // --- object_hit ---
  socket.on(EVENTS.OBJECT_HIT, (data = {}) => {
    const room = rooms.getPlayerRoom(socket.id);
    if (!room) return;
    room.handleObjectHit(socket.id, data.objectId);
    console.log(`[object_hit] room=${room.code} socket=${socket.id} objectId=${data.objectId}`);
  });

  // --- disconnect ---
  socket.on('disconnect', () => {
    const room = rooms.getPlayerRoom(socket.id);
    if (room) {
      socket.to(room.code).emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
      console.log(`[player_left] socket=${socket.id} room=${room.code}`);
    }

    rooms.removePlayer(socket.id);
    console.log(`[disconnect] socket=${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
