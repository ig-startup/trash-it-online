---
created: 2026-07-06
status: approved
branch: feature/mvp
size: L
acceptance_criteria:
  - [ ] Игра открывается в браузере на Mac и Windows без установки
  - [ ] Создать комнату и подключиться по коду с другого устройства
  - [ ] До 4 игроков одновременно в одной комнате
  - [ ] Задержка управления < 100 мс (клиентская предикция)
  - [ ] Позиции всех игроков синхронизированы на всех экранах
  - [ ] Реализован 1 полноценный уровень из оригинала
  - [ ] Работают режимы: кооп и соревнование
  - [ ] Таймер на уровне, при истечении — поражение
  - [ ] При ударе в колокольчик уровень завершается корректно
---

# Tech Spec: Trash It Online — MVP

## Solution Approach

Два независимых приложения в одном репозитории:

- **`client/`** — браузерная игра на Phaser.js + Vite. Рендеринг через HTML5 Canvas, Arcade Physics для платформера, Socket.io-client для связи с сервером.
- **`server/`** — Node.js + Socket.io. Управляет комнатами, состоянием игры, рассылает события всем участникам комнаты.
- **`shared/`** — общие константы (имена событий, конфиг).

```
trash-it-online/
├── client/
│   ├── src/
│   │   ├── main.js               # Phaser app entry point
│   │   ├── scenes/
│   │   │   ├── MenuScene.js      # Главное меню, создать/войти в комнату
│   │   │   ├── LobbyScene.js     # Зал ожидания, список игроков
│   │   │   └── GameScene.js      # Основная игра
│   │   ├── network/
│   │   │   └── SocketManager.js  # Обёртка над socket.io-client
│   │   ├── entities/
│   │   │   ├── Player.js         # Локальный игрок (с предикцией)
│   │   │   └── RemotePlayer.js   # Другие игроки (интерполяция)
│   │   └── levels/
│   │       └── level01.json      # Данные первого уровня
│   ├── public/
│   │   └── index.html
│   └── package.json              # Vite + Phaser + socket.io-client
├── server/
│   ├── src/
│   │   ├── index.js              # Express + Socket.io entry point
│   │   ├── RoomManager.js        # Создание/поиск/удаление комнат
│   │   └── GameRoom.js           # Стейт-машина одной комнаты
│   ├── tests/
│   └── package.json              # Express + Socket.io + Jest
└── shared/
    └── constants.js              # EVENTS, GAME_CONFIG
```

**Сетевая модель:**
- Клиент двигает локального игрока сразу (предикция) — нет ощущения лага
- Каждые 50 мс отправляет позицию на сервер
- Сервер рассылает позицию всем остальным в комнате
- Для MVP без серверной авторизации позиций (семейная игра, читеры не нужны)

## Decision Log

| Decision | Rationale | Alternatives |
|----------|-----------|--------------|
| Phaser.js | Готовая физика, спрайты, ввод — не пишем движок | Vanilla Canvas (сложнее), Unity WebGL (тяжелее) |
| Arcade Physics | Проще Matter.js, достаточно для платформера с прямоугольниками | Matter.js (избыточен для MVP) |
| Vite | Быстрый HMR, простой бандл | Webpack (медленнее, сложнее) |
| Socket.io | Реалтайм, fallback на long-polling, проверен | raw WebSocket (меньше возможностей) |
| JSON тайлмап | Читаемый формат, совместим с Phaser.Tilemaps | Бинарный формат оригинала (не задокументирован) |
| Клиентская предикция | Отклик < 16 мс вместо RTT | Без предикции (ощутимый лаг при 50+ мс пинге) |
| CORS открыт на origin клиента (dev: `*`, prod: URL деплоя) | Простая настройка для семейного проекта без внешних пользователей | Строгий whitelist (избыточно для MVP) |
| При коллизии кода комнаты — генерируем новый | 4 символа = 1.6M комбинаций, коллизия маловероятна, но проверка дешёвая | Увеличить длину кода (не нужно для 4 игроков) |
| При дисконнекте игрока во время игры — он просто исчезает у остальных (без host migration) | Семейная игра на 4 человека, полноценный reconnect — overkill для MVP | Полный reconnect + host migration (следующая итерация) |

