# Aparcar IEB

The app interface, emails and notifications are in Spanish.

Installable web app (PWA) for IEB students: if a car is blocking you, pick the zone, type its plate,
and the owner gets a push notification and an email asking them to move. The owner can answer
"I'm on my way" or "Car moved", and the sender gets notified.

## How it works
- **Sign in** with a university email only (6-digit code sent by email). No passwords.
- **My cars**: each student registers up to 3 plates. A plate can belong to one account only.
- **Alert**: choose zone (Rotonda del fondo, Calle de acceso al IEB, Calle de NIDO), type the plate, optional note.
- **Privacy**: the sender never sees the owner's name or email, and vice versa. Alerts are deleted after 30 days.
  Users can delete their account and all data from "My cars".
- **Anti-abuse**: max 5 alerts per person per hour, max 1 alert per plate every 5 minutes, you can't report your own car.

## Run locally
Requires Node.js 22.13 or newer.
```
npm install
npm start          # http://localhost:3000
```
Without `SMTP_URL`, the app runs in test mode: login codes and emails are printed in the console.

## Settings (environment variables)
| Variable | What it does | Example |
|---|---|---|
| `ALLOWED_EMAIL_DOMAINS` | Email domains allowed to sign up (comma separated) | `ieb.es,alumni-ieb.es` (default) |
| `APP_URL` | Public HTTPS address of the app (used in emails) | `https://aparcar-ieb.onrender.com` |
| `SMTP_URL` | Email server for codes and alerts | `smtps://user:pass@smtp.gmail.com` |
| `MAIL_FROM` | Sender shown on emails | `Aparcar IEB <aparcar@...>` |
| `DATA_DIR` | Where the database and push keys are stored (must be a persistent disk) | `/data` |
| `VAPID_SUBJECT` | Contact for the push service | `mailto:you@ieb.es` |
| `PORT` | Port to listen on | `3000` |

## Deploying
Push notifications require HTTPS. Any Node host with a persistent disk works (Render, Railway, Fly.io, a small VPS).
Point `DATA_DIR` at the persistent disk so the database and push keys survive restarts.

## Editing zones
Zones live in `zones.js`; each zone's photo is `public/img/<zone id>.jpg`.

## Files
- `server.js`: API, database (built-in SQLite), login codes, push and email
- `public/`: the app (HTML, CSS, JS), service worker for notifications, manifest and icons
