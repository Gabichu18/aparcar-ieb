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
    $('#alertPlate').value = ''; $('#alertNote').value = ''; selectZone(null); $('#scanState').classList.add('hidden');
  } catch (err) { toast(err.message); }
});

// ---------- Read the plate from a photo (Tesseract, runs on the phone) ----------
let ocrWorker = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector')); document.head.appendChild(s); });
}
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript('/ocr/js/tesseract.min.js');
  const base = location.origin + '/ocr';
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: base + '/js/worker.min.js', corePath: base + '/core', langPath: base + '/lang', gzip: true,
  });
  await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  return ocrWorker;
}
// Resize the photo to a given width and make it grey (Tesseract reads best with letters ~30-60 px tall).
async function photoAt(img, width) {
  const scale = width / img.width;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.2)'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// Find a Spanish plate in the text: 1234 BCD (current) or M 1234 AB (old). Fixes common misreads.
function findPlate(text) {
  const raw = text.toUpperCase().replace(/[^A-Z0-9\n ]/g, ' ');
  const toDigit = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
  const toLetter = { 0: 'D', 1: 'J', 2: 'Z', 5: 'S', 8: 'B', 6: 'G', 7: 'T', A: 'R', E: 'F', I: 'J', O: 'D', U: 'V', Q: 'D' };
  const compact = raw.replace(/\s+/g, '');
  const tokens = [compact, ...raw.split('\n').map((l) => l.replace(/\s+/g, ''))];
  // Try every position and keep the reading that needs the fewest corrections.
  let best = null;
  for (const t of tokens) {
    for (let i = 0; i + 7 <= t.length; i++) {
      const d0 = t.slice(i, i + 4), l0 = t.slice(i + 4, i + 7);
      const digits = d0.split('').map((ch) => toDigit[ch] || ch).join('');
      const letters = l0.split('').map((ch) => toLetter[ch] || ch).join('');
      if (!/^\d{4}$/.test(digits) || !/^[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(letters)) continue;
      const fixes = [...d0].filter((ch, k) => ch !== digits[k]).length + [...l0].filter((ch, k) => ch !== letters[k]).length;
      if (fixes <= 2 && (!best || fixes < best.fixes)) best = { fixes, plate: digits + ' ' + letters };
    }
  }
  if (best) return best.plate;
  const old = compact.match(/([A-Z]{1,2})(\d{4})([A-Z]{1,2})/);
  return old ? `${old[1]} ${old[2]} ${old[3]}` : null;
}
// Read a tight crop around the plate (one line of text).
async function readCrop(worker, crop) {
  await worker.setParameters({ tessedit_pageseg_mode: '7' });
  for (const width of [380, 560]) {
    const { data } = await worker.recognize(await photoAt(crop, width));
    window.lastOcrText = data.text;
    const plate = findPlate(data.text);
    if (plate) return plate;
  }
  return null;
}
function plateFound(plate) {
  $('#alertPlate').value = plate;
  const st = $('#scanState'); st.classList.remove('hidden');
  st.textContent = `✅ He leído ${plate}. Compruébala antes de enviar.`;
}

// Live camera: the plate is read on its own while you hold it inside the frame.
let scanStream = null;
function closeScanner() {
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
  $('#scanner').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}
async function openScanner() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return $('#scanFile').click();
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch { return $('#scanFile').click(); } // no camera permission: pick / take a photo instead
  const video = $('#scanVideo');
  video.srcObject = scanStream;
  $('#scanner').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('#scanText').textContent = 'Preparando el lector…';
  await video.play().catch(() => {});
  let worker;
  try { worker = await getOcr(); } catch { closeScanner(); return toast('No se pudo cargar el lector. Escribe la matrícula a mano.'); }
  $('#scanText').textContent = 'Pon la matrícula dentro del recuadro';
  const started = Date.now();
  while (scanStream) {
    if (video.videoWidth) {
      const plate = await readCrop(worker, grabFrame(video, $('#scanFrame'))).catch(() => null);
      if (plate && scanStream) { closeScanner(); plateFound(plate); if (navigator.vibrate) navigator.vibrate(80); return; }
      if (Date.now() - started > 8000) $('#scanText').textContent = 'Acércate un poco y que la matrícula quede recta y bien iluminada';
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
// Cut out the part of the camera image that is inside the on-screen frame (plus a small margin).
function grabFrame(video, frame) {
  const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
  const s = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight); // object-fit: cover
  const ox = (vr.width - video.videoWidth * s) / 2, oy = (vr.height - video.videoHeight * s) / 2;
  const mx = fr.width * 0.06, my = fr.height * 0.2;
  const sx = Math.max(0, (fr.left - vr.left - ox - mx) / s), sy = Math.max(0, (fr.top - vr.top - oy - my) / s);
  const sw = Math.min(video.videoWidth - sx, (fr.width + 2 * mx) / s), sh = Math.min(video.videoHeight - sy, (fr.height + 2 * my) / s);
  const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
$('#scanPlate').addEventListener('click', openScanner);
$('#scanCancel').addEventListener('click', closeScanner);
$('#scanPhoto').addEventListener('click', () => { closeScanner(); $('#scanFile').click(); });
// Photo instead of live camera: the plate can be anywhere, so read the whole picture at a few sizes.
$('#scanFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const st = $('#scanState'); st.classList.remove('hidden');
  st.textContent = '🔎 Leyendo la matrícula… (la primera vez tarda unos segundos)';
  $('#scanPlate').disabled = true;
  try {
    const [worker, img] = await Promise.all([getOcr(), createImageBitmap(file)]);
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    let plate = null;
    for (const width of [900, 600, 1400]) {
      const { data } = await worker.recognize(await photoAt(img, width));
      window.lastOcrText = data.text;
      plate = findPlate(data.text);
      if (plate) break;
    }
    if (plate) plateFound(plate);
    else st.textContent = 'No he podido leer la matrícula. Prueba con la cámara en directo (📷) o escríbela a mano.';
  } catch (err) {
    st.textContent = 'No se pudo leer la foto. Escribe la matrícula a mano.';
    console.error(err);
  } finally { $('#scanPlate').disabled = false; }
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
        ${a.status === 'notified' && a.escalated ? '<div class="note">😕 El dueño aún no ha respondido. Prueba a avisar en conserjería o a seguridad del campus.</div>' : ''}
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