## Data Model

### Структура комнаты (server-side, in-memory)

```js
Room {
  code: "XKCD",          // 4 символа, уникальный
  mode: "coop"|"race",
  hostId: socketId,
  players: Map<socketId, Player>,
  state: "lobby"|"playing"|"ended",
  timer: null,           // NodeJS Timer
  levelId: "level_01"
}

Player {
  id: socketId,
  name: "Player 1",
  color: "#ff4444",      // один из 4 цветов
  x: 0, y: 0,
  ready: false
}
```

### Формат уровня (JSON, client-side)

```json
{
  "id": "level_01",
  "widthTiles": 100,
  "heightTiles": 20,
  "tileSize": 32,
  "timeLimit": 180,
  "spawnPoints": [
    { "x": 100, "y": 500 },
    { "x": 150, "y": 500 }
  ],
  "platforms": [
    { "x": 0, "y": 600, "width": 3200, "height": 32, "type": "ground" }
  ],
  "destructibles": [
    { "x": 500, "y": 568, "width": 64, "height": 32, "hp": 1 }
  ],
  "bell": { "x": 2800, "y": 400 }
}
```

## Socket.io Events

### Client → Server

| Event | Payload | Описание |
|-------|---------|----------|
| `create_room` | `{ mode, playerName }` | Создать комнату |
| `join_room` | `{ code, playerName }` | Войти в комнату по коду |
| `player_ready` | — | Готов к игре |
| `start_game` | — | Только хост |
| `player_update` | `{ x, y, state, dir }` | Позиция и анимация игрока |
| `bell_hit` | — | Игрок ударил в колокольчик |
| `object_hit` | `{ objectId }` | Игрок ударил объект молотком |

### Server → Client

| Event | Payload | Описание |
|-------|---------|----------|
| `room_created` | `{ code, playerId, color }` | Комната создана |
| `room_joined` | `{ players, mode, hostId }` | Успешное подключение |
| `join_error` | `{ message }` | Комната не найдена / переполнена |
| `player_joined` | `{ player }` | Новый игрок подключился |
| `player_left` | `{ playerId }` | Игрок отключился |
| `player_ready_changed` | `{ playerId, ready }` | Статус готовности |
| `game_started` | `{ levelId }` | Игра началась |
| `player_update` | `{ playerId, x, y, state, dir }` | Позиция другого игрока |
| `object_destroyed` | `{ objectId }` | Объект сломан |
| `level_complete` | `{ winnerId\|null }` | Уровень пройден |
| `level_failed` | `{ reason: "timeout" }` | Время вышло |
| `timer_tick` | `{ timeLeft }` | Каждую секунду |

## Dependencies

### client/
```json
{
  "phaser": "^3.80.0",
  "socket.io-client": "^4.7.0",
  "vite": "^5.0.0"
}
```

### server/
```json
{
  "express": "^4.18.0",
  "socket.io": "^4.7.0",
  "jest": "^29.0.0",
  "nodemon": "^3.0.0"
}
```

## Testing Strategy

- **Unit tests (Jest, server):** RoomManager — создание, поиск, удаление комнат; GameRoom — стейт-машина (lobby→playing→ended), логика победы/поражения, таймер.
- **Integration tests (Jest + socket.io-client):** подключение 2 клиентов, синхронизация позиций, событие `bell_hit` → `level_complete`.
- **E2E:** не делаем на MVP, проверяем руками на Mac + Windows.

## Agent Verification Plan

```bash
# Сервер стартует
cd server && npm start
# → "Server listening on port 3000"

# Health-check (REST, для базовой проверки что сервер жив)
curl -s http://localhost:3000/health
# → {"status":"ok"}

# Создание комнаты — проверяется через socket.io-client скрипт (не REST!),
# т.к. create_room — это Socket.io событие, а не HTTP endpoint
node server/tests/manual/create-room.js
# → "room_created: { code: 'XKCD', playerId: '...' }"

# Unit тесты
cd server && npm test
# → All tests passed

# Клиент билдится
cd client && npm run build
# → dist/ создан без ошибок
```

## Risks & Mitigation

