// Aparcar IEB front end (no framework).
const $ = (s) => document.querySelector(s);
let config = null;
let selectedZone = null;
let selectedSpot = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Algo ha fallado'); e.status = res.status; throw e; }
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zoneName = (id) => (config.zones.find((z) => z.id === id) || {}).name || id;
const fmtPlate = (p) => p.replace(/^(\d{4})([A-Z]{3})$/, '$1 $2');
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'ahora mismo'; if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}
const STATUS = { notified: 'Dueño avisado', not_registered: 'No registrada', coming: 'De camino', moved: 'Movido' };

// ---------- Views ----------
function show(view) {
  $('#loginView').classList.toggle('hidden', view !== 'login');
  $('#appView').classList.toggle('hidden', view !== 'app');
  $('#tabs').classList.toggle('hidden', view !== 'app');
  $('#logoutBtn').classList.toggle('hidden', view !== 'app');
}
function openTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'activity') loadAlerts();
  if (name === 'cars') loadMe();
  if (name === 'alert') setTimeout(() => zoneMap && zoneMap.refresh(), 50);
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  history.replaceState(null, '', b.dataset.tab === 'cars' ? '/' : '#' + b.dataset.tab);
  openTab(b.dataset.tab);
}));
function tabFromHash() {
  const h = location.hash.slice(1);
  if (h === 'incoming' || h === 'sent' || h === 'activity') return 'activity';
  if (h === 'alert') return 'alert';
  return 'cars';
}

// ---------- Login ----------
let loginEmail = '';
$('#emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginEmail = $('#email').value.trim().toLowerCase();
  try {
    await api('/api/auth/request-code', { body: { email: loginEmail } });
    $('#codeEmail').textContent = loginEmail;
    $('#emailForm').classList.add('hidden'); $('#codeForm').classList.remove('hidden');
    $('#code').focus();
  } catch (err) { toast(err.message); }
});
$('#codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/verify', { body: { email: loginEmail, code: $('#code').value.trim() } });
    await start();
  } catch (err) { toast(err.message); }
});
$('#backToEmail').addEventListener('click', () => {
  $('#codeForm').classList.add('hidden'); $('#emailForm').classList.remove('hidden');
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
});

// ---------- Send alert ----------
let zoneMap = null;
function selectZone(id, spot) {
  selectedZone = id;
  selectedSpot = spot || null;
  if (zoneMap) zoneMap.select(id, selectedSpot);
  const info = $('#spotInfo');
  info.classList.toggle('chosen', !!selectedSpot);
  info.innerHTML = !id ? 'Toca la calle donde estás aparcado: pondremos un 📍 en el sitio exacto.'
    : selectedSpot ? `📍 <b>${esc(zoneName(id))}</b>, ${esc(selectedSpot.label)}. <span class="muted">Toca otra vez para moverlo.</span>`
    : `<b>${esc(zoneName(id))}</b>. Si quieres, toca en el mapa el sitio exacto para poner el 📍.`;
  $('#zoneChips').querySelectorAll('.chip').forEach((c) => {
    const on = c.dataset.zone === id;
    c.classList.toggle('selected', on); c.setAttribute('aria-checked', on);
  });
}
function renderZones() {
  $('#zoneChips').innerHTML = config.zones.map((z) => `
    <button type="button" class="chip" role="radio" aria-checked="false" data-zone="${esc(z.id)}">${config.zones.indexOf(z) + 1}. ${esc(z.name)}</button>`).join('');
  $('#zoneChips').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => selectZone(c.dataset.zone)));
  if (!zoneMap) zoneMap = ZoneMap.create($('#zoneMap'), { zones: config.zones, onSelect: selectZone });
}
$('#alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = $('#alertResult');
  if (!selectedZone) return toast('Elige primero la zona.');
  try {
    const plate = $('#alertPlate').value;
    const res = await api('/api/alerts', { body: { zone: selectedZone, spot: selectedSpot, plate, note: $('#alertNote').value } });
    r.classList.remove('hidden', 'ok', 'warn');
    if (res.status === 'notified') {
      r.classList.add('ok');
      r.textContent = 'Aviso enviado. Hemos avisado al dueño. Te llegará una notificación cuando responda (mira en Actividad).';
    } else {
      r.classList.add('warn');
      r.textContent = 'Esta matrícula no está registrada en la app, así que no podemos avisar al dueño. Prueba con recepción o seguridad del campus.';
    }
    $('#alertPlate').value = ''; $('#alertNote').value = ''; selectZone(null);
  } catch (err) { toast(err.message); }
});

