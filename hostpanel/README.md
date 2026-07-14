# HOST PANEL — Standalone Deploy Server

Render jaisa **alag** deploy panel — Dark Panel se independent.
Python bots, Node apps, ZIP upload, PM2, GitHub auto-deploy.

## Features

- Admin login (apna username/password)
- **ZIP upload** — bot folder zip karo, upload karo, auto run
- **Git deploy** — GitHub repo + webhook auto-deploy
- PM2: start / stop / restart / logs
- Deploy history + live console
- Python + Node.js support

---

## VPS Setup (Ubuntu)

### 1) Install dependencies

```bash
apt update
apt install -y nodejs npm git python3 python3-pip
npm install -g pm2
```

### 2) Clone / upload project

```bash
mkdir -p /var/hostpanel
cd /var/hostpanel
# Option A: git clone your repo
# Option B: upload deploy-server folder via SFTP
```

Agar local se copy karna ho:
```bash
# Tumhare PC se (ya git push ke baad):
git clone https://github.com/YOUR_USER/hostpanel.git .
```

### 3) Configure

```bash
cd /var/hostpanel
npm install

cat > .env << 'EOF'
PORT=3100
JWT_SECRET=HostPanel_Secret_Change_This_abc123
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YourStrongPassword123
APPS_ROOT=/var/hostpanel/apps
DATA_PATH=/var/hostpanel/data/store.json
PUBLIC_URL=http://200.97.170.106:3100
MAX_UPLOAD_MB=50
EOF

mkdir -p /var/hostpanel/apps /var/hostpanel/data /var/hostpanel/uploads
```

### 4) Start with PM2

```bash
pm2 start src/index.js --name hostpanel
pm2 save
```

### 5) Open firewall + nginx (optional)

```bash
ufw allow 3100/tcp
```

**Nginx** (port 80 pe alag subdomain/path):

```bash
cat > /etc/nginx/sites-available/hostpanel << 'EOF'
server {
    listen 80;
    server_name host.200.97.170.106.nip.io;

    client_max_body_size 55M;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/hostpanel /etc/nginx/sites-enabled/hostpanel
nginx -t && systemctl reload nginx
```

Ya simple: `http://200.97.170.106:3100`

---

## Use

1. Open **http://200.97.170.106:3100**
2. Login: `admin` / `YourStrongPassword123`
3. **Deploy New → Upload ZIP**
   - Bot folder ko ZIP karo (main.py root me)
   - App ID, start script daalo
   - Upload & Deploy
4. **Dashboard** — status, restart, logs, console

### Git auto-deploy

1. Deploy New → Git Repository
2. Dashboard → Console → webhook URL copy
3. GitHub → Settings → Webhooks → paste URL → Push events

---

## Dark Panel vs HOST PANEL

| | Dark Panel | HOST PANEL |
|---|------------|------------|
| Port | 3000 | 3100 |
| Purpose | Device control | Bot/app deploy |
| ZIP upload | ❌ | ✅ |
| Standalone | Panel feature | Full separate UI |

Dono alag PM2 processes — ek saath chal sakte hain.

---

## Update

```bash
cd /var/hostpanel
git pull
npm install
pm2 restart hostpanel
```
