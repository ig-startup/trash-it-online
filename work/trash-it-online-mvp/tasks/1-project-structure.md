---
status: planned
number: 1
wave: 1
skills: [code-writing]
verify: bash
---

# Task 1: Структура проекта и сборка

## What to do

Создать скелет монорепозитория с тремя пакетами: `client/`, `server/`, `shared/`. Настроить сборку клиента (Vite + Phaser.js), запуск сервера (Node.js + Express + Socket.io), CORS и `/health` endpoint. После задачи оба приложения должны стартовать без ошибок.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md`
- `work/trash-it-online-mvp/user-spec.md`

## Test-Driven Development

Для T1 TDD не применяется — это инфраструктурная задача. Проверяем запуском и билдом.

## Implementation Steps

1. Создать `shared/constants.js` — экспортировать `EVENTS`, `GAME_CONFIG`, `PLAYER_COLORS`
2. Создать `server/package.json` с зависимостями: express, socket.io, nodemon (dev), jest (dev)
3. Создать `server/src/index.js` — Express + Socket.io + CORS (`*` для dev) + GET `/health` → `{"status":"ok"}` + логирование подключений
4. Создать `client/package.json` с зависимостями: phaser, socket.io-client, vite (dev)
5. Создать `client/vite.config.js` — proxy `/socket.io` → `http://localhost:3000` в dev-режиме
6. Создать `client/public/index.html` — минимальный HTML с `<canvas>` и подключением `src/main.js`
7. Создать `client/src/main.js` — инициализация Phaser.Game с конфигом (800×600, Arcade Physics, пустая сцена Boot)
8. Создать `.gitignore` в корне — node_modules, dist, .env
9. Добавить `npm run dev` скрипты в оба package.json

## Verification Steps

1. `cd server && npm install && node src/index.js`
   - Expected: `Server listening on port 3000`
2. `curl -s http://localhost:3000/health`
   - Expected: `{"status":"ok"}`
3. `cd client && npm install && npm run build`
   - Expected: `dist/` создан без ошибок
4. `cd client && npm run dev`
   - Expected: Vite стартует, `http://localhost:5173` открывается без ошибок в консоли

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] `shared/constants.js` экспортирует EVENTS, GAME_CONFIG, PLAYER_COLORS
- [ ] Сервер стартует на порту 3000
- [ ] GET `/health` возвращает `{"status":"ok"}`
- [ ] CORS настроен (сервер принимает запросы с localhost:5173)
- [ ] Клиент собирается (`npm run build`) без ошибок
- [ ] Phaser инициализируется без ошибок в браузере
