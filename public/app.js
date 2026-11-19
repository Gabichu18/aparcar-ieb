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
  if (name === 'parking') loadParking();
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
  if (h === 'parking') return 'parking';
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

// ---------- Free spots ----------
let parkingInfo = null;
let lastPosition = null; // { lat, lng, at }
function getPosition() {
  if (lastPosition && Date.now() - lastPosition.at < 5 * 60e3) return Promise.resolve(lastPosition);
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Tu móvil no permite saber la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(lastPosition = { lat: p.coords.latitude, lng: p.coords.longitude, at: Date.now() }),
      () => reject(new Error('Necesitamos tu ubicación para comprobar que estás en el IEB. Permítela e inténtalo de nuevo.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
async function loadParking() {
  try { parkingInfo = await api('/api/parking'); } catch (err) { return toast(err.message); }
  const st = parkingInfo.status;
  $('#parkingStatus').innerHTML = config.zones.map((z, i) => {
    const r = st[z.id];
    const pill = !r ? '<span class="pill">Sin datos</span>'
      : r.status === 'free' ? '<span class="pill moved">Hay sitio</span>' : '<span class="pill not_registered">Lleno</span>';
    return `<div class="item"><div class="head"><span><b>${i + 1}. ${esc(z.name)}</b></span>${pill}</div>
      ${r ? `<div class="meta">${ago(r.at)}</div>` : ''}</div>`;
  }).join('');
  $('#parkingHint').textContent = parkingInfo.needsLocation
    ? 'Toca cómo está cada zona (solo las que hayas visto). Te pediremos la ubicación para comprobar que estás en el IEB.'
    : 'Toca cómo está cada zona. Solo las que hayas visto.';
  $('#parkingReport').innerHTML = config.zones.map((z, i) => `
    <div class="item report-row"><b>${i + 1}. ${esc(z.name)}</b>
      <div class="actions"><button type="button" class="secondary" data-zone="${esc(z.id)}" data-status="free">✅ Hay sitio</button>
      <button type="button" class="secondary" data-zone="${esc(z.id)}" data-status="full">⛔ Lleno</button></div></div>`).join('');
  $('#parkingReport').querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const body = { zone: b.dataset.zone, status: b.dataset.status };
      if (parkingInfo.needsLocation) Object.assign(body, await getPosition());
      await api('/api/parking/report', { body });
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('chosen', x === b));
      toast('¡Gracias! Los demás ya lo pueden ver.');
      const st2 = await api('/api/parking'); parkingInfo.status = st2.status;
      loadParkingStatusOnly();
    } catch (err) { toast(err.message); }
  }));
  const t = parkingInfo.time;
  if (t) $('#checkinTime').value = t;
  $('#checkinState').textContent = t
    ? `✅ Te preguntaremos a las ${t}, de lunes a viernes.`
    : 'El aviso diario está desactivado. Elige tu hora y pulsa Guardar.';
  $('#checkinOff').classList.toggle('hidden', !t);
}
function loadParkingStatusOnly() {
  const st = parkingInfo.status;
  $('#parkingStatus').querySelectorAll('.item').forEach((el, i) => {
    const r = st[config.zones[i].id]; if (!r) return;
    el.querySelector('.pill').outerHTML = r.status === 'free' ? '<span class="pill moved">Hay sitio</span>' : '<span class="pill not_registered">Lleno</span>';
    const meta = el.querySelector('.meta');
    if (meta) meta.textContent = ago(r.at); else el.insertAdjacentHTML('beforeend', `<div class="meta">${ago(r.at)}</div>`);
  });
}
$('#checkinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/parking/time', { method: 'PUT', body: { time: $('#checkinTime').value } });
    toast(`Listo: te preguntaremos a las ${r.time}.`);
    loadParking();
    if (!(pushSupported && Notification.permission === 'granted')) toast('Recuerda activar las notificaciones en Mis coches para recibir el aviso.');
  } catch (err) { toast(err.message); }
});
$('#checkinOff').addEventListener('click', async () => {
  await api('/api/parking/time', { method: 'PUT', body: { time: null } });
  toast('Aviso diario desactivado.'); loadParking();
});

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
  renderGuide(me);
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
  if (r.delivered) { store.set('guide.tested', '1'); loadMe(); }
  toast(r.delivered ? 'Prueba enviada. Debería aparecer en un momento.' : 'Aún no hay ningún dispositivo conectado. Activa primero las notificaciones.');
});

