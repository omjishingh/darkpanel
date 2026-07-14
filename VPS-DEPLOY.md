# VPS Deploy Guide — Dark Panel + Bots

Yeh guide tumhare Hostinger VPS (`200.97.170.106`) ko Render jaisa deploy server banata hai.

## 1. Server Hub enable karo

`/var/darkpanel/.env` me yeh add karo:

```env
SERVER_HUB_ENABLED=true
SERVER_ADMIN_USERNAME=admin
PUBLIC_URL=http://200.97.170.106
```

- `SERVER_ADMIN_USERNAME` = woh panel username jisko **Deploy Hub** dikhega
- Pehle account `admin` naam se banao (ya jo username set kiya ho)

Phir restart:

```bash
cd /var/darkpanel
pm2 restart darkpanel --update-env
```

## 2. Panel me Deploy Hub

1. Browser: http://200.97.170.106
2. Admin account se login (`admin` ya jo set kiya)
3. Sidebar me **Deploy Hub** dikhega
4. Wahan se:
   - Apps status (online/offline)
   - Deploy / Restart / Stop / Logs
   - GitHub auto-deploy webhook URL copy

## 3. Bot / app add karna

### VPS par folder banao

```bash
mkdir -p /var/apps/bot1
cd /var/apps/bot1
git clone https://github.com/YOUR_USER/YOUR_BOT.git .
npm install   # ya pip install -r requirements.txt
```

### Panel se add karo

Deploy Hub → **Add Bot / App**:
- App ID: `bot1`
- Path: `/var/apps/bot1`
- PM2 Name: `bot1`
- Start Script: `index.js` (ya `bot.py`)
- Type: Node / Python
- Repo URL + branch

Phir **Deploy** dabao — PM2 start ho jayega.

## 4. Auto-deploy (Render jaisa)

Har app ka webhook URL Deploy Hub me dikhega, jaise:

```
http://200.97.170.106/api/deploy/webhook/darkpanel?secret=xxxx
```

### GitHub webhook setup

1. GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. Payload URL: upar wala URL (copy from panel)
3. Content type: `application/json`
4. Events: **Just the push event**
5. Save

Ab `git push` pe auto `git pull` + `npm install` + `pm2 restart` hoga.

## 5. Useful PM2 commands (SSH)

```bash
pm2 list
pm2 logs darkpanel
pm2 logs bot1
pm2 restart all
```

## 6. Nginx (already setup)

Panel port 80 pe: `http://200.97.170.106` → Node port 3000

## 7. Update panel code on VPS

```bash
cd /var/darkpanel
git pull
npm install
pm2 restart darkpanel --update-env
```

Ya panel se Deploy Hub → **darkpanel** → **Deploy**

---

**Security tips:**
- `JWT_SECRET` aur `ADMIN_KEY` strong rakho
- Sirf trusted GitHub repos ke liye webhook lagao
- `SERVER_ADMIN_USERNAME` sirf apna main account rakho
