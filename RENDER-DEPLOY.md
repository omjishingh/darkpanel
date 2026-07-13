# Render par Backend Deploy — Step by Step

> **Important:** Render par Netlify jaisa drag-drop **nahi** hota.  
> GitHub se connect karna padta hai (5 minute ka kaam).

---

## Step 1: GitHub par backend upload

1. [github.com](https://github.com) → login
2. **New repository** → naam: `dark-panel-api` → **Create**
3. **"uploading an existing file"** link par click
4. Ye files/folders upload karo (`backend` folder se):
   - `package.json`
   - `package-lock.json`
   - `render.yaml`
   - `src/` (poora folder)
   - `data/.gitkeep`
   - `.env.example`
5. **Commit changes**

> `node_modules` upload **mat** karo — Render khud `npm install` karega.

---

## Step 2: Render par Web Service

Screenshot mein jo dikh raha hai:

1. **"Deploy a Web Service"** card par click karo  
   *(ya top-right **+ New** → **Web Service**)*
2. **Connect GitHub** → `dark-panel-api` repo select
3. Settings:

| Setting | Value |
|---------|-------|
| **Name** | `dark-panel-api` |
| **Region** | Singapore (India ke liye fast) |
| **Branch** | `main` |
| **Root Directory** | *(khali — agar sirf backend repo hai)* |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

4. **Environment Variables** add karo:

| Key | Value |
|-----|-------|
| `ADMIN_KEY` | apna secret key (e.g. `MyAdminKey2024!`) |
| `JWT_SECRET` | long random string |
| `DATA_PATH` | `/opt/render/project/src/data/accounts.json` |
| `TELEGRAM_2FA_ENABLED` | `false` |
| `NODE_VERSION` | `20` |

5. **Create Web Service** dabao
6. 2-5 minute wait — **Live** ho jayega

---

## Step 3: API URL copy karo

Deploy hone ke baad URL milega:

```
https://dark-panel-api.onrender.com
```

Test browser mein:
```
https://dark-panel-api.onrender.com/api/health
```

`{"ok":true,...}` aana chahiye.

---

## Step 4: Pehla user account banao

PowerShell mein (apna URL + ADMIN_KEY daalo):

```powershell
curl -X POST https://dark-panel-api.onrender.com/api/admin/accounts `
  -H "Content-Type: application/json" `
  -H "X-Admin-Key: MyAdminKey2024!" `
  -d '{\"username\":\"user1\",\"password\":\"Pass123!\"}'
```

---

## Step 5: APK mein URL daalo

APK login screen:
```
https://dark-panel-api.onrender.com/
```

---

## Free tier note

- 15 min inactive ke baad **sleep** hota hai
- Pehli request 30-50 sec slow ho sakti hai
- Normal hai free plan par

---

## Agar poora `dark panel` repo upload kiya ho

Root Directory mein likho: `backend`
