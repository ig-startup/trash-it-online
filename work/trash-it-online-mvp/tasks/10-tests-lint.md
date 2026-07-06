---
status: planned
number: 10
wave: final
skills: []
verify: bash
---

# Task 10: Тесты и линтинг

## What to do

Убедиться что все тесты проходят, добавить недостающие, настроить линтер ESLint для обоих пакетов.

## Context Files

- `server/tests/`
- `server/package.json`
- `client/package.json`

## Implementation Steps

1. Запустить все тесты: `cd server && npm test`
   - Исправить упавшие тесты
2. Добавить ESLint в server и client:
   - `npm install --save-dev eslint` в оба пакета
   - Конфиг: `eslint.config.js` с правилами для Node.js / браузера
   - Добавить `"lint": "eslint src"` в scripts
3. Запустить `npm run lint` в обоих пакетах, исправить ошибки
4. Добавить `npm run lint` в CI-проверку (package.json scripts)

## Verification Steps

1. `cd server && npm test` — все тесты green
2. `cd server && npm run lint` — 0 ошибок
3. `cd client && npm run lint` — 0 ошибок

## Acceptance Criteria

- [ ] Все unit-тесты (RoomManager, GameRoom) проходят
- [ ] Все интеграционные тесты (sync) проходят
- [ ] Тест схемы уровня проходит
- [ ] ESLint настроен для server и client
- [ ] Lint проходит без ошибок
