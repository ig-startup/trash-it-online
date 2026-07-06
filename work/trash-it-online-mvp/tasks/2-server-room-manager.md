---
status: planned
number: 2
wave: 1
skills: [code-writing]
verify: bash
---

# Task 2: Сервер — RoomManager + Socket.io

## What to do

Реализовать управление комнатами на сервере: создание, поиск, удаление комнат и обработку Socket.io событий лобби. Комнаты хранятся in-memory. Написать unit-тесты для RoomManager и ручной скрипт для проверки через socket.io-client.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md` — секции Data Model, Socket.io Events
- `shared/constants.js`

## Test-Driven Development

### Tests to Write

Файл: `server/tests/RoomManager.test.js`

1. `should create a room with unique 4-char code` — createRoom возвращает объект с полем `code` из 4 символов
2. `should find room by code` — findRoom(code) возвращает созданную комнату
3. `should return null for unknown code` — findRoom('XXXX') → null
4. `should add player to room` — addPlayer добавляет игрока в Map
5. `should remove player from room` — removePlayer удаляет игрока
6. `should delete room when last player leaves` — при removePlayer последнего игрока комната удаляется
7. `should regenerate code on collision` — если код уже занят, генерирует другой
8. `should reject room join if full (4 players)` — addPlayer возвращает false при 4 игроках

## Implementation Steps

1. Написать тесты (см. выше) — они упадут
2. Создать `server/src/RoomManager.js`:
   - `generateCode()` — 4 случайных буквы A-Z, проверяет коллизию
   - `createRoom(mode, hostSocketId, playerName)` → Room объект
   - `findRoom(code)` → Room | null
   - `addPlayer(code, socketId, playerName)` → Player | false (если full)
   - `removePlayer(socketId)` — удаляет из комнаты, удаляет комнату если пустая
   - `getPlayerRoom(socketId)` → Room | null
3. Создать `server/src/GameRoom.js` — заглушка класса (полная реализация в T6):
   - конструктор принимает `{ code, mode, hostId }`
   - поле `state = 'lobby'`
   - поля `players = new Map()`, `timer = null`
4. Добавить Socket.io обработчики в `server/src/index.js`:
   - `create_room` → `room_created` или `join_error`
   - `join_room` → `room_joined` + broadcast `player_joined` или `join_error`
   - `player_ready` → broadcast `player_ready_changed`
   - `disconnect` → broadcast `player_left`, cleanup в RoomManager
5. Создать `server/tests/manual/create-room.js` — socket.io-client скрипт, эмитирует `create_room`, логирует ответ
6. Запустить тесты, убедиться что все проходят

## Verification Steps

1. `cd server && npm test`
   - Expected: 8/8 тестов green
2. Запустить сервер, затем: `node server/tests/manual/create-room.js`
   - Expected: `room_created: { code: 'XXXX', playerId: '...', color: '#...' }`
3. Проверить что два разных кода у двух комнат: запустить скрипт дважды
   - Expected: разные коды

## Reviewers

- code-reviewer
- security-auditor

## Acceptance Criteria

- [ ] Все 8 unit-тестов проходят
- [ ] `create_room` создаёт комнату с уникальным 4-символьным кодом
- [ ] `join_room` с правильным кодом → `room_joined` с данными комнаты
- [ ] `join_room` с неверным кодом → `join_error`
- [ ] `join_room` в полную комнату (4 игрока) → `join_error`
- [ ] `disconnect` чистит игрока из комнаты и рассылает `player_left`
- [ ] Комната удаляется когда все игроки отключились
