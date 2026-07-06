---
status: planned
number: 5
wave: 2
skills: [code-writing]
verify: manual
---

# Task 5: Клиент — GameScene + Player (физика)

## What to do

Реализовать основную игровую сцену Phaser с загрузкой уровня из JSON и локальным управлением персонажем. Персонаж — цветной прямоугольник (спрайты добавим позже). Физика: бег, прыжок, приседание, удар молотком (анимация+разрушение объекта).

## Context Files

- `work/trash-it-online-mvp/tech-spec.md`
- `client/src/levels/level01.json`
- `shared/constants.js`
- `client/src/scenes/LobbyScene.js` (передаёт данные в GameScene)

## Test-Driven Development

Физика Phaser не тестируется unit-тестами. Проверка визуальная.

## Implementation Steps

1. Создать `client/src/entities/Player.js`:
   - Extends `Phaser.Physics.Arcade.Sprite` (или `Image` если нет спрайтов)
   - Конструктор: `(scene, x, y, color, isLocal)`
   - Методы управления: `update(cursors)` — проверяет нажатия
   - Состояния: `idle`, `run`, `jump`, `crouch`, `hammer`
   - Движение: скорость 200, прыжок -400 (только на земле)
   - Приседание: уменьшает hitbox по высоте вдвое
   - Удар молотком: `hammering` анимация на 300мс, emit `hammer_swing` событие
   - Свойства: `playerId`, `playerName`, `playerColor`

2. Создать `client/src/scenes/GameScene.js`:
   - `init(data)` — принимает `{ roomCode, players, mode, levelId }` из LobbyScene
   - `preload()` — ничего (используем примитивы для MVP)
   - `create()`:
     - Загрузить `level01.json`
     - Нарисовать платформы как статические тела (зелёные прямоугольники)
     - Нарисовать разрушаемые объекты (коричневые прямоугольники, с hp)
     - Нарисовать колокольчик (жёлтый кружок)
     - Спаунить локального Player на spawnPoints[playerIndex]
     - Настроить коллайдеры: Player ↔ платформы, Player ↔ destructibles
     - Настроить камеру: следить за локальным игроком, boundsы по размеру уровня
     - Настроить клавиши: стрелки/WASD для движения, Space/Up для прыжка, Z/X для молотка
   - `update()`:
     - Вызвать `player.update(cursors)`
     - Проверить overlap Player с колокольчиком при ударе молотком → emit `bell_hit`
     - Каждые 50мс отправлять `player_update` с позицией (throttle)

3. Логика разрушения объектов:
   - При ударе молотком проверить overlap с destructibles
   - Уменьшить hp объекта
   - При hp=0 — удалить объект, emit `object_hit` с objectId

4. Обновить `client/src/main.js` — добавить GameScene

## Verification Steps

1. `cd client && npm run dev`
2. Создать комнату, войти в лобби, нажать Старт
   - Expected: переход в GameScene, виден уровень и персонаж
3. Нажать стрелки — персонаж двигается
4. Нажать вверх/Space — персонаж прыгает с платформ
5. Нажать вниз — персонаж приседает
6. Нажать Z — персонаж анимирует удар
7. Добраться до разрушаемого блока и ударить — блок исчезает
8. Добраться до колокольчика и ударить — в консоли `bell_hit`

## Reviewers

- code-reviewer

## Acceptance Criteria

- [ ] Уровень загружается из level01.json и рендерится
- [ ] Персонаж стоит на платформах (коллизии работают)
- [ ] Бег влево/вправо работает
- [ ] Прыжок работает, двойной прыжок невозможен
- [ ] Приседание работает (hitbox уменьшается)
- [ ] Удар молотком — визуальная анимация (смена цвета/формы)
- [ ] Разрушаемые блоки удаляются при ударе
- [ ] Камера следит за персонажем
- [ ] Колокольчик эмитирует событие при ударе
