// Aparcar IEB: notify a driver when their car is blocking someone.
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const webpush = require('web-push');
const zones = require('./zones');
const { openDb } = require('./db');
const { sendMail, mailMode } = require('./mail');
const telegram = require('./telegram');

// ---------- Config (environment variables) ----------
const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Comma-separated list of allowed email domains.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'ieb.es,alumni-ieb.es')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const DEV_MODE = mailMode === 'console'; // no email service set up: codes are printed in the logs

const LIMITS = {
  alertsPerHour: Number(process.env.ALERTS_PER_HOUR || 5),
  samePlateMinutes: 5,     // one alert per plate per 5 minutes (from anyone)
  codeMinutes: 10,         // login code validity
  codeRequestsPerHour: 5,  // per email
  maxPlatesPerUser: 3,
  sessionDays: 180,
};

const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Plates are stored uppercase with no spaces/dashes: "1234 ABC" -> "1234ABC".
const normalizePlate = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validPlate = (p) => /^[A-Z0-9]{4,10}$/.test(p);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function emailAllowed(e) {
  const domain = e.split('@')[1];
  return ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
// Wrap async route handlers so errors become a 500 instead of crashing.
const h = (fn) => (req, res, next) => fn(req, res, next).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
});

async function main() {
  const db = await openDb();

  // Clean up old data: expired codes/sessions, alerts older than 30 days.
  async function cleanup() {
    const t = now();
    await db.run('DELETE FROM login_codes WHERE expires_at < ?', t - 3600e3);
    await db.run('DELETE FROM sessions WHERE expires_at < ?', t);
    await db.run('DELETE FROM alerts WHERE created_at < ?', t - 30 * 86400e3);
  }
  await cleanup();
  // Pending login codes only live 10 minutes; clearing them on each deploy also resets the
  // per-email code limit if something went wrong (e.g. the email service was misconfigured).
  await db.run('DELETE FROM login_codes');
  setInterval(() => cleanup().catch(console.error), 3600e3).unref();

  // ---------- Push: VAPID keys from env, or generated once and kept in the database ----------
  let vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const row = await db.get("SELECT value FROM settings WHERE key = 'vapid'");
    if (row) vapid = JSON.parse(row.value);
    else {
      vapid = webpush.generateVAPIDKeys();
      await db.run("INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT (key) DO NOTHING", JSON.stringify(vapid));
      vapid = JSON.parse((await db.get("SELECT value FROM settings WHERE key = 'vapid'")).value);
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);

  async function pushToUser(userId, payload) {
    const subs = await db.all('SELECT endpoint, sub_json FROM push_subs WHERE user_id = ?', userId);
    let delivered = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(JSON.parse(s.sub_json), JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
        delivered++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.run('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint);
        } else {
          console.error('push failed', err.statusCode || err.message);
        }
      }
    }));
    return delivered;
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

  const auth = h(async (req, res, next) => {
    const token = getCookie(req, 'sid');
    const row = token && await db.get(
      'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      sha(token), now());
    if (!row) return res.status(401).json({ error: 'No has iniciado sesión' });
    req.user = row;
    next();
  });

  app.get('/healthz', (req, res) => res.send('ok'));

  const zoneName = (id) => (zones.find((z) => z.id === id) || {}).name || id;

  app.get('/api/config', (req, res) => {
    res.json({ zones, vapidPublicKey: vapid.publicKey, allowedDomains: ALLOWED_DOMAINS, devMode: DEV_MODE });
  });

  // Step 1 of login: email a 6-digit code.
  app.post('/api/auth/request-code', h(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: 'Introduce un email válido.' });
    if (!emailAllowed(email)) {
      return res.status(403).json({ error: `Usa tu email de la universidad (${ALLOWED_DOMAINS.map((d) => '@' + d).join(' o ')}).` });
    }
    const recent = (await db.get('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?', email, now() - 3600e3)).n;
    if (Number(recent) >= LIMITS.codeRequestsPerHour) {
      return res.status(429).json({ error: 'Has pedido demasiados códigos. Inténtalo más tarde.' });
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const codeHash = sha(email + ':' + code);
    await db.run('INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
      email, codeHash, now() + LIMITS.codeMinutes * 60e3, now());
    const ok = await sendMail(email, `Tu código de Aparcar IEB: ${code}`,
      `Tu código para entrar es ${code}. Caduca en ${LIMITS.codeMinutes} minutos.\n\nSi no lo has pedido tú, ignora este email.`);
    if (!ok) {
      // Don't count a code that never reached the student against their hourly limit.
      await db.run('DELETE FROM login_codes WHERE email = ? AND code_hash = ?', email, codeHash);
      return res.status(502).json({ error: 'No se pudo enviar el email. Inténtalo en unos minutos.' });
    }
    res.json({ ok: true });
  }));

  // Step 2 of login: check the code, create the account if needed, set a session cookie.
  app.post('/api/auth/verify', h(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const row = await db.get(
      'SELECT id, code_hash, attempts FROM login_codes WHERE email = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
      email, now());
    if (!row || row.attempts >= 5) return res.status(400).json({ error: 'El código ha caducado. Pide uno nuevo.' });
    if (row.code_hash !== sha(email + ':' + code)) {
      await db.run('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      return res.status(400).json({ error: 'Código incorrecto.' });
    }
    await db.run('DELETE FROM login_codes WHERE email = ?', email);
    await db.run('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT (email) DO NOTHING', email, now());
    const user = await db.get('SELECT id FROM users WHERE email = ?', email);
    const token = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      sha(token), user.id, now() + LIMITS.sessionDays * 86400e3);
    res.cookie('sid', token, {
      httpOnly: true, sameSite: 'lax', secure: APP_URL.startsWith('https'), maxAge: LIMITS.sessionDays * 86400e3,
    });
    res.json({ ok: true });
  }));

  app.post('/api/auth/logout', auth, h(async (req, res) => {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', sha(getCookie(req, 'sid')));
    res.clearCookie('sid');
    res.json({ ok: true });
  }));

  app.get('/api/me', auth, h(async (req, res) => {
    const plates = await db.all('SELECT plate, label FROM plates WHERE user_id = ? ORDER BY created_at', req.user.id);
    const pushDevices = Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', req.user.id)).n);
    const tg = telegram.enabled && await db.get('SELECT chat_id FROM telegram_chats WHERE user_id = ?', req.user.id);
    res.json({ email: req.user.email, plates, pushDevices, telegram: { enabled: telegram.enabled, linked: Boolean(tg) } });
  }));

  // GDPR: delete the account and everything linked to it.
  app.delete('/api/me', auth, h(async (req, res) => {
    await db.run('DELETE FROM users WHERE id = ?', req.user.id);
    res.clearCookie('sid');
    res.json({ ok: true });
  }));

  // ---------- Plates ----------
  app.post('/api/plates', auth, h(async (req, res) => {
    const plate = normalizePlate(req.body.plate);
    const label = String(req.body.label || '').slice(0, 40);
    if (!validPlate(plate)) return res.status(400).json({ error: 'Eso no parece una matrícula.' });
    const count = Number((await db.get('SELECT COUNT(*) AS n FROM plates WHERE user_id = ?', req.user.id)).n);
    if (count >= LIMITS.maxPlatesPerUser) {
      return res.status(400).json({ error: `Puedes registrar hasta ${LIMITS.maxPlatesPerUser} matrículas.` });
    }
    const existing = await db.get('SELECT user_id FROM plates WHERE plate = ?', plate);
    if (existing) {
      // Don't reveal whose it is.
      return res.status(409).json({
        error: existing.user_id === req.user.id
          ? 'Ya tienes registrada esta matrícula.'
          : 'Otro estudiante ya ha registrado esta matrícula. Si es tuya, contacta con el administrador de la app.',
      });
    }
    await db.run('INSERT INTO plates (plate, user_id, label, created_at) VALUES (?, ?, ?, ?)', plate, req.user.id, label, now());
    res.json({ ok: true, plate });
  }));

  app.delete('/api/plates/:plate', auth, h(async (req, res) => {
    await db.run('DELETE FROM plates WHERE plate = ? AND user_id = ?', normalizePlate(req.params.plate), req.user.id);
    res.json({ ok: true });
  }));

  // ---------- Push subscriptions ----------
  app.post('/api/push/subscribe', auth, h(async (req, res) => {
    const sub = req.body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return res.status(400).json({ error: 'Suscripción no válida' });
    await db.run(
      'INSERT INTO push_subs (endpoint, user_id, sub_json) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, sub_json = excluded.sub_json',
      sub.endpoint, req.user.id, JSON.stringify(sub));
    res.json({ ok: true });
  }));

  app.post('/api/push/test', auth, h(async (req, res) => {
    const delivered = await pushToUser(req.user.id, { title: 'Aparcar IEB', body: 'Las notificaciones funcionan correctamente.', url: '/' });
    res.json({ ok: true, delivered });
  }));

  // ---------- Alerts ----------
  app.post('/api/alerts', auth, h(async (req, res) => {
    const plate = normalizePlate(req.body.plate);
    const zone = String(req.body.zone || '');
    const note = String(req.body.note || '').trim().slice(0, 140);
    if (!validPlate(plate)) return res.status(400).json({ error: 'Introduce una matrícula válida.' });
    if (!zones.some((z) => z.id === zone)) return res.status(400).json({ error: 'Elige una zona.' });

    const sentLastHour = Number((await db.get('SELECT COUNT(*) AS n FROM alerts WHERE reporter_id = ? AND created_at > ?',
      req.user.id, now() - 3600e3)).n);
    if (sentLastHour >= LIMITS.alertsPerHour) {
      return res.status(429).json({ error: `Puedes enviar como máximo ${LIMITS.alertsPerHour} avisos por hora.` });
    }

    const owner = await db.get('SELECT p.user_id, u.email FROM plates p JOIN users u ON u.id = p.user_id WHERE p.plate = ?', plate);
    if (owner && owner.user_id === req.user.id) return res.status(400).json({ error: 'Ese es tu propio coche.' });

    const recentForPlate = await db.get(
      "SELECT id, status FROM alerts WHERE plate = ? AND status IN ('notified','coming') AND created_at > ?",
      plate, now() - LIMITS.samePlateMinutes * 60e3);
    if (recentForPlate) {
      return res.status(429).json({
        error: recentForPlate.status === 'coming'
          ? 'Ya se avisó al dueño y ha dicho que va de camino.'
          : 'Se avisó al dueño hace unos minutos. Dale un momento, por favor.',
      });
    }

    const status = owner ? 'notified' : 'not_registered';
    const inserted = await db.get(
      'INSERT INTO alerts (reporter_id, owner_id, plate, zone, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      req.user.id, owner ? owner.user_id : null, plate, zone, note, status, now(), now());
    const alertId = Number(inserted.id);

    if (owner) {
      const body = `Tu coche ${plate} está bloqueando a alguien en ${zoneName(zone)}.${note ? ' Nota: ' + note : ''}`;
      await Promise.all([
        pushToUser(owner.user_id, { title: '🚗 Por favor, mueve tu coche', body, url: '/#incoming', alertId, requireInteraction: true }),
        sendMail(owner.email, `Tu coche ${plate} está bloqueando a alguien`,
          `${body}\n\nAbre la app para avisar de que vas de camino: ${APP_URL}/#incoming`),
        telegramToUser(owner.user_id, (chat) => telegram.sendAlert(chat, alertId, `🚗 ${body}`)),
      ]);
    }
    res.json({ ok: true, status, alertId });
  }));

  // Alerts I sent and alerts about my cars (last 24h). Reporter and owner never see each other's identity.
  app.get('/api/alerts', auth, h(async (req, res) => {
    const since = now() - 86400e3;
    const sent = await db.all(
      'SELECT id, plate, zone, note, status, created_at, updated_at FROM alerts WHERE reporter_id = ? AND created_at > ? ORDER BY created_at DESC',
      req.user.id, since);
    const incoming = await db.all(
      "SELECT id, plate, zone, note, status, created_at, updated_at FROM alerts WHERE owner_id = ? AND created_at > ? AND status <> 'not_registered' ORDER BY created_at DESC",
      req.user.id, since);
    res.json({ sent, incoming });
  }));

  async function telegramToUser(userId, send) {
    if (!telegram.enabled) return;
    const row = await db.get('SELECT chat_id FROM telegram_chats WHERE user_id = ?', userId);
    if (row) await send(row.chat_id);
  }

  // Owner answers "coming" (on my way) or "moved" (done). Used by the app and by Telegram buttons.
  async function respondToAlert(ownerId, alertId, status) {
    const alert = await db.get('SELECT * FROM alerts WHERE id = ? AND owner_id = ?', alertId, ownerId);
    if (!alert) return null;
    await db.run('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?', status, now(), alert.id);
    if (alert.reporter_id) {
      const title = status === 'coming' ? 'El dueño va de camino' : 'El coche ya se ha movido';
      const body = `${alert.plate} en ${zoneName(alert.zone)}`;
      await Promise.all([
        pushToUser(alert.reporter_id, { title, body, url: '/#sent' }),
        telegramToUser(alert.reporter_id, (chat) => telegram.sendText(chat, `${status === 'coming' ? '🚶' : '✅'} ${title}: ${body}`)),
      ]);
    }
    return alert;
  }

  app.post('/api/alerts/:id/respond', auth, h(async (req, res) => {
    const status = req.body.status;
    if (!['coming', 'moved'].includes(status)) return res.status(400).json({ error: 'Estado no válido' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await respondToAlert(req.user.id, id, status))) {
      return res.status(404).json({ error: 'Aviso no encontrado' });
    }
    res.json({ ok: true });
  }));

  // ---------- Telegram ----------
  app.post('/api/telegram/link', auth, h(async (req, res) => {
    if (!telegram.enabled) return res.status(400).json({ error: 'Telegram no está activado en esta app.' });
    const code = crypto.randomBytes(12).toString('base64url');
    await db.run('DELETE FROM telegram_links WHERE user_id = ? OR expires_at < ?', req.user.id, now());
    await db.run('INSERT INTO telegram_links (code, user_id, expires_at) VALUES (?, ?, ?)', code, req.user.id, now() + 30 * 60e3);
    const url = telegram.linkUrl(code);
    if (!url) return res.status(502).json({ error: 'No se pudo contactar con Telegram. Inténtalo en un momento.' });
    res.json({ url });
  }));

  app.delete('/api/telegram/link', auth, h(async (req, res) => {
    await db.run('DELETE FROM telegram_chats WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  }));

  app.post('/api/telegram/webhook/:secret', h(async (req, res) => {
    if (!telegram.enabled || req.params.secret !== telegram.WEBHOOK_SECRET
      || req.get('x-telegram-bot-api-secret-token') !== telegram.WEBHOOK_SECRET) return res.sendStatus(403);
    const u = req.body || {};
    if (u.message && u.message.chat && typeof u.message.text === 'string') {
      const chatId = String(u.message.chat.id);
      const m = u.message.text.match(/^\/start(?:\s+(\S+))?/);
      if (m && m[1]) {
        const link = await db.get('SELECT user_id FROM telegram_links WHERE code = ? AND expires_at > ?', m[1], now());
        if (link) {
          await db.run('DELETE FROM telegram_links WHERE code = ?', m[1]);
          await db.run('INSERT INTO telegram_chats (user_id, chat_id) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET chat_id = excluded.chat_id', link.user_id, chatId);
          await telegram.sendText(chatId, '✅ Listo. A partir de ahora recibirás aquí los avisos de Aparcar IEB cuando tu coche bloquee a alguien.');
        } else {
          await telegram.sendText(chatId, 'Este enlace ha caducado. Vuelve a pulsar «Vincular Telegram» en la app.');
        }
      } else {
        await telegram.sendText(chatId, `Hola 👋 Para recibir avisos, abre la app (${APP_URL}) y pulsa «Vincular Telegram» en Mis coches.`);
      }
    } else if (u.callback_query) {
      const q = u.callback_query;
      const [status, idStr] = String(q.data || '').split(':');
      const chat = await db.get('SELECT user_id FROM telegram_chats WHERE chat_id = ?', String(q.message && q.message.chat && q.message.chat.id));
      let answer = 'Aviso no encontrado';
      if (chat && ['coming', 'moved'].includes(status) && await respondToAlert(chat.user_id, Number(idStr), status)) {
        answer = status === 'coming' ? 'Le hemos dicho que vas de camino 🚶' : '¡Gracias por moverlo! ✅';
        if (q.message) {
          await telegram.call('editMessageReplyMarkup', {
            chat_id: q.message.chat.id, message_id: q.message.message_id,
            reply_markup: status === 'coming'
              ? { inline_keyboard: [[{ text: '✅ Ya lo he movido', callback_data: `moved:${idStr}` }]] }
              : { inline_keyboard: [] },
          });
        }
      }
      await telegram.call('answerCallbackQuery', { callback_query_id: q.id, text: answer });
    }
    res.json({ ok: true });
  }));

  telegram.setup(APP_URL).catch((err) => console.error('telegram setup', err.message));

  app.listen(PORT, () => {
    console.log(`Aparcar IEB running on ${APP_URL} (port ${PORT}), database: ${db.kind}, email: ${mailMode}`);
    console.log(`Allowed email domains: ${ALLOWED_DOMAINS.join(', ')}`);
    if (DEV_MODE) console.log('TEST MODE: no email service set up, login codes are printed here instead of emailed.');
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
