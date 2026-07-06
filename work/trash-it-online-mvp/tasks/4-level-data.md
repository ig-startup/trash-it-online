---
status: planned
number: 4
wave: 1
skills: [code-writing]
verify: bash
---

# Task 4: Данные первого уровня

## What to do

Создать JSON-описание первого уровня игры Trash It. Уровень воссоздаётся вручную по видео/скриншотам оригинала — сохраняем общую геометрию, расположение платформ, объектов и колокольчика. Точное попиксельное совпадение не требуется для MVP.

## Context Files

- `work/trash-it-online-mvp/tech-spec.md` — секция Data Model (формат JSON)
- `Trash-it-original/` — оригинальные файлы игры (бинарные, для справки)

## Test-Driven Development

Написать простой валидатор схемы:

Файл: `server/tests/level-schema.test.js`

1. `level01 has required fields` — id, widthTiles, heightTiles, tileSize, timeLimit, spawnPoints, platforms, bell
2. `level01 has at least 2 spawn points` — для 2 игроков минимум
3. `level01 has exactly one bell` — ровно одна цель
4. `level01 platforms are valid` — у каждой платформы есть x, y, width, height
5. `level01 destructibles have hp` — у разрушаемых объектов есть hp > 0

## Implementation Steps

1. Написать тесты — они упадут
2. Изучить оригинал по описанию: уровень 1 — строительная площадка, несколько этажей, лестницы/балки, мусор, колокольчик вверху справа
3. Создать `client/src/levels/level01.json`:
   - Размер: 3200×640 (100×20 тайлов по 32px)
   - timeLimit: 180 секунд
   - 4 точки спауна внизу слева (для 4 игроков)
   - Пол (основание)
   - 3-4 этажа платформ с промежутками
   - Несколько разрушаемых блоков (балки, кирпичи) hp=1
   - Колокольчик вверху справа
   - Балки для прыжков между этажами
4. Запустить тесты — все должны пройти

## Verification Steps

1. `cd server && npm test -- --testPathPattern=level-schema`
   - Expected: 5/5 тестов green
2. `node -e "const l = require('./client/src/levels/level01.json'); console.log('OK', l.id)"`
   - Expected: `OK level_01`

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] Все 5 тестов схемы проходят
- [ ] JSON валидный, парсится без ошибок
- [ ] 4 точки спауна
- [ ] Минимум 3 платформы-этажа
- [ ] Минимум 3 разрушаемых объекта
- [ ] Один колокольчик
- [ ] timeLimit = 180
