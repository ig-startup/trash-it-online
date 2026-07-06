---
status: planned
number: 6
wave: 2
skills: [code-writing]
verify: bash
---

# Task 6: Сервер — GameRoom стейт-машина + игровые события

## What to do

Реализовать полную стейт-машину GameRoom: переходы lobby→playing→ended, управление таймером, обработку игровых событий (bell_hit, object_hit, start_game). Написать unit-тесты для всех переходов и краевых случаев.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md` — секции Data Model, Socket.io Events
- `shared/constants.js`
- `server/src/GameRoom.js` (заглушка из T2)
- `server/src/RoomManager.js`

## Test-Driven Development

Файл: `server/tests/GameRoom.test.js`

1. `should start game and transition to playing state` — startGame() меняет state на 'playing'
2. `should reject start if already playing` — повторный startGame() не меняет состояние
3. `should start timer on game start` — после startGame таймер активен
4. `should emit level_failed on timeout` — по истечении timeLimit вызывается коллбэк с 'timeout'
5. `should handle bell_hit in coop mode` — bell_hit в coop → level_complete с winnerId=null
6. `should handle bell_hit in race mode` — bell_hit в race → level_complete с winnerId=socketId
7. `should handle object_hit` — уменьшает hp объекта, при hp=0 эмитирует object_destroyed
8. `should not handle events when not playing` — bell_hit в lobby игнорируется
9. `should cleanup timer on game end` — после level_complete таймер очищается

## Implementation Steps

1. Написать тесты — они упадут
2. Реализовать `server/src/GameRoom.js`:
   - `constructor({ code, mode, hostId, io })` — io нужен для emit в комнату
   - `addPlayer(player)` / `removePlayer(socketId)`
   - `startGame(levelId)`:
     - Проверить state === 'lobby'
     - Установить state = 'playing'
     - Запустить таймер: каждую секунду emit `timer_tick`, при 0 → `level_failed`
   - `handleBellHit(socketId)`:
     - Проверить state === 'playing'
     - В coop: emit `level_complete` с `{ winnerId: null }`
     - В race: emit `level_complete` с `{ winnerId: socketId }`
     - Установить state = 'ended', очистить таймер
   - `handleObjectHit(socketId, objectId)`:
     - Найти объект в state.objects
     - Уменьшить hp
     - При hp=0: удалить объект, broadcast `object_destroyed`
   - `endGame(reason)` — cleanup таймера, state = 'ended'
3. Добавить Socket.io обработчики в `server/src/index.js`:
   - `start_game` → только хост, вызвать `room.startGame('level_01')`
   - `bell_hit` → `room.handleBellHit(socket.id)`
   - `object_hit` → `room.handleObjectHit(socket.id, data.objectId)`
4. Запустить тесты

## Verification Steps

1. `cd server && npm test`
   - Expected: все тесты green (включая T2 тесты)
2. Вручную: создать комнату, войти, нажать Старт — в логах сервера видно переход состояния
3. Подождать 180 секунд или изменить timeLimit в тесте на 1 → level_failed приходит

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] Все 9 unit-тестов проходят
- [ ] startGame переводит в state='playing'
- [ ] Таймер тикает каждую секунду, emit timer_tick
- [ ] Таймаут → level_failed всем игрокам в комнате
- [ ] bell_hit в coop → level_complete для всех, winnerId=null
- [ ] bell_hit в race → level_complete для всех, winnerId=socketId победителя
- [ ] object_hit уменьшает hp, при 0 → object_destroyed
- [ ] Только хост может emit start_game
