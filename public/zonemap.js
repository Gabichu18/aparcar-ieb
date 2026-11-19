// Drawn sketch of the streets around IEB (not to scale), with the parking zones you can tap.
// Zone shapes come from zones.js on the server (/api/config).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Background: buildings, roads and labels. Roads are drawn wide and grey; the parking
  // zones are drawn on top of them in green.
  const BACKGROUND = `
    <rect x="0" y="0" width="360" height="520" class="zm-ground"/>
    <!-- buildings -->
    <rect x="18" y="150" width="112" height="112" rx="10" class="zm-bld zm-ieb"/>
    <text x="74" y="200" class="zm-bld-label">IEB</text>
    <text x="74" y="218" class="zm-bld-sub">🏛️</text>
    <rect x="214" y="150" width="84" height="150" rx="10" class="zm-bld"/>
    <text x="256" y="222" class="zm-bld-label small">Residencias</text>
    <rect x="140" y="340" width="150" height="104" rx="10" class="zm-bld"/>
    <text x="215" y="398" class="zm-bld-label">NIDO</text>
    <rect x="60" y="88" width="56" height="44" rx="8" class="zm-bld zm-site"/>
    <text x="88" y="114" class="zm-bld-sub">obras</text>
    <!-- roads -->
    <path d="M338,0 V520" class="zm-road zm-avenue"/>
    <path d="M338,476 H176 Q112,476 112,412 V318 Q112,284 146,276 Q186,266 186,226 V144" class="zm-road"/>
    <circle cx="186" cy="104" r="40" class="zm-road zm-ring"/>
    <path d="M150,90 Q106,72 84,54 Q62,36 18,28" class="zm-road"/>
    <circle cx="186" cy="104" r="22" class="zm-island"/>
    <!-- garage ramp -->
    <rect x="44" y="314" width="50" height="26" rx="5" class="zm-garage"/>
    <text x="69" y="331" class="zm-garage-label">Garaje</text>
    <path d="M94,327 H104" class="zm-arrow"/>
    <!-- labels -->
    <text x="338" y="260" class="zm-street-label" transform="rotate(90 338 260)">Avenida</text>
    <text x="300" y="498" class="zm-hint">↑ entrada</text>
  `;

  function create(el, { zones, onSelect }) {
    el.innerHTML = `<svg viewBox="0 0 360 520" class="zm" role="group" aria-label="Mapa de zonas de aparcamiento">
      ${BACKGROUND}<g class="zm-zones"></g><g class="zm-labels"></g></svg>`;
    const gZones = el.querySelector('.zm-zones');
    const gLabels = el.querySelector('.zm-labels');
    const nodes = {};

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
      shape.setAttribute('tabindex', '0');
      shape.setAttribute('role', 'button');
      shape.setAttribute('aria-label', z.name);
      const title = document.createElementNS(NS, 'title'); title.textContent = z.name; shape.appendChild(title);
      const pick = () => { api.select(z.id); onSelect && onSelect(z.id); };
      shape.addEventListener('click', pick);
      shape.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      gZones.appendChild(shape);
      nodes[z.id] = shape;

      // Number badge placed on the shape so people can match it with the buttons below.
      const len = shape.getTotalLength ? shape.getTotalLength() : 0;
      let p = { x: z.cx, y: z.cy };
      if (z.shape === 'ring') p = { x: z.cx + z.r * 0.71, y: z.cy - z.r * 0.71 };
      else if (z.shape !== 'area' && len) p = shape.getPointAtLength(len / 2);
      gLabels.insertAdjacentHTML('beforeend',
        `<g class="zm-badge" data-zone="${esc(z.id)}"><circle cx="${p.x}" cy="${p.y}" r="10"/><text x="${p.x}" y="${p.y + 4}">${i + 1}</text></g>`);
    });
    gLabels.querySelectorAll('.zm-badge').forEach((b) => b.addEventListener('click', () => nodes[b.dataset.zone].dispatchEvent(new Event('click'))));

    const api = {
      hasShapes: true,
      select(id) {
        for (const [zid, n] of Object.entries(nodes)) n.classList.toggle('selected', zid === id);
        gLabels.querySelectorAll('.zm-badge').forEach((b) => b.classList.toggle('selected', b.dataset.zone === id));
      },
      refresh() {},
    };
    return api;
  }

  window.ZoneMap = { create };
})();
