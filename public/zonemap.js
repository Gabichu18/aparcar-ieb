// Drawn sketch of the streets around IEB (not to scale), with the parking zones you can tap.
// Zone shapes come from zones.js on the server (/api/config).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Background: buildings, roads and labels. Roads are drawn wide and grey; the parking
  // zones are drawn on top of them in green.
  const BACKGROUND = `
    <rect x="0" y="0" width="360" height="520" class="zm-ground"/>
    <!-- construction site (top left) -->
    <rect x="12" y="62" width="60" height="58" rx="8" class="zm-bld zm-site"/>
    <text x="42" y="95" class="zm-bld-sub">obras</text>
    <!-- IEB: the building sits back from the street, with gardens in front -->
    <rect x="6" y="162" width="104" height="284" rx="8" class="zm-lawn"/>
    <rect x="10" y="168" width="80" height="196" rx="6" class="zm-bld zm-ieb"/>
    <rect x="16" y="174" width="16" height="16" rx="2" class="zm-tower"/>
    <rect x="68" y="174" width="16" height="16" rx="2" class="zm-tower"/>
    <rect x="16" y="342" width="16" height="16" rx="2" class="zm-tower"/>
    <rect x="68" y="342" width="16" height="16" rx="2" class="zm-tower"/>
    <rect x="34" y="240" width="32" height="40" rx="3" class="zm-yard"/>
    <text x="50" y="226" class="zm-bld-label">IEB</text>
    <text x="50" y="310" class="zm-bld-sub">🏛️</text>
    <text x="50" y="405" class="zm-bld-sub">jardín</text>
    <path d="M90,270 H112" class="zm-steps"/>
    <circle cx="100" cy="180" r="5" class="zm-tree"/><circle cx="101" cy="196" r="5" class="zm-tree"/>
    <circle cx="100" cy="212" r="5" class="zm-tree"/><circle cx="24" cy="382" r="6" class="zm-tree"/>
    <circle cx="92" cy="420" r="6" class="zm-tree"/>
    <!-- residences + NIDO: one building that wraps the right side of the roundabout -->
    <path d="M154,448 V165 A61,61 0 0 0 161.5,51 L161.5,14 H314 V448 Z" class="zm-bld"/>
    <rect x="186" y="36" width="44" height="54" rx="4" class="zm-yard"/>
    <rect x="248" y="120" width="44" height="70" rx="4" class="zm-yard"/>
    <text x="236" y="236" class="zm-bld-label small">Residencias</text>
    <path d="M154,330 H314" class="zm-split"/>
    <rect x="166" y="368" width="34" height="22" rx="3" class="zm-nido-logo"/>
    <text x="183" y="377" class="zm-nido-logo-t">NI</text><text x="183" y="386" class="zm-nido-logo-t">DO</text>
    <text x="250" y="384" class="zm-bld-label">NIDO</text>
    <text x="250" y="400" class="zm-bld-sub">Student</text>
    <!-- sidewalks, then roads -->
    <path d="M338,476 H96" class="zm-walk"/>
    <path d="M130,476 V144" class="zm-walk zm-wide-walk"/>
    <circle cx="130" cy="104" r="40" class="zm-walk zm-ring-walk"/>
    <path d="M130,66 V0" class="zm-walk"/>
    <path d="M338,0 V520" class="zm-road zm-avenue"/>
    <path d="M349,0 V520" class="zm-lane"/>
    <path d="M338,476 H96" class="zm-road"/>
    <path d="M130,476 V144" class="zm-road zm-wide-road"/>
    <circle cx="130" cy="104" r="40" class="zm-road zm-ring"/>
    <path d="M130,66 V0" class="zm-road"/>
    <circle cx="130" cy="104" r="22" class="zm-island"/>
    <!-- IEB underground garage: straight on at the end of the NIDO street -->
    <path d="M100,461 L56,456 L56,496 L100,491 Z" class="zm-garage"/>
    <path d="M92,476 H66 M73,469 L66,476 L73,483" class="zm-garage-arrow"/>
    <text x="56" y="512" class="zm-garage-label-out">Garaje IEB</text>
    <!-- labels -->
    <text x="333" y="260" class="zm-street-label" transform="rotate(90 333 260)">Avenida</text>
    <text x="300" y="498" class="zm-hint">↑ entrada</text>
  `;

  // Pin marker whose tip sits exactly on (x, y).
  const PIN = (x, y) => `<g class="zm-pin" transform="translate(${x} ${y})">
    <ellipse cx="0" cy="0" rx="5" ry="2.2" class="zm-pin-shadow"/>
    <path d="M0,0 C-3,-8 -10,-12 -10,-20 A10,10 0 1 1 10,-20 C10,-12 3,-8 0,0 Z" class="zm-pin-body"/>
    <circle cx="0" cy="-20" r="4" class="zm-pin-dot"/></g>`;

  // options: zones, onSelect(zoneId, spot|null), readOnly, view ([x, y, w, h] to zoom in)
  function create(el, { zones, onSelect, readOnly, view }) {
    const vb = view || [0, 0, 360, 520];
    el.innerHTML = `<svg viewBox="${vb.join(' ')}" class="zm${readOnly ? ' zm-readonly' : ''}" ${readOnly ? 'aria-hidden="true"' : 'role="group" aria-label="Mapa de zonas de aparcamiento"'}>
      ${BACKGROUND}<g class="zm-zones"></g><g class="zm-labels"></g><g class="zm-pins"></g></svg>`;
    const svg = el.querySelector('svg');
    const gZones = el.querySelector('.zm-zones');
    const gLabels = el.querySelector('.zm-labels');
    const gPins = el.querySelector('.zm-pins');
    const nodes = {};

    // Screen tap -> map coordinates.
    const toMap = (e) => {
      const m = svg.getScreenCTM(); if (!m || !e.clientX) return null;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const q = pt.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
    };

    zones.forEach((z, i) => {
      let shape;
      if (z.shape === 'ring' || z.shape === 'area') {
        shape = document.createElementNS(NS, 'circle');
        shape.setAttribute('cx', z.cx); shape.setAttribute('cy', z.cy); shape.setAttribute('r', z.r);
      } else {
        shape = document.createElementNS(NS, 'path');
        shape.setAttribute('d', z.path);
      }
      shape.setAttribute('class', `zm-zone zm-${z.shape === 'area' ? 'fill' : 'line'}`);
      if (!readOnly) {
        shape.setAttribute('tabindex', '0');
        shape.setAttribute('role', 'button');
        shape.setAttribute('aria-label', z.name);
      }
      const title = document.createElementNS(NS, 'title'); title.textContent = z.name; shape.appendChild(title);
      // Tap on a zone: select it and drop the pin on the exact spot.
      const pick = (e) => {
        const p = e && toMap(e);
        const spot = p && window.Spot ? window.Spot.snap(z, p.x, p.y) : null;
        api.select(z.id, spot);
        onSelect && onSelect(z.id, spot);
      };
      if (!readOnly) {
        shape.addEventListener('click', pick);
        shape.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(null); } });
      }
      if (z.width) shape.style.strokeWidth = z.width;
      gZones.appendChild(shape);
      if (z.sides) { // dashed middle line so both sides of the street are clear
        const mid = document.createElementNS(NS, 'path');
        mid.setAttribute('d', z.path); mid.setAttribute('class', 'zm-centerline');
        gZones.appendChild(mid);
      }
      nodes[z.id] = { shape, pick };

      // Number badge placed on the shape so people can match it with the buttons below.
      if (readOnly) return;
      const len = shape.getTotalLength ? shape.getTotalLength() : 0;
      let p = { x: z.cx, y: z.cy };
      if (z.shape === 'ring') p = { x: z.cx + z.r * 0.71, y: z.cy - z.r * 0.71 };
      else if (z.shape !== 'area' && len) p = shape.getPointAtLength(len / 2);
      gLabels.insertAdjacentHTML('beforeend',
        `<g class="zm-badge" data-zone="${esc(z.id)}"><circle cx="${p.x}" cy="${p.y}" r="10"/><text x="${p.x}" y="${p.y + 4}">${i + 1}</text></g>`);
    });
    gLabels.querySelectorAll('.zm-badge').forEach((b) => b.addEventListener('click', (e) => nodes[b.dataset.zone].pick(e)));

    const api = {
      hasShapes: true,
      select(id, spot) {
        for (const [zid, n] of Object.entries(nodes)) n.shape.classList.toggle('selected', zid === id);
        gLabels.querySelectorAll('.zm-badge').forEach((b) => {
          b.classList.toggle('selected', b.dataset.zone === id);
          b.classList.toggle('hidden', !!spot && b.dataset.zone === id); // the pin replaces the number
        });
        gPins.innerHTML = spot ? PIN(spot.x, spot.y) : '';
      },
      refresh() {},
    };
    return api;
  }

  // A zoomed-in view centred on a spot (for showing an alert's location).
  function viewAround(x, y, w = 280, h = 180) {
    const vx = Math.max(0, Math.min(360 - w, x - w / 2));
    const vy = Math.max(0, Math.min(520 - h, y - h / 2 - 10));
    return [vx, vy, w, h];
  }

  window.ZoneMap = { create, viewAround };
})();
