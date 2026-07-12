# MSM Accounting Software

Modern accounting workspace for SMEs: GL, AR, AP, inventory, banking, reporting, and role-based access, with optional add-on modules for specialized vertical workflows.

## Stack

- Frontend: React + Vite + Tailwind v4 + Zustand + React Query
- Backend API: Next.js App Router (`/src/app/api/v1/*`)
- Database: PostgreSQL + Prisma
- Auth: JWT httpOnly cookie + Google OAuth (ID token verification)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Required env values:
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_ORIGIN` (default `http://localhost:5173`)
- `GOOGLE_CLIENT_ID` (backend Google token audience)
- `VITE_GOOGLE_CLIENT_ID` (frontend Google button/provider)

3. Prepare database:

```bash
npm run prisma:generate
npx prisma migrate deploy   # apply migrations (creates all tables)
npm run db:seed             # demo admin + defaults + raw indexes
```

> Already have a database from before migrations were adopted (created with
> `prisma db push`)? Baseline it once instead of applying migrations onto
> existing tables: `npx prisma migrate resolve --applied 0_init`. See
> [Database migrations](#database-migrations).

4. Run apps in separate terminals:

```bash
# Terminal 1 (frontend)
npm run dev

# Terminal 2 (backend API)
npm run backend:dev
```

Frontend:
- `http://localhost:5173`

Backend:
- `http://localhost:3000`

## Auth

- Email/password login via `POST /api/v1/auth/login`
- Google sign-in via `POST /api/v1/auth/google`
- Session is stored in `msm_token` httpOnly cookie
- Access is restricted to users already provisioned in DB

Seed default login:
- Email: `admin@demo.com`
- Password: `admin123`

## Useful Scripts

- `npm run dev` - Start Vite frontend
- `npm run backend:dev` - Start Next.js backend
- `npm run build` - Build frontend
- `npm run backend:build` - Build backend
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate:deploy` - Apply pending migrations
- `npm run db:migration -- <name>` - Create a new migration from a schema change
- `npm run db:seed` - Seed demo data

## Database migrations

Schema changes are versioned with **Prisma Migrate** (not `prisma db push`), so
every change is a reviewed, ordered SQL file and nothing gets dropped silently on
a database with real data. Migrations live in `prisma/migrations/`.

To make a schema change:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate a migration by diffing your dev DB against the schema:
npm run db:migration -- add_supplier_rating
# 3. Review the generated prisma/migrations/<timestamp>_add_supplier_rating/migration.sql
# 4. Apply it to your dev DB, then commit the migration folder:
npm run prisma:migrate:deploy
```

Notes:
- Use `db:migration` + `migrate deploy`, **not** `prisma migrate dev` — the latter
  reads the DB's partial unique index (which Prisma's schema can't model, see
  `scripts/apply-db-indexes.mjs`) as drift and offers to reset the database.
- That one partial index is applied out-of-band by the seed / `npm run db:indexes`,
  so run one of those on a freshly-migrated database.
- The initial migration `0_init` is a baseline of the whole schema. On a database
  created before migrations existed, run `npx prisma migrate resolve --applied 0_init`
  once instead of applying it.

## Deployment

For a self-hosted, multi-user install (e.g. one Windows 11 PC serving an office
LAN), use the Docker setup in [`deploy/`](deploy/). It runs Postgres, the Next.js
API, and a Caddy reverse proxy as three containers behind a single HTTPS origin.
Follow [`deploy/README.md`](deploy/README.md).

## Documentation

- Product roadmap: `ROADMAP.md`
- Release history: `CHANGELOG.md`
