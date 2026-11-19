// Exact spot inside a zone: snaps a tapped point onto the zone and describes it in words.
// Used by the browser (window.Spot) and by the server (require('./public/spot')).
(function (root) {
  // Parse simple paths made of M, L, H and V commands into a list of points.
  function points(d) {
    const pts = []; let x = 0, y = 0;
    const re = /([MLHV])\s*([-\d.]+)(?:[ ,]+([-\d.]+))?/gi; let m;
    while ((m = re.exec(d))) {
      const c = m[1].toUpperCase();
      if (c === 'H') x = +m[2]; else if (c === 'V') y = +m[2]; else { x = +m[2]; y = +m[3]; }
      pts.push({ x, y });
    }
    return pts;
  }

  // Ring and centre: split by which side of the roundabout the spot is on.
  const SIDES = ['lado de la residencia', 'junto a la entrada desde la calle principal', 'lado de las obras', 'junto a la salida al tramo final'];
  function side(z, x, y) {
    const a = Math.atan2(y - z.cy, x - z.cx) * 180 / Math.PI; // 0 = right, 90 = down (SVG)
    if (a >= -45 && a < 45) return SIDES[0];
    if (a >= 45 && a < 135) return SIDES[1];
    if (a >= -135 && a < -45) return SIDES[3];
    return SIDES[2];
  }

  // Returns { x, y, label } on the zone, or null if the point is too far from it.
  function snap(z, x, y, maxDist = 40) {
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let p, label;
    if (z.shape === 'ring' || z.shape === 'area') {
      const dx = x - z.cx, dy = y - z.cy, d = Math.hypot(dx, dy) || 1;
      if (z.shape === 'ring') {
        if (Math.abs(d - z.r) > maxDist) return null;
        p = { x: z.cx + dx / d * z.r, y: z.cy + dy / d * z.r };
      } else {
        if (d > z.r + maxDist) return null;
        const k = Math.min(d, z.r - 4) / d;
        p = { x: z.cx + dx * k, y: z.cy + dy * k };
      }
      label = (z.shape === 'area' && Math.hypot(p.x - z.cx, p.y - z.cy) < 5) ? 'en el medio' : side(z, p.x, p.y);
    } else {
      const pts = points(z.path);
      let best = null, walked = 0, total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len)));
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const dist = Math.hypot(x - q.x, y - q.y);
        if (!best || dist < best.dist) best = { ...q, dist, along: walked + t * len };
        walked += len;
      }
      if (!best || best.dist > maxDist) return null;
      p = best;
      const parts = z.parts || ['al principio', 'a mitad de la calle', 'al final'];
      label = parts[Math.min(parts.length - 1, Math.floor(best.along / (total || 1) * parts.length))];
    }
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, label };
  }

  const api = { snap, points };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Spot = api;
})(typeof window !== 'undefined' ? window : globalThis);
