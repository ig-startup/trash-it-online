---
status: planned
number: 3
wave: 1
skills: [code-writing]
verify: manual
---

# Task 3: Клиент — MenuScene + LobbyScene

## What to do

Реализовать два экрана Phaser-игры: главное меню (выбор режима, создать/войти в комнату) и лобби (список игроков, кнопка готовности, кнопка старта для хоста). Подключить SocketManager для связи с сервером.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md` — секции Socket.io Events, Solution Approach
- `shared/constants.js`
- `client/src/main.js`

## Test-Driven Development

UI-сцены не тестируются unit-тестами. Проверка визуальная.

## Implementation Steps

1. Создать `client/src/network/SocketManager.js`:
   - Синглтон — `SocketManager.getInstance()`
   - `connect(serverUrl)` → устанавливает соединение
   - `emit(event, data)` — отправить событие
   - `on(event, callback)` — подписаться
   - `off(event, callback)` — отписаться
   - Хранит `playerId`, `roomCode`, `isHost`, `mode`

2. Создать `client/src/scenes/MenuScene.js`:
   - Заголовок "TRASH IT ONLINE"
   - Две кнопки режима: "Кооп" / "Гонка" (toggle, по умолчанию "Кооп")
   - Input поле: имя игрока (default "Player")
   - Кнопка "Создать комнату" → emit `create_room` → переход в LobbyScene
   - Input поле: код комнаты (4 символа, uppercase)
   - Кнопка "Войти" → emit `join_room` → переход в LobbyScene или показать ошибку
   - Обработка `room_created` и `room_joined` от сервера
   - Обработка `join_error` — показать текст ошибки красным

3. Создать `client/src/scenes/LobbyScene.js`:
   - Показывать код комнаты крупно (для шаринга)
   - Список игроков с цветными иконками и статусом готовности
   - Кнопка "Готов" / "Не готов" (toggle)
   - Кнопка "Старт" — только у хоста, активна когда все готовы
   - При нажатии "Старт" → emit `start_game` → переход в GameScene
   - Обработка событий: `player_joined`, `player_left`, `player_ready_changed`, `game_started`

4. Обновить `client/src/main.js` — добавить MenuScene и LobbyScene в конфиг Phaser

## Verification Steps

1. `cd client && npm run dev`, открыть `http://localhost:5173`
   - Expected: видно меню с заголовком и кнопками
2. Нажать "Создать комнату" (сервер должен быть запущен)
   - Expected: переход в лобби, виден 4-значный код
3. В другой вкладке ввести код и нажать "Войти"
   - Expected: оба игрока видят друг друга в лобби
4. Нажать "Готов" в обеих вкладках
   - Expected: у хоста активируется кнопка "Старт"

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] MenuScene отображается при старте
- [ ] Можно создать комнату и попасть в LobbyScene
- [ ] Можно войти в комнату по коду из другого браузера
- [ ] Ошибка входа (неверный код) отображается
- [ ] В лобби виден список игроков с именами
- [ ] Кнопка "Старт" только у хоста и только когда все готовы
- [ ] `game_started` переводит в GameScene (заглушка сцены)
