---
status: planned
number: 7
wave: 2
skills: [code-writing]
verify: bash
---

# Task 7: Клиент — сетевая синхронизация (RemotePlayer)

## What to do

Реализовать синхронизацию позиций игроков через сеть: локальный игрок отправляет своё положение, удалённые игроки отображаются с интерполяцией позиций. Написать интеграционный тест: два socket-клиента видят позиции друг друга.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md` — сетевая модель, EVENTS
- `shared/constants.js`
- `client/src/entities/Player.js`
- `client/src/scenes/GameScene.js`
- `client/src/network/SocketManager.js`

## Test-Driven Development

Файл: `server/tests/sync.test.js` (интеграционный, Jest + socket.io-client)

1. `two clients should receive each other's positions` — клиент A отправляет player_update, клиент B получает player_update с правильным playerId
2. `position update should include all required fields` — x, y, state, dir, playerId
3. `client should not receive own position back` — A не получает свои собственные updates

## Implementation Steps

1. Написать интеграционные тесты (поднимают реальный сервер на тестовом порту)
2. Создать `client/src/entities/RemotePlayer.js`:
   - Extends Phaser.GameObjects.Rectangle (или Image)
   - Конструктор: `(scene, x, y, color, playerId, playerName)`
   - `targetX`, `targetY` — целевая позиция из сервера
   - `update()` — интерполяция: `x += (targetX - x) * 0.2` каждый кадр
   - `applyUpdate({ x, y, state, dir })` — обновить target позицию
   - Флип спрайта по dir ('left'/'right')
3. Обновить `client/src/scenes/GameScene.js`:
   - `remotePlayers = new Map()` — Map<playerId, RemotePlayer>
   - При получении `room_joined` / `game_started` — создать RemotePlayer для каждого другого игрока
   - Обработчик `player_update` — найти/создать RemotePlayer, вызвать `applyUpdate`
   - Обработчик `player_left` — удалить RemotePlayer из сцены
   - Обработчик `player_joined` — создать новый RemotePlayer (если входят после старта)
   - В методе `update()` вызывать `remotePlayer.update()` для каждого
4. Обновить `client/src/network/SocketManager.js`:
   - Добавить метод `sendPlayerUpdate(x, y, state, dir)` с throttle 50мс
5. Обновить `client/src/entities/Player.js`:
   - В методе `update()` после движения вызвать `SocketManager.getInstance().sendPlayerUpdate(...)`
6. Запустить интеграционные тесты

## Verification Steps

1. `cd server && npm test -- --testPathPattern=sync`
   - Expected: 3/3 тестов green
2. Открыть два браузера, создать комнату, войти, начать игру
   - Expected: в обоих браузерах видны два персонажа
3. Двигать персонажа в одном браузере
   - Expected: в другом браузере персонаж плавно перемещается (интерполяция)

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] Все 3 интеграционных теста проходят
- [ ] RemotePlayer отображается для каждого другого игрока
- [ ] Движение локального игрока видно в других браузерах
- [ ] Интерполяция — движение плавное, без резких прыжков
- [ ] player_left удаляет RemotePlayer со сцены
- [ ] Игрок не получает свои собственные позиции обратно
- [ ] Throttle 50мс — не более 20 обновлений в секунду
