# Careless — Open Healthcare Network

An open-source marketplace connecting patients with independent healthcare providers across Tunisia.

> **Mission:** make healthcare affordable and accessible to everyone in Tunisia — patients, families, nurses, doctors and caregivers.
>
> **Slogan:** _You should careless, we'll care more!_

The slogan is the brand promise: you can drop the worry — Careless (care + less) exists so that caring for your health never feels like a burden. Users sign up in seconds, providers set their own TND rates, and every relationship starts with a secure video consultation.

## Stack

- **Frontend:** HTML5 + custom CSS design system (`public/styles.css`), Vanilla JS single-page app with a lightweight client-side router (`public/app.js`), Anime.js for UI animations
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

## Frontend

`public/index.html` is the application shell (auth + payment modals). `public/app.js` renders all views into `#app` via a small hashless router:

**Navigation** — a sticky, structured top bar on desktop groups destinations into logical sections (Browse / Connect) with a prominent **Post a Need** call-to-action and a clickable avatar chip that opens your profile. On tablets and phones the top bar collapses to a fixed bottom tab bar (Home, Feed, Search, Messages) with a raised center **Post** action button — the app always remains navigable regardless of screen size. Unauthenticated visitors get Search access plus Sign In / Sign Up actions; every route has a keyboard-focusable skip link and mobile-safe tap targets.

- **Home** — mission band (Open Healthcare Network + slogan "You should careless, we'll care more!"), hero, live statistics band, trust signals, how-it-works, safety notices (SAMU 190)
- **Care Feed** — provider / care-need segments with live search, governorate and role filters; every card shows the creator's `@username` with a link to their public profile
- **Search** — find people by name, `@username` or phone number; results show avatar, role, location and follower count with one-click follow
- **Post a Need** — care-need form wired to `POST /api/feed/needs`
- **Messages** — conversation list + chat; locked until the first paid video consultation is confirmed
- **Doctors** — waitlist form + live waitlist count
- **Profile** — every account has a public shareable profile at `/u/@username` with a social-style cover, avatar, `@username` handle, bio, hourly rate and follower stats. Members can host a **YouTube presentation video** that plays on their profile. **Phone numbers are private**: hidden until the visitor follows the member. Signing in shows your own profile with photo upload, username/phone/rate/bio editing, a YouTube link field and a "Copy profile link" button.
- **Followers** — follow healthcare providers and patients; public profile pages expose follower/following counts and a followers list

All user-generated content is escaped before rendering (XSS-safe). Animations (page-intro, staggered card reveals, animated stat counters, modal transitions) are powered by [Anime.js](https://animejs.com/) loaded from CDN, with graceful fallback when unavailable.

Payments are **direct-to-provider**: `POST /api/fees/initiate` opens a modal showing the full amount transferring straight to the provider's account (0% platform cut), then `POST /api/fees/confirm` creates/unlocks the chat conversation. The platform explicitly states it does not hold funds and is not responsible for the care provided.

## API

REST JSON API under `/api/*`:

- `POST /api/auth/register` (requires a unique `username`), `POST /api/auth/login`, `GET /api/auth/me`, `PATCH /api/auth/profile` (incl. `youtube_url`), `POST /api/auth/profile-image`
- `GET /api/users/:username` — public profile (never exposes email; phone is masked with `phone_locked` until the visitor follows); `POST/DELETE /api/users/:id/follow`; `GET /api/users/:id/followers`, `GET /api/users/:id/following`
- `GET /api/search?q=` — matches full name, `@username` or phone number
- `GET /api/stats` — live counts (nurses, doctors, students, clinics, active/completed care cases, trusted connections)
- `GET /api/feed/providers`, `GET /api/feed/needs`, `POST /api/feed/needs`
- `GET /api/messages/conversations`, `GET/POST /api/messages/:id`
- `POST /api/fees/initiate`, `/api/fees/confirm`, `/api/fees/release`, `GET /api/fees/:feeId`
- `POST /api/doctors/waitlist`, `GET /api/doctors/waitlist/count`

### Demo Accounts

- `patient@demo.tn` / `demo123`

## Roadmap

### Scheduled / Next

- **Video consultations (Jitsi Meet)** — self-hosted Jitsi (`docker-jitsi-meet`) for the first paid video consultation between patients and providers. Meetings are room URLs stored on the conversation record; recordings via Jibri land on our own server (no third-party cloud). Migration path to LiveKit is planned if scale or recording throughput requires it.
- **Reels** — a short-form video feed for providers and students to share updates and behind-the-scenes care content. The schema (`reels` table with `status`, `views` and `likes`) is in place; upload/feed endpoints and the player UI are planned. Every reel ends with a **branded end-card** showing the Careless logo and the creator's `@username` so viewers know who to follow and message.
- **Email verification & password reset** — transactional email service for account verification, password resets and care-need notifications.
- **Reviews & ratings** — post-consultation reviews with a verification badge, feeding into the star ratings already displayed on profiles.
- **Push notifications & in-app activity feed** — alert members about new followers, messages and applied care-need applications.
- **PWA / offline shell** — installable mobile app experience with a service worker, offline-first rendering and home-screen icons.

### Later

- **KYC document verification workflow** — structured submission, review and approval queue (schema already in place: `kyc_documents`, `kyc_status`).
- **Admin dashboard** — moderation, user management, KYC review and platform analytics.
- **Arabic & French localization** — full i18n for the Tunisian audience.
- **Mobile companion app** — React Native client sharing the same REST API.

## License

AGPL-3.0
