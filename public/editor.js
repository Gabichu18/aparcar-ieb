// Zone editor: admins tap points on the satellite map to draw each parking zone.
const $ = (s) => document.querySelector(s);
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Algo ha fallado'); e.status = res.status; throw e; }
  return data;
}

let zones = [];      // [{ id, name, kind, coords }]
let current = null;  // id of the zone being edited
let map, shapes = {}, vertexLayer, dirty = false;

function draw() {
  for (const l of Object.values(shapes)) l.remove();
  shapes = {};
  for (const z of zones) {
    const shape = ZoneMap.shapeFor(z);
    if (!shape) continue;
    const on = z.id === current;
    shape.setStyle(on ? { color: ZoneMap.SELECTED, fillColor: ZoneMap.SELECTED, opacity: 0.9 } : { opacity: 0.45, fillOpacity: 0.2 });
    shape.bindTooltip(z.name, { direction: 'top', sticky: true });
    shape.on('click', (e) => { if (z.id !== current) { L.DomEvent.stop(e); pick(z.id); } });
    shape.addTo(map);
    shapes[z.id] = shape;
  }
  vertexLayer.clearLayers();
  const z = zones.find((x) => x.id === current);
  (z ? z.coords : []).forEach((p, i) => {
    L.circleMarker(p, { radius: i === z.coords.length - 1 ? 8 : 6, color: '#f79009', weight: 3, fillColor: '#fff', fillOpacity: 1 })
      .addTo(vertexLayer);
  });
}

function pick(id) {
  current = id;
  const z = zones.find((x) => x.id === id);
  $('#zoneSel').value = id;
  $('#zoneName').value = z.name;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === z.kind));
  $('#refImg').src = `/img/${id}.jpg`;
  draw();
}

async function init() {
  let me;
  try { me = await api('/api/me'); } catch (err) {
    $('#deniedText').textContent = 'Entra primero en la app con tu email y vuelve a abrir esta página.';
    return $('#denied').classList.remove('hidden');
  }
  if (!me.isAdmin) return $('#denied').classList.remove('hidden');

  const config = await api('/api/config');
  zones = config.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind || 'line', coords: z.coords || [] }));
  $('#editor').classList.remove('hidden');

  map = ZoneMap.baseMap($('#map'), config.map.center, config.map.zoom);
  vertexLayer = L.layerGroup().addTo(map);
  const all = zones.flatMap((z) => z.coords);
  if (!config.map.center && all.length) map.fitBounds(all, { padding: [30, 30] });

  map.on('click', (e) => {
    const z = zones.find((x) => x.id === current);
    z.coords.push([+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7)]);
    dirty = true; draw();
  });

  $('#zoneSel').innerHTML = zones.map((z) => `<option value="${z.id}">${z.name.replace(/</g, '&lt;')}</option>`).join('');
  $('#zoneSel').addEventListener('change', (e) => pick(e.target.value));
  $('#zoneName').addEventListener('input', (e) => {
    const z = zones.find((x) => x.id === current); z.name = e.target.value; dirty = true;
    $('#zoneSel').selectedOptions[0].textContent = e.target.value || z.id;
  });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    zones.find((x) => x.id === current).kind = b.dataset.kind; dirty = true; pick(current);
  }));
  $('#undo').addEventListener('click', () => { zones.find((x) => x.id === current).coords.pop(); dirty = true; draw(); });
  $('#clear').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los puntos de esta zona?')) return;
    zones.find((x) => x.id === current).coords = []; dirty = true; draw();
  });
  $('#save').addEventListener('click', async () => {
    const c = map.getCenter();
    try {
      await api('/api/admin/zones', {
        method: 'PUT',
        body: {
          center: [+c.lat.toFixed(7), +c.lng.toFixed(7)], zoom: map.getZoom(),
          zones: Object.fromEntries(zones.map((z) => [z.id, { name: z.name, kind: z.kind, coords: z.coords }])),
        },
      });
      dirty = false; toast('Zonas guardadas. Ya las ven todos en la app.');
    } catch (err) { toast(err.message); }
  });
  $('#refImg').addEventListener('click', () => { $('#bigRef img').src = $('#refImg').src; $('#bigRef').classList.remove('hidden'); });
  $('#bigRef').addEventListener('click', () => $('#bigRef').classList.add('hidden'));
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  pick(zones[0].id);
  setTimeout(() => map.invalidateSize(), 50);
}
init();