- **Риск:** формат оригинальных уровней бинарный и не задокументирован. **Mitigation:** воссоздаём уровень 1 вручную по видео/скриншотам, начинаем с упрощённой геометрии.
- **Риск:** сетевой лаг делает управление дёрганным. **Mitigation:** клиентская предикция в Wave 2 T7.
- **Риск:** Phaser.js поведение в Safari отличается. **Mitigation:** тестируем в Chrome/Firefox, Safari — best effort.

## Implementation Waves

### Wave 1: Foundation (независимые задачи)

- [ ] **T1: Структура проекта и сборка**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: `cd client && npm run build` без ошибок; `cd server && node src/index.js` стартует; `curl /health` → `{"status":"ok"}`
  - Affected files: `client/package.json`, `client/vite.config.js`, `client/public/index.html`, `client/src/main.js`, `server/package.json`, `server/src/index.js` (включая CORS-конфиг и `/health` route), `shared/constants.js`
  - Reference files: —

- [ ] **T2: Сервер — RoomManager + Socket.io**
  - Skills: code-writing
  - Reviewers: code-reviewer, security-auditor
  - Verify: `npm test` → тесты RoomManager green; `curl /health` → `{"status":"ok"}`; socket.io-client скрипт получает `room_created` с кодом
  - Affected files: `server/src/RoomManager.js`, `server/src/GameRoom.js`, `server/src/index.js`, `server/tests/RoomManager.test.js`
  - Reference files: `shared/constants.js`

- [ ] **T3: Клиент — MenuScene + LobbyScene**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: браузер показывает меню, можно ввести код комнаты
  - Affected files: `client/src/scenes/MenuScene.js`, `client/src/scenes/LobbyScene.js`, `client/src/network/SocketManager.js`
  - Reference files: `shared/constants.js`

- [ ] **T4: Данные первого уровня**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: `level01.json` парсится без ошибок; платформы соответствуют геометрии оригинала
  - Affected files: `client/src/levels/level01.json`
  - Reference files: скриншоты из `Trash-it-original/`

### Wave 2: Game Core (зависит от Wave 1)

- [ ] **T5: Клиент — GameScene + Player (физика)**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: персонаж бегает, прыгает, приседает, бьёт молотком локально
  - Affected files: `client/src/scenes/GameScene.js`, `client/src/entities/Player.js`
  - Reference files: `client/src/levels/level01.json`, `shared/constants.js`

- [ ] **T6: Сервер — GameRoom стейт-машина + игровые события**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: `npm test` → тесты GameRoom green (start→playing, bell_hit→level_complete, таймер→level_failed)
  - Affected files: `server/src/GameRoom.js`, `server/tests/GameRoom.test.js`
  - Reference files: `shared/constants.js`

- [ ] **T7: Клиент — сетевая синхронизация (RemotePlayer)**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: интеграционный тест — 2 socket-клиента видят позиции друг друга
  - Affected files: `client/src/entities/RemotePlayer.js`, `client/src/scenes/GameScene.js`, `client/src/network/SocketManager.js`, `server/tests/sync.test.js`
  - Reference files: `shared/constants.js`

### Wave 3: Game Modes & UI (зависит от Wave 2)

- [ ] **T8: Режимы игры — кооп и соревнование**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: в кооп `bell_hit` завершает уровень для всех; в race — только победитель
  - Affected files: `server/src/GameRoom.js`, `client/src/scenes/GameScene.js`
  - Reference files: `shared/constants.js`

- [ ] **T9: UI-оверлеи — таймер, победа/поражение**
  - Skills: code-writing
  - Reviewers: code-reviewer
  - Verify: таймер отображается и убывает; экраны победы/поражения появляются корректно
  - Affected files: `client/src/scenes/GameScene.js`
  - Reference files: —

### Final Wave: QA & Deploy

- [ ] **T10: Тесты и линтинг**
  - Skills: —
  - Verify: `npm test` → все тесты green; `npm run lint` → 0 ошибок

- [ ] **T11: Деплой на Railway**
  - Skills: —
  - Verify: сайт открывается по публичному URL; можно создать комнату и подключиться с телефона

- [ ] **T12: QA на Mac + Windows**
  - Skills: —
  - Verify: ручная проверка по критериям приёмки — 2 браузера, реальный интернет
