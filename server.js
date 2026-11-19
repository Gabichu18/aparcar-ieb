// Aparcar IEB: notify a driver when their car is blocking someone.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const zones = require('./zones');

// ---------- Config (environment variables) ----------
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
// Comma-separated list of allowed email domains, e.g. "ieb.es,alumni-ieb.es"
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'ieb.es,alumni-ieb.es')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const SMTP_URL = process.env.SMTP_URL || ''; // e.g. smtps://user:pass@smtp.example.com
const MAIL_FROM = process.env.MAIL_FROM || 'Aparcar IEB <no-reply@example.com>';
const DEV_MODE = !SMTP_URL; // without SMTP, login codes and emails are printed to the console

const LIMITS = {
  alertsPerHour: Number(process.env.ALERTS_PER_HOUR || 5),
  samePlateMinutes: 5,     // one alert per plate per 5 minutes (from anyone)
  codeMinutes: 10,         // login code validity
  codeRequestsPerHour: 5,  // per email
  maxPlatesPerUser: 3,
  sessionDays: 180,
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Database ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plates (
    plate TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    plate TEXT NOT NULL,
    zone TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,          -- notified | not_registered | coming | moved
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Clean up old data: expired codes/sessions, alerts older than 30 days.
function cleanup() {
  const t = now();
  db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(t - 3600e3);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM alerts WHERE created_at < ?').run(t - 30 * 86400e3);
}
cleanup();
setInterval(cleanup, 3600e3).unref();

// ---------- Push (VAPID keys are generated once and stored) ----------
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(vapidFile)) {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);

async function pushToUser(userId, payload) {
  const subs = db.prepare('SELECT endpoint, sub_json FROM push_subs WHERE user_id = ?').all(userId);
  let delivered = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.sub_json), JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      delivered++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      } else {
        console.error('push failed', err.statusCode || err.message);
      }
    }
  }));
  return delivered;
}

