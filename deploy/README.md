# Deploying MSM Accounting on Windows 11 with Docker

Internal, multi-user LAN deployment. One Windows 11 PC runs everything as three
containers behind a single HTTPS origin (`https://accounting.msm`); staff reach
it from their own PCs over the office network.

```
office PCs ──https://accounting.msm──▶ [ web: Caddy ] ──/api──▶ [ backend: Next.js ] ──▶ [ db: Postgres ]
   (TLS trusted via Caddy's root cert)     :443                      :3000                  named volume
```

Prerequisite: **Docker Desktop is installed and running** (WSL2 backend). All
commands below run in **PowerShell**, from the `deploy` folder unless noted.

---

## 1. Configure

```powershell
cd "path\to\MSM Accounting Software\deploy"
copy .env.example .env
notepad .env
```

Set at minimum:
- `POSTGRES_PASSWORD` — strong password
- `JWT_SECRET` — long random string (the file shows a one-liner to generate one)
- `SITE_HOST` — the hostname staff will type (default `accounting.msm`; avoid `.local`)
- `PLATFORM_ADMIN_EMAILS` — your email, to enable Backup & Restore
- `BACKUP_DIR_HOST` — a real folder, e.g. `D:/msm-backups`

## 2. Point the hostname at the server

Find the server's LAN IP:

```powershell
ipconfig   # note the IPv4 Address, e.g. 192.168.1.50
```

On **every client PC** (and the server itself), add a line to
`C:\Windows\System32\drivers\etc\hosts` (edit as Administrator):

```
192.168.1.50   accounting.msm
```

> A local DNS server is nicer for many machines, but the hosts file is fine to start.

## 3. Build and start

```powershell
docker compose build
docker compose up -d db          # start the database first
docker compose run --rm backend npx prisma db push   # create all tables
docker compose run --rm backend npm run db:seed      # seed demo admin + defaults
docker compose up -d             # bring up backend + web
```

Check everything is up:

```powershell
docker compose ps
docker compose logs -f backend   # Ctrl-C to stop tailing
```

## 4. Trust Caddy's certificate on client PCs

Caddy issued the cert from its own internal CA. Export the root cert and install
it so browsers don't warn:

```powershell
docker compose cp web:/data/caddy/pki/authorities/local/root.crt .\caddy-root.crt
```

Copy `caddy-root.crt` to each client, then (as Administrator on that PC):

```powershell
Import-Certificate -FilePath .\caddy-root.crt -CertStoreLocation Cert:\LocalMachine\Root
```

(Or double-click the file → Install Certificate → Local Machine → Trusted Root
Certification Authorities.)

## 5. Open the firewall on the server

```powershell
New-NetFirewallRule -DisplayName "MSM Accounting HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "MSM Accounting HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
```

## 6. First login — then lock it down

Visit **https://accounting.msm**. Seed credentials:

- Email: `admin@demo.com`
- Password: `admin123`

**Immediately** create your real users and change/remove the demo admin. Then
confirm Backup & Restore writes to your `BACKUP_DIR_HOST` folder.

---

## Day-2 operations

**Update after a code change (`git pull`):**
```powershell
docker compose up -d --build
# only if the Prisma schema changed:
docker compose run --rm backend npx prisma db push
```

**Change the hostname (`SITE_HOST`):** the SPA bakes the API URL at build time, so
rebuild the web image: `docker compose up -d --build web` (and update the hosts
files + re-trust the cert if the name changed).

**Logs:** `docker compose logs -f backend` (or `web`, `db`).

**Stop / start:** `docker compose stop` / `docker compose start`. Containers use
`restart: unless-stopped`, so they come back automatically after a reboot as long
as Docker Desktop is set to start on login.

**Backups:** DB dumps go to `BACKUP_DIR_HOST`. Point OneDrive/Drive at that folder
for off-site copies. The Postgres data itself lives in the `pgdata` Docker volume.

## Notes & gotchas baked into this setup
- **HTTPS is required, not optional** — the auth cookie is `Secure` under
  `next start`, so plain-HTTP LAN access would silently fail to log in. Caddy's
  TLS is what makes multi-user access work.
- **One origin** (Caddy proxies `/api` to the backend) → no CORS, cookie stays
  same-site.
- **Debian-based images** (`node:20-slim`) avoid Prisma/sharp/tesseract native
  build issues you'd hit on Alpine.
