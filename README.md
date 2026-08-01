# Careless — Tunisia Healthcare Network

An open-source marketplace connecting patients with independent healthcare providers across Tunisia.

## Stack

- **Frontend:** HTML5 + custom CSS design system (`public/styles.css`), Vanilla JS single-page app with a lightweight client-side router (`public/app.js`)
- **Backend:** Node.js (CommonJS) + Express 5, hand-rolled HS256 JWT
- **Database:** PostgreSQL 15+ (`pg`)
- **Server:** Node.js (`server.js`) — serves both the SPA and the `/api/*` REST API from one origin

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL 15+

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
# Create database and user
psql -U postgres -c "CREATE DATABASE careless;"
psql -U postgres -c "CREATE USER careless_admin WITH ENCRYPTED PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE careless TO careless_admin;"

# Run schema
psql -U careless_admin -d careless -f database/schema.sql
```

### 4. Configuration

Database credentials, JWT secret and port are read from environment variables, with local development fallbacks:

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `careless` |
| `DB_USER` | `careless_admin` |
| `DB_PASS` | `careless_pass_2026` |
| `JWT_SECRET` | bundled development secret |

Set these in your shell or a `.env` file loaded by your process manager before running in production.

### 5. Running the Application

```bash
npm start
```

The API and the frontend are served from the same server. Access the application at `http://localhost:3000`.

### Frontend

`public/index.html` is the application shell (auth + payment modals). `public/app.js` renders all views into `#app` via a small hashless router:

- **Home** — hero, trust signals, how-it-works, safety notices (SAMU 190)
- **Care Feed** — provider / care-need segments with live search, governorate and role filters
- **Post a Need** — care-need form wired to `POST /api/feed/needs`
- **Messages** — conversation list + chat; locked until the first paid video consultation is confirmed
- **Doctors** — waitlist form + live waitlist count
- **Profile** — KYC status, verification, specialties, license

All user-generated content is escaped before rendering (XSS-safe). The paid video consultation flow (`Book Video Consult`) calls `POST /api/fees/initiate`, shows a fee breakdown (15% platform facilitation), then `POST /api/fees/confirm` to unlock chat.

### API

REST JSON API under `/api/*`:

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/feed/providers`, `GET /api/feed/needs`, `POST /api/feed/needs`
- `GET /api/messages/conversations`, `GET/POST /api/messages/:id`
- `POST /api/fees/initiate`, `/api/fees/confirm`, `/api/fees/release`, `GET /api/fees/:feeId`
- `POST /api/doctors/waitlist`, `GET /api/doctors/waitlist/count`

### Demo Accounts

- `patient@demo.tn` / `demo123`
- `nurse@demo.tn` / `demo123`
- `student@demo.tn` / `demo123`

## Roadmap

- **Scheduled: Jitsi Meet integration** — self-hosted Jitsi (`docker-jitsi-meet`) for the first paid video consultation between patients and providers. Meetings are room URLs stored on the conversation record; recordings via Jibri land on our own server (no third-party cloud). Migration path to LiveKit is planned if scale or recording throughput requires it.

## License

AGPL-3.0