// ---------- Email ----------
const mailer = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;
async function sendMail(to, subject, text) {
  if (DEV_MODE) {
    console.log(`\n[DEV EMAIL] to=${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  try {
    await mailer.sendMail({ from: MAIL_FROM, to, subject, text });
  } catch (err) {
    console.error('email failed', err.message);
  }
}

// ---------- Helpers ----------
// Plates are stored uppercase with no spaces/dashes: "1234 ABC" -> "1234ABC".
function normalizePlate(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function validPlate(p) {
  return /^[A-Z0-9]{4,10}$/.test(p);
}
function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function emailAllowed(e) {
  const domain = e.split('@')[1];
  return ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}
const zoneName = (id) => (zones.find((z) => z.id === id) || {}).name || id;

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function auth(req, res, next) {
  const token = getCookie(req, 'sid');
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' });
  const row = db.prepare(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).get(sha(token), now());
  if (!row) return res.status(401).json({ error: 'No has iniciado sesión' });
  req.user = row;
  next();
}

app.get('/api/config', (req, res) => {
  res.json({ zones, vapidPublicKey: vapid.publicKey, allowedDomains: ALLOWED_DOMAINS, devMode: DEV_MODE });
});

// Step 1 of login: email a 6-digit code.
app.post('/api/auth/request-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Introduce un email válido.' });
  if (!emailAllowed(email)) {
    return res.status(403).json({ error: `Usa tu email de la universidad (${ALLOWED_DOMAINS.map((d) => '@' + d).join(' o ')}).` });
  }
  const recent = db.prepare('SELECT COUNT(*) n FROM login_codes WHERE email = ? AND created_at > ?').get(email, now() - 3600e3).n;
  if (recent >= LIMITS.codeRequestsPerHour) return res.status(429).json({ error: 'Has pedido demasiados códigos. Inténtalo más tarde.' });

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('DELETE FROM login_codes WHERE email = ? AND expires_at < ?').run(email, now());
  db.prepare('INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(email, sha(email + ':' + code), now() + LIMITS.codeMinutes * 60e3, now());
  await sendMail(email, `Tu código de Aparcar IEB: ${code}`,
    `Tu código para entrar es ${code}. Caduca en ${LIMITS.codeMinutes} minutos.\n\nSi no lo has pedido tú, ignora este email.`);
  res.json({ ok: true });
});

// Step 2 of login: check the code, create the account if needed, set a session cookie.
app.post('/api/auth/verify', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const row = db.prepare(
    'SELECT rowid, code_hash, attempts FROM login_codes WHERE email = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
  ).get(email, now());
  if (!row || row.attempts >= 5) return res.status(400).json({ error: 'El código ha caducado. Pide uno nuevo.' });
  if (row.code_hash !== sha(email + ':' + code)) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE rowid = ?').run(row.rowid);
    return res.status(400).json({ error: 'Código incorrecto.' });
  }
  db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
  db.prepare('INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)').run(email, now());
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(token), user.id, now() + LIMITS.sessionDays * 86400e3);
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', secure: APP_URL.startsWith('https'), maxAge: LIMITS.sessionDays * 86400e3,
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(getCookie(req, 'sid')));
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const plates = db.prepare('SELECT plate, label FROM plates WHERE user_id = ? ORDER BY created_at').all(req.user.id);
  const pushDevices = db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?').get(req.user.id).n;
  res.json({ email: req.user.email, plates, pushDevices });
});

// GDPR: delete the account and everything linked to it.
app.delete('/api/me', auth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.clearCookie('sid');
  res.json({ ok: true });
});

// ---------- Plates ----------
app.post('/api/plates', auth, (req, res) => {
  const plate = normalizePlate(req.body.plate);
  const label = String(req.body.label || '').slice(0, 40);
  if (!validPlate(plate)) return res.status(400).json({ error: 'Eso no parece una matrícula.' });
  const count = db.prepare('SELECT COUNT(*) n FROM plates WHERE user_id = ?').get(req.user.id).n;
  if (count >= LIMITS.maxPlatesPerUser) return res.status(400).json({ error: `Puedes registrar hasta ${LIMITS.maxPlatesPerUser} matrículas.` });
  const existing = db.prepare('SELECT user_id FROM plates WHERE plate = ?').get(plate);
  if (existing) {
    // Don't reveal whose it is.
    return res.status(409).json({ error: existing.user_id === req.user.id ? 'Ya tienes registrada esta matrícula.' : 'Otro estudiante ya ha registrado esta matrícula. Si es tuya, contacta con el administrador de la app.' });
  }
  db.prepare('INSERT INTO plates (plate, user_id, label, created_at) VALUES (?, ?, ?, ?)').run(plate, req.user.id, label, now());
  res.json({ ok: true, plate });
});

app.delete('/api/plates/:plate', auth, (req, res) => {
  db.prepare('DELETE FROM plates WHERE plate = ? AND user_id = ?').run(normalizePlate(req.params.plate), req.user.id);
  res.json({ ok: true });
});

// ---------- Push subscriptions ----------
app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return res.status(400).json({ error: 'Suscripción no válida' });
  db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, sub_json) VALUES (?, ?, ?)')
    .run(sub.endpoint, req.user.id, JSON.stringify(sub));
  res.json({ ok: true });
});

app.post('/api/push/test', auth, async (req, res) => {
  const delivered = await pushToUser(req.user.id, { title: 'Aparcar IEB', body: 'Las notificaciones funcionan correctamente.', url: '/' });
  res.json({ ok: true, delivered });
});

// ---------- Alerts ----------
app.post('/api/alerts', auth, async (req, res) => {
  const plate = normalizePlate(req.body.plate);
  const zone = String(req.body.zone || '');
  const note = String(req.body.note || '').trim().slice(0, 140);
  if (!validPlate(plate)) return res.status(400).json({ error: 'Introduce una matrícula válida.' });
  if (!zones.some((z) => z.id === zone)) return res.status(400).json({ error: 'Elige una zona.' });

  const sentLastHour = db.prepare('SELECT COUNT(*) n FROM alerts WHERE reporter_id = ? AND created_at > ?')
    .get(req.user.id, now() - 3600e3).n;
  if (sentLastHour >= LIMITS.alertsPerHour) {
    return res.status(429).json({ error: `Puedes enviar como máximo ${LIMITS.alertsPerHour} avisos por hora.` });
  }

  const owner = db.prepare('SELECT p.user_id, u.email FROM plates p JOIN users u ON u.id = p.user_id WHERE p.plate = ?').get(plate);
  if (owner && owner.user_id === req.user.id) return res.status(400).json({ error: 'Ese es tu propio coche.' });

  const recentForPlate = db.prepare(
    "SELECT id, status FROM alerts WHERE plate = ? AND status IN ('notified','coming') AND created_at > ?"
  ).get(plate, now() - LIMITS.samePlateMinutes * 60e3);
  if (recentForPlate) {
    return res.status(429).json({
      error: recentForPlate.status === 'coming'
        ? 'Ya se avisó al dueño y ha dicho que va de camino.'
        : 'Se avisó al dueño hace unos minutos. Dale un momento, por favor.',
    });
  }

  const status = owner ? 'notified' : 'not_registered';
  const info = db.prepare(
    'INSERT INTO alerts (reporter_id, owner_id, plate, zone, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, owner ? owner.user_id : null, plate, zone, note, status, now(), now());

  if (owner) {
    const body = `Tu coche ${plate} está bloqueando a alguien en ${zoneName(zone)}.${note ? ' Nota: ' + note : ''}`;
    await pushToUser(owner.user_id, {
      title: '🚗 Por favor, mueve tu coche', body, url: '/#incoming', alertId: Number(info.lastInsertRowid), requireInteraction: true,
    });
    await sendMail(owner.email, `Tu coche ${plate} está bloqueando a alguien`,
      `${body}\n\nAbre la app para avisar de que vas de camino: ${APP_URL}/#incoming`);
  }
  res.json({ ok: true, status, alertId: Number(info.lastInsertRowid) });
});