// ---------- Activity ----------
async function loadAlerts() {
  try {
    const { sent, incoming } = await api('/api/alerts');
    $('#incomingList').innerHTML = incoming.length ? incoming.map((a) => `
      <div class="item">
        <div class="head"><span class="plate-tag">${esc(fmtPlate(a.plate))}</span><span class="pill ${a.status}">${STATUS[a.status]}</span></div>
        <div>Bloqueando a alguien en <b>${esc(zoneName(a.zone))}</b>${a.spot ? `, ${esc(a.spot)}` : ''}</div>
        ${a.spot_x != null ? `<div class="mini-map" data-x="${a.spot_x}" data-y="${a.spot_y}" data-zone="${esc(a.zone)}"></div>` : ''}
        ${a.note ? `<div class="meta">“${esc(a.note)}”</div>` : ''}
        <div class="meta">${ago(a.created_at)}</div>
        ${a.status === 'moved' ? '' : `<div class="actions">
          ${a.status === 'notified' ? `<button class="primary" data-respond="coming" data-id="${a.id}">Voy de camino</button>` : ''}
          <button class="secondary" data-respond="moved" data-id="${a.id}">Ya lo he movido</button>
        </div>`}
      </div>`).join('') : '<div class="empty">Nadie ha avisado sobre tus coches. 👍</div>';
    $('#sentList').innerHTML = sent.length ? sent.map((a) => `
      <div class="item">
        <div class="head"><span class="plate-tag">${esc(fmtPlate(a.plate))}</span><span class="pill ${a.status}">${STATUS[a.status]}</span></div>
        <div class="meta">${esc(zoneName(a.zone))}${a.spot ? `, ${esc(a.spot)}` : ''} · ${ago(a.created_at)}</div>
      </div>`).join('') : '<div class="empty">No has enviado ningún aviso.</div>';
    $('#incomingList').querySelectorAll('.mini-map').forEach((m) => {
      const x = Number(m.dataset.x), y = Number(m.dataset.y);
      ZoneMap.create(m, { zones: config.zones, readOnly: true, view: ZoneMap.viewAround(x, y) }).select(m.dataset.zone, { x, y });
    });
    $('#incomingList').querySelectorAll('[data-respond]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/alerts/${b.dataset.id}/respond`, { body: { status: b.dataset.respond } });
        toast(b.dataset.respond === 'coming' ? 'Le avisaremos de que vas de camino.' : '¡Gracias por moverlo!');
        loadAlerts();
      } catch (err) { toast(err.message); }
    }));
    $('#badge').classList.toggle('hidden', !incoming.some((a) => a.status === 'notified'));
  } catch (err) { if (err.status === 401) show('login'); }
}

// ---------- Telegram ----------
function updateTelegram(tg) {
  $('#tgBox').classList.toggle('hidden', !tg.enabled);
  if (!tg.enabled) return;
  $('#tgStatus').textContent = tg.linked
    ? '✅ Telegram vinculado: los avisos te llegarán también por Telegram.'
    : 'Recibe los avisos como mensaje de Telegram (gratis). Pulsa el botón, se abrirá Telegram y dale a «Iniciar».';
  $('#tgLink').classList.toggle('hidden', tg.linked);
  $('#tgUnlink').classList.toggle('hidden', !tg.linked);
}
$('#tgLink').addEventListener('click', async () => {
  try {
    const r = await api('/api/telegram/link', { method: 'POST' });
    window.location.href = r.url;
  } catch (err) { toast(err.message); }
});
$('#tgUnlink').addEventListener('click', async () => {
  await api('/api/telegram/link', { method: 'DELETE' });
  toast('Telegram desvinculado.'); loadMe();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#tgBox').classList.contains('hidden') && $('#tgUnlink').classList.contains('hidden')) loadMe().catch(() => {});
});

