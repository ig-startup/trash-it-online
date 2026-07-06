'use strict';

/**
 * Manual test: emit create_room and log the response.
 *
 * Usage:
 *   1. Start the server:  cd server && npm start
 *   2. Run this script:   node server/tests/manual/create-room.js
 *
 * Expected output:
 *   room_created: { code: 'XXXX', playerId: '...', color: '#...' }
 */

// socket.io-client is a devDependency — install if missing:
//   cd server && npm install --save-dev socket.io-client
let io;
try {
  io = require('socket.io-client');
} catch {
  console.error('[error] socket.io-client not found. Run: cd server && npm install --save-dev socket.io-client');
  process.exit(1);
}

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const socket = io(SERVER_URL, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log(`[connected] socketId=${socket.id}`);

  socket.emit('create_room', { mode: 'coop', playerName: 'TestHost' });
});

socket.on('room_created', (data) => {
  console.log('room_created:', data);
  socket.disconnect();
  process.exit(0);
});

socket.on('join_error', (data) => {
  console.error('join_error:', data);
  socket.disconnect();
  process.exit(1);
});

socket.on('connect_error', (err) => {
  console.error('[connect_error]', err.message);
  console.error('Make sure the server is running: cd server && npm start');
  process.exit(1);
});

// Timeout fallback
setTimeout(() => {
  console.error('[timeout] No response from server within 5 seconds');
  process.exit(1);
}, 5000);