// Alerts I sent and alerts about my cars (last 24h). Reporter and owner never see each other's identity.
app.get('/api/alerts', auth, (req, res) => {
  const since = now() - 86400e3;
  const sent = db.prepare(
    'SELECT id, plate, zone, note, status, created_at, updated_at FROM alerts WHERE reporter_id = ? AND created_at > ? ORDER BY created_at DESC'
  ).all(req.user.id, since);
  const incoming = db.prepare(
    "SELECT id, plate, zone, note, status, created_at, updated_at FROM alerts WHERE owner_id = ? AND created_at > ? AND status != 'not_registered' ORDER BY created_at DESC"
  ).all(req.user.id, since);
  res.json({ sent, incoming });
});

// Owner answers: "coming" (on my way) or "moved" (done).
app.post('/api/alerts/:id/respond', auth, async (req, res) => {
  const status = req.body.status;
  if (!['coming', 'moved'].includes(status)) return res.status(400).json({ error: 'Estado no válido' });
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
  if (!alert) return res.status(404).json({ error: 'Aviso no encontrado' });
  db.prepare('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), alert.id);
  if (alert.reporter_id) {
    await pushToUser(alert.reporter_id, {
      title: status === 'coming' ? 'El dueño va de camino' : 'El coche ya se ha movido',
      body: `${alert.plate} en ${zoneName(alert.zone)}`,
      url: '/#sent',
    });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Aparcar IEB running on ${APP_URL} (port ${PORT})`);
  console.log(`Allowed email domains: ${ALLOWED_DOMAINS.join(', ')}`);
  if (DEV_MODE) console.log('DEV MODE: no SMTP_URL set, login codes are printed here instead of emailed.');
});