// ---------- My cars ----------
async function loadMe() {
  const me = await api('/api/me');
  $('#meEmail').textContent = me.email;
  $('#firstStep').classList.toggle('hidden', me.plates.length > 0 && (me.pushDevices > 0 || (me.telegram && me.telegram.linked)));
  $('#plateList').innerHTML = me.plates.length ? me.plates.map((p) => `
    <div class="item"><div class="head">
      <span><span class="plate-tag">${esc(fmtPlate(p.plate))}</span> <span class="meta">${esc(p.label || '')}</span></span>
      <button class="link" data-del="${esc(p.plate)}">Quitar</button>
    </div></div>`).join('') : '<div class="empty">Aún no tienes coches. Añade tu matrícula abajo.</div>';
  $('#plateList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/plates/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
    loadMe();
  }));
  updatePushStatus(me.pushDevices);
  updateTelegram(me.telegram || {});
  return me;
}
$('#plateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/plates', { body: { plate: $('#newPlate').value, label: $('#newLabel').value } });
    $('#newPlate').value = ''; $('#newLabel').value = '';
    toast('Coche añadido.'); loadMe();
  } catch (err) { toast(err.message); }
});
$('#deleteAccount').addEventListener('click', async () => {
  const typed = prompt('Se borrarán tu cuenta, tus matrículas y tus avisos. Escribe BORRAR para confirmar.');
  if (!typed || typed.trim().toUpperCase() !== 'BORRAR') return;
  await api('/api/me', { method: 'DELETE' });
  location.href = '/';
});

// ---------- Push notifications ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function updatePushStatus(devices) {
  const s = $('#pushStatus');
  $('#iosHint').classList.toggle('hidden', !(isIOS && !isStandalone));
  if (!pushSupported) {
    s.textContent = isIOS && !isStandalone
      ? 'Añade la app a tu pantalla de inicio para recibir notificaciones. Mientras tanto, recibirás los avisos por email.'
      : 'Este navegador no puede mostrar notificaciones. Recibirás los avisos por email.';
    $('#enablePush').classList.add('hidden'); $('#testPush').classList.add('hidden');
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted' && devices > 0) {
    s.textContent = '✅ Notificaciones activadas en este dispositivo. También recibirás los avisos por email.';
    $('#enablePush').textContent = 'Volver a conectar este dispositivo';
  } else if (perm === 'denied') {
    s.textContent = 'Las notificaciones están bloqueadas. Permítelas en los ajustes del navegador para esta web. Seguirás recibiendo los avisos por email.';
  } else {
    s.textContent = 'Las notificaciones están desactivadas. Actívalas para enterarte al momento si tu coche bloquea a alguien.';
  }
}
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('No se han permitido las notificaciones.'); return loadMe(); }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(config.vapidPublicKey) });
    }
    await api('/api/push/subscribe', { body: { subscription: sub.toJSON() } });
    toast('Notificaciones activadas.'); loadMe();
  } catch (err) { toast('No se pudieron activar las notificaciones: ' + err.message); }
}
$('#enablePush').addEventListener('click', enablePush);
$('#testPush').addEventListener('click', async () => {
  const r = await api('/api/push/test', { method: 'POST' });
  toast(r.delivered ? 'Prueba enviada. Debería aparecer en un momento.' : 'Aún no hay ningún dispositivo conectado. Activa primero las notificaciones.');
});

// ---------- Start ----------
async function start() {
  config = config || await api('/api/config');
  $('#devNote').classList.toggle('hidden', !config.devMode);
  $('#email').placeholder = 'nombre@' + (config.allowedDomains[config.allowedDomains.length - 1] || 'universidad.es');
  try {
    const me = await api('/api/me');
    show('app'); renderZones(); openTab(tabFromHash()); loadAlerts();
    // Nudge new users to register a car first.
    
  } catch (err) {
    if (err.status === 401) show('login'); else toast(err.message);
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'alert-update') loadAlerts();
  });
}
window.addEventListener('hashchange', () => { if (config) openTab(tabFromHash()); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && config) loadAlerts(); });
start();
