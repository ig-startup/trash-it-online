---
status: planned
number: 11
wave: final
skills: []
verify: manual
---

# Task 11: Деплой на Railway

## What to do

Подготовить проект к деплою и задеплоить на Railway. Сервер обслуживает как Socket.io API, так и статику клиента (из `client/dist/`). Один сервис — один URL.

## Context Files

- `server/src/index.js`
- `client/package.json`
- `server/package.json`

## Implementation Steps

1. Обновить `server/src/index.js` — добавить раздачу статики:
   ```js
   app.use(express.static(path.join(__dirname, '../../client/dist')));
   app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../../client/dist/index.html')));
   ```

2. Добавить `build` скрипт в корневой `package.json`:
   ```json
   {
     "scripts": {
       "build": "cd client && npm install && npm run build",
       "start": "cd server && npm install && node src/index.js"
     }
   }
   ```

3. Обновить `client/vite.config.js` — убрать proxy в production (сервер и клиент на одном URL)

4. Обновить CORS в `server/src/index.js` — в production разрешать только собственный URL Railway:
   ```js
   const origin = process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : '*';
   ```

5. Создать `railway.json` или настроить через Railway UI:
   - Build command: `npm run build`
   - Start command: `npm start`
   - Port: из `process.env.PORT || 3000`

6. Создать аккаунт Railway (если нет), создать проект, подключить GitHub репозиторий, задеплоить

7. Проверить что переменная `CLIENT_URL` установлена в Railway окружении

## Verification Steps

1. Открыть URL Railway в браузере
   - Expected: видно меню игры
2. Создать комнату → поделиться ссылкой → подключиться с телефона
   - Expected: оба устройства видят друг друга в лобби
3. `curl https://{railway-url}/health`
   - Expected: `{"status":"ok"}`

## Acceptance Criteria

- [ ] Сайт открывается по публичному URL без localhost
- [ ] `GET /health` возвращает 200
- [ ] Socket.io соединение устанавливается через интернет
- [ ] Можно создать комнату и подключиться с другого устройства
- [ ] CORS настроен для production URL
