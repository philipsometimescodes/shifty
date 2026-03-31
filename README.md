# shifty

A lightweight event shift planner with a public signup flow and a protected admin dashboard.

## Stack

- React + Vite frontend
- Express + TypeScript backend
- Prisma + SQLite persistence
- Cookie-based admin session with a single seeded admin account
- Dockerfile for deployment on a Coolify-managed container

## Features

- Single named event with configurable start and end dates
- Reusable shift types with name, description, and default length
- Explicit public or internal visibility per shift
- Fresh databases bootstrap a default festival from 2026-06-08 to 2026-06-16 with core volunteer shift types and sample shifts
- Shift capacities with immediate reservation on application submission
- Public application flow using only name and email
- Admin review flow with Pending, Approved, and Rejected states
- Dev-mode email logging for submission confirmation and approval messages
- Shift archiving instead of destructive deletion when applications already exist
- Warnings before changing event dates when shifts would fall outside the new range

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Review or change the local admin credentials in [server/.env.example](server/.env.example).

The local ignored development file [server/.env](server/.env) is created with these defaults:

- email: `admin@example.com`
- password: `change-me`

3. Create the SQLite schema:

```bash
npm run prisma:push --workspace server
```

On first server start, Shifty also seeds a default named festival window plus these shift types if they do not exist yet: Toilets, Info Tent, Parking, Medics, and Bar Support.

The bootstrap also creates five sample shifts across those roles, and it cleans up duplicate sample seeds that were created without applications.

4. Start the app in development:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## Production Build

```bash
npm run build
npm run start
```

The Express server serves the built frontend from the same container.

## Docker

Build and run with:

```bash
docker build -t shifty .
docker run -p 3000:3000 -v $(pwd)/data:/app/data shifty
```

If you deploy on Coolify with SQLite, mount `/app/data` as persistent storage so the database survives container restarts.
