# Development

This file is for contributors and maintainers working on Aurral locally. For normal installation and first-run setup, use [README.md](README.md).

## Requirements

- Node.js compatible with the repo dependencies. The Docker image uses Node 26 Alpine.
- npm
- A reachable Lidarr instance for integration-heavy workflows

Install dependencies:

```bash
npm install
```

## Local App

Run backend and frontend together:

```bash
npm run dev
```

This starts:

- Backend: `http://localhost:3001`
- Frontend dev server: `http://localhost:3000`

The frontend proxies `/api` and `/ws` to the backend.

Run only the backend:

```bash
npm run dev:backend
```

Run only the frontend:

```bash
npm run dev:frontend
```

Build the frontend:

```bash
npm run build
```

Start the production server after building:

```bash
npm start
```

## Checks

Run tests:

```bash
npm test
```

Run frontend lint:

```bash
npm run lint --workspace frontend
```

Build a local Docker image:

```bash
npm run docker:build
```

Run a local Docker image:

```bash
npm run docker:run
```

## Repository Layout

```text
backend/
  config/              SQLite, settings, encryption, sessions, constants
  middleware/          auth, permissions, cache, validation, URL validation
  routes/              API route groups
  services/            Lidarr, discovery, metadata, images, flows, Soulseek, Navidrome
  scripts/             maintenance scripts
frontend/
  src/
    components/        shared UI components
    contexts/          auth, theme, toast
    hooks/             websocket, volume, page hooks
    pages/             Discover, Library, Flow, Settings, Requests, etc.
    utils/             API client and helpers
lib/                   version resolution helpers
scripts/               release helper scripts
.tests/                node:test suites
web/                   static public helper pages
```

## Architecture Notes

Aurral is a single deployable web app:

- Express serves `/api/*`, WebSockets, stream endpoints, and the built React frontend.
- React/Vite provides the app UI and PWA support.
- SQLite stores durable state.
- Lidarr remains the source of truth for the main music library.
- Aurral-generated flow files are kept in a separate downloads/output tree.
- WebSocket channels push discovery updates, download statuses, and flow status changes to connected clients.

Main backend route groups:

| Route prefix | Purpose |
|---|---|
| `/api/health` | Liveness, bootstrap, app version, auth state, integration status, WebSocket stats. |
| `/api/onboarding` | First-run setup before onboarding is complete. |
| `/api/auth` | Login, logout, and current user. |
| `/api/users` | User management, account settings, listening history, Lidarr defaults, discover layout. |
| `/api/settings` | Admin settings, logs, Lidarr profile/tag lookups, connection tests, notifications. |
| `/api/search` | Catalog and artist search. |
| `/api/artists` | Artist details, images, similar artists, previews, release groups, overrides. |
| `/api/library` | Lidarr library artists, albums, tracks, stream, lookup, downloads, refresh, delete. |
| `/api/discover` | Recommendations, refresh, tags, blocklist, preferences, feedback, nearby shows. |
| `/api/requests` | Normalized Lidarr queue/history request tracking. |
| `/api/weekly-flow` | Flows, imported playlists, jobs, worker settings, downloads, status, artwork. |
| `/api/image-proxy` | Cached/proxied external images. |

Periodic backend work includes:

- Due flow refreshes
- Pending flow worker jobs
- Incomplete imported playlist retries
- Expired sessions
- Stale discovery cache refreshes
- Download status broadcasts
- Flow status broadcasts
