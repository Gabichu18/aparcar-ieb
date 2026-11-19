# Aparcar IEB

The app interface, emails and notifications are in Spanish.

Installable web app (PWA) for IEB students: if a car is blocking you, pick the zone, type its plate,
and the owner gets a push notification and an email asking them to move. The owner can answer
"I'm on my way" or "Car moved", and the sender gets notified.

## How it works
- **Sign in** with a university email only (6-digit code sent by email). No passwords.
- **My cars**: each student registers up to 3 plates. A plate can belong to one account only.
- **Alert**: choose zone (Calle de NIDO, Calle principal del IEB, Rotonda, Centro de la rotonda, Tramo final) on a drawn street map, type the plate, optional note.
- **Privacy**: the sender never sees the owner's name or email, and vice versa. Alerts are deleted after 30 days.
  Users can delete their account and all data from "My cars".
- **Anti-abuse**: max 5 alerts per person per hour, max 1 alert per plate every 5 minutes, you can't report your own car.

## Run locally
Requires Node.js 22.13 or newer.
```
npm install
npm start          # http://localhost:3000
```
Without `DATABASE_URL` it uses a local SQLite file in `data/`. Without an email service it runs in
test mode: login codes and emails are printed in the console/logs.

## Settings (environment variables)
| Variable | What it does | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string (free Neon database). If empty, local SQLite is used | `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `GOOGLE_SCRIPT_URL` + `GOOGLE_SCRIPT_SECRET` | Send emails from your own Gmail via the free Google Apps Script in `google-apps-script/send-mail.gs` (recommended, no approval needed) | `https://script.google.com/macros/s/.../exec` |
| `BREVO_API_KEY` | Free Brevo account API key, used to send emails over HTTPS | `xkeysib-...` |
| `MAIL_FROM` | Sender shown on emails; must be a sender verified in Brevo | `Aparcar IEB <you@gmail.com>` |
| `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` | Alternative to Brevo: free Mailjet account (200 emails a day) | from Mailjet → Account settings → API keys |
| `SMTP_URL` | Alternative to Brevo: any SMTP server (blocked on Render's free plan) | `smtps://user:pass@smtp.gmail.com` |
| `CAMPUS_LAT` + `CAMPUS_LNG` (+ `CAMPUS_RADIUS_M`, default 400) | Optional: campus position. When set, only people within that distance can answer "¿Quedan sitios libres?" | `40.45` / `-3.78` |
| `TELEGRAM_BOT_TOKEN` | Optional, free: token of a Telegram bot made with @BotFather. Students can then link Telegram in "Mis coches" and get alerts there with "Voy de camino" / "Ya lo he movido" buttons | `123456789:AA...` |
| `ALLOWED_EMAIL_DOMAINS` | Email domains allowed to sign up (comma separated) | `ieb.es,alumni-ieb.es` (default) |
| `APP_URL` | Public address, used in emails. On Render it is detected automatically | `https://aparcar-ieb.onrender.com` |
| `VAPID_SUBJECT` | Contact for the push service | `mailto:you@gmail.com` |
| `NODE_VERSION` | Node version on Render | `22` |

Push keys are generated on first start and stored in the database, so they survive restarts.

## Free deployment (zero cost)
- **Render** free web service: Build `npm install`, Start `npm start`, health check `/healthz`.
  Free instances sleep after 15 minutes without visits and take about a minute to wake up.
- **Neon** free Postgres for the data (Render's free plan has no permanent disk).
- **Brevo** free plan (300 emails a day) for login codes and alert emails. Render's free plan blocks SMTP, so Brevo's HTTP API is used.

## Editing zones
Zones live in `zones.js`: name, description and their shape on the drawn street map (SVG, viewBox 360x520).
The background sketch (buildings, roads) is in `public/zonemap.js`. Each zone id must stay stable once in use.

## Files
- `server.js`: API, login codes, alerts and push
- `db.js`: database (Postgres or SQLite)
- `mail.js`: email sending (Brevo, SMTP or console)
- `public/`: the app (HTML, CSS, JS), service worker for notifications, manifest and icons
