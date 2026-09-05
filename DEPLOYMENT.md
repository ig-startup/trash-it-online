# Trash It Online — Deployment Guide

## Current Status

✅ **Ready for deployment**
- MVP complete with 25/25 tests passing
- Unified server: Node.js + Express + Socket.io
- Server serves both WebSocket API and client static files
- Atari permission confirmed for non-commercial use

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
     PORT=3000
     CLIENT_URL=https://<your-project>.railway.app
     ```

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
- Verify `client/dist/` is built (should see 357 KB gzip)
- Check CORS: `CLIENT_URL` must match your Railway domain

### Socket.io connection fails
- Verify WebSocket is enabled (Railway supports it by default)
- Check browser console for connection errors
- Try incognito/private mode

### Build fails
- Railway shows build logs — look for Node/npm errors
- Most common: missing `npm run build` — already in `postinstall`
- Check client dependencies: any `npm` errors locally?

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
