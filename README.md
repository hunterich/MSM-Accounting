# MSM Accounting Software

Modern accounting workspace for SMEs: GL, AR, AP, inventory, banking, reporting, and role-based access.

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
npx prisma db push
npm run db:seed
```

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
- `npm run prisma:migrate:dev` - Run dev migrations
- `npm run db:seed` - Seed demo data

## Documentation

- Product roadmap: `ROADMAP.md`
- Release history: `CHANGELOG.md`