// ---------- First steps guide ----------
// Numbered steps at the top of "Mis coches". Each one ticks itself when done, fades and disappears.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const isAndroid = /android/i.test(navigator.userAgent);
const isMobile = isIOS || isAndroid || /mobi/i.test(navigator.userAgent);
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (lastMe) renderGuide(lastMe); });
window.addEventListener('appinstalled', () => { store.set('guide.installed', '1'); if (lastMe) renderGuide(lastMe); });
let lastMe = null;
let guideTimers = [];

function guideSteps(me) {
  const perm = pushSupported ? Notification.permission : 'unsupported';
  const installed = isStandalone || store.get('guide.installed') === '1';
  const pushOn = pushSupported && perm === 'granted' && me.pushDevices > 0;
  let installHow;
  if (isIOS) installHow = 'En <b>Safari</b>, pulsa <b>Compartir</b> (el cuadrado con la flecha ⬆️) y luego <b>«Añadir a pantalla de inicio»</b>. Después abre Aparcar IEB <b>desde ese icono</b>.';
  else if (isAndroid) installHow = installPrompt ? 'Pulsa el botón y confirma. Aparecerá el icono de Aparcar IEB en tu móvil.'
    : 'En Chrome, pulsa el menú <b>⋮</b> (arriba a la derecha) y luego <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.';
  else installHow = `Abre <b>${esc(location.host)}</b> en el navegador de tu móvil y añádela a la pantalla de inicio. Así te llegan los avisos aunque no estés en el ordenador.`;
  let pushHow, pushBtn = null, pushDone = pushOn || store.get('guide.nopush') === '1';
  if (isIOS && !isStandalone) pushHow = 'En iPhone primero tienes que instalar la app (paso 3) y abrirla desde el icono. Luego vuelve aquí.';
  else if (!pushSupported) { pushHow = 'Este navegador no puede mostrar notificaciones. Te avisaremos por email.'; pushBtn = ['nopush', 'Entendido']; }
  else if (perm === 'denied') pushHow = 'Las has bloqueado. Ve a los ajustes del navegador, permite las notificaciones para esta web y vuelve aquí.';
  else { pushHow = 'Pulsa el botón y después <b>«Permitir»</b>. Así te enteras al momento si tu coche bloquea a alguien.'; pushBtn = ['push', 'Activar notificaciones']; }
  return [
    { n: 1, key: 'login', title: 'Entra con tu email de la universidad', done: true },
    { n: 2, key: 'car', title: 'Añade la matrícula de tu coche', done: me.plates.length > 0,
      how: 'Escribe tu matrícula abajo y pulsa <b>Añadir</b>. Puedes añadir hasta 3 coches.', btn: ['car', 'Añadir mi coche'] },
    { n: 3, key: 'install', title: 'Instala la app en tu móvil', done: installed, how: installHow,
      btn: installPrompt ? ['install', 'Instalar la app'] : isIOS ? null : ['installed', 'Ya la tengo instalada'] },
    { n: 4, key: 'push', title: 'Activa las notificaciones', done: pushDone, how: pushHow, btn: pushBtn },
    { n: 5, key: 'test', title: 'Haz una prueba', done: store.get('guide.tested') === '1' || (pushDone && !pushOn),
      how: 'Te mandamos una notificación de prueba para comprobar que te llegan.', btn: pushOn ? ['test', 'Enviarme una prueba'] : null },
  ];
}

