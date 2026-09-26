# Trash It Online — Deployment Guide

## Current Status

✅ **Ready for deployment**
- 34/34 tests passing, including an end-to-end suite that boots the real
  `server/src/index.js` and drives two socket.io clients through a full
  room lifecycle
- Unified server: Node.js + Express + Socket.io
- Server serves both WebSocket API and client static files
- The deploy path (`npm install && npm run build && npm start` from the repo
  root, `NODE_ENV=production`) was verified on a clean copy of the tree
- Atari permission confirmed for non-commercial use

## How the build fits together

Railway's nixpacks looks at the repository root, so the root `package.json`
is what drives the deploy:

| Command | What it does |
|---|---|
| `npm run build` | installs client deps → `vite build` → installs server prod deps |
| `npm start` | `node server/src/index.js` — serves `client/dist/` and the socket API |

`railway.json` points `startCommand` at `npm start` and sets
`healthcheckPath` to `/health`.

## Deployment to Railway

### Option 1: Web Dashboard (Recommended)

1. **Create Railway project**
   - Go to https://railway.app
   - Sign up / Log in with GitHub
   - Click "New Project" → "GitHub Repo"

2. **Connect repository**
   - Select this repository
   - Railway will auto-detect Node.js + detect `railway.json`

3. **Configure environment**
   - Add these variables in Railway dashboard:
     ```
     NODE_ENV=production
     ```
   - `PORT` is injected by Railway — do not set it yourself.
   - `CLIENT_URL` is optional: the client is served from this same server, so
     the browser talks same-origin and CORS never applies. Only set it if the
     client is ever hosted on a different domain.

4. **Deploy**
   - Railway auto-deploys on push to main
   - Watch logs: deployment takes ~3 minutes
   - Get public URL: https://<your-project>.railway.app

### Option 2: Railway CLI

```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Link this project
railway link

# Set environment
railway variables set NODE_ENV=production

# Deploy
railway up

# View logs
railway logs
```

## Testing After Deploy

1. **Health check**
   ```bash
   curl https://<your-project>.railway.app/health
   # Expected: {"status":"ok"}
   ```

2. **Open game**
   - Visit: https://<your-project>.railway.app
   - Create room → Join on another device
   - Test multiplayer sync

## Troubleshooting

### Client doesn't load
- Check logs: `railway logs` or dashboard
- Verify `client/dist/` is built (~411 KB gzip for the bundle plus the
  original game's sprites)
- If you set `CLIENT_URL`, it must match your Railway domain exactly

### Socket.io connection fails
- Verify WebSocket is enabled (Railway supports it by default)
- Check browser console for connection errors
- Try incognito/private mode

### Build fails
- Railway shows build logs — look for Node/npm errors
- Reproduce the exact deploy path locally on a clean copy:
  ```bash
  git clone . /tmp/deploy-check && cd /tmp/deploy-check
  npm install && npm run build
  NODE_ENV=production PORT=3222 npm start
  curl localhost:3222/health
  ```
- If nixpacks does not detect Node at all, check that the root
  `package.json` is committed — without it there is nothing to detect and
  no dependency ever gets installed.

## After Successful Deploy

1. Share URL with family to play together
2. Test on multiple devices (Mac/Windows/Mobile)
3. Report any bugs/sync issues
4. Consider future improvements (more levels, persistence, etc.)

## Atari Attribution

Add to game's main menu or footer:

> Based on "Trash It" © 1997 Atari Corporation
> Recreation for family use with permission

---

**Questions?** Check tech-spec at `work/trash-it-online-mvp/tech-spec.md`