function renderGuide(me) {
  lastMe = me;
  const box = $('#guide');
  guideTimers.forEach(clearTimeout); guideTimers = [];
  const steps = guideSteps(me);
  const seen = (store.get('guide.seen') || '').split(',').filter(Boolean);
  const allDone = steps.every((s) => s.done);
  const hiddenByUser = store.get('guide.hidden') === '1';
  $('#showGuide').classList.toggle('hidden', !hiddenByUser && !(allDone && store.get('guide.finished') === '1'));
  if (hiddenByUser || (allDone && store.get('guide.finished') === '1')) { box.classList.add('hidden'); return; }

  const visible = steps.filter((s) => !s.done || !seen.includes(s.key)); // done + already seen = gone
  const current = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  box.classList.remove('hidden', 'gone');
  box.innerHTML = `
    <div class="guide-head"><b>Primeros pasos</b><span class="muted small">${doneCount} de ${steps.length}</span>
      <button type="button" class="guide-close" aria-label="Ocultar los primeros pasos">✕</button></div>
    <div class="guide-bar"><span style="width:${doneCount / steps.length * 100}%"></span></div>
    <ol class="guide-steps">${visible.map((s) => `
      <li data-key="${s.key}" class="${s.done ? 'done' : s === current ? 'current' : ''}">
        <span class="num">${s.done ? '✓' : s.n}</span>
        <div><b>${esc(s.title)}</b>
          ${s === current ? `<small>${s.how}</small>${s.btn ? `<button type="button" class="primary guide-btn" data-act="${s.btn[0]}">${esc(s.btn[1])}</button>` : ''}` : ''}
        </div></li>`).join('')}
    </ol>
    ${allDone ? '<div class="guide-done">🎉 ¡Todo listo! Ya pueden avisarte si tu coche bloquea a alguien.</div>' : ''}`;

  // Newly completed steps: show the tick for a moment, then fade them away.
  const fresh = steps.filter((s) => s.done && !seen.includes(s.key)).map((s) => s.key);
  if (fresh.length) {
    store.set('guide.seen', [...seen, ...fresh].join(','));
    guideTimers.push(setTimeout(() => fresh.forEach((k) => {
      const li = box.querySelector(`li[data-key="${k}"]`); if (li) li.classList.add('gone');
    }), 1400));
  }
  if (allDone) {
    store.set('guide.finished', '1');
    guideTimers.push(setTimeout(() => box.classList.add('gone'), 4000));
    guideTimers.push(setTimeout(() => { box.classList.add('hidden'); $('#showGuide').classList.remove('hidden'); }, 4800));
  }

  box.querySelector('.guide-close').addEventListener('click', () => { store.set('guide.hidden', '1'); renderGuide(me); });
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'car') { $('#newPlate').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#newPlate').focus(); }
    else if (act === 'install' && installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => ({}));
      installPrompt = null;
      if (choice.outcome === 'accepted') store.set('guide.installed', '1');
      renderGuide(me);
    }
    else if (act === 'installed') { store.set('guide.installed', '1'); renderGuide(me); }
    else if (act === 'push') enablePush();
    else if (act === 'nopush') { store.set('guide.nopush', '1'); renderGuide(me); }
    else if (act === 'test') $('#testPush').click();
  }));
}
$('#showGuide').addEventListener('click', () => {
  store.del('guide.hidden'); store.del('guide.seen'); store.del('guide.finished');
  openTab('cars'); window.scrollTo(0, 0);
});

// ---------- Start ----------
async function start() {
  config = config || await api('/api/config');
  $('#devNote').classList.toggle('hidden', !config.devMode);
  $('#email').placeholder = 'nombre@' + (config.allowedDomains[config.allowedDomains.length - 1] || 'universidad.es');
  try {
    const me = await api('/api/me');
    show('app'); renderZones(); openTab(tabFromHash()); loadAlerts();
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !config) return;
  loadAlerts();
  if (!$('#tab-cars').classList.contains('hidden') && !$('#appView').classList.contains('hidden')) loadMe().catch(() => {});
});
start();
