// Satellite map with the parking zones drawn on it. Used by the app (tap to select a zone)
// and by the zone editor. Requires Leaflet (loaded from /vendor/leaflet).
(function () {
  const DEFAULT_CENTER = [40.4468, -3.7860]; // Moncloa-Aravaca, used until the zones are drawn
  const COLOR = '#22c55e';
  const SELECTED = '#f79009';

  function baseMap(el, center, zoom) {
    const map = L.map(el, { zoomControl: true, attributionControl: true, tap: true, preferCanvas: true })
      .setView(center || DEFAULT_CENTER, center ? zoom || 18 : 15);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21, maxNativeZoom: 19, attribution: 'Imágenes © Esri',
    }).addTo(map);
    // Street names on top of the satellite image.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21, maxNativeZoom: 19, opacity: 0.6,
    }).addTo(map);
    return map;
  }

  function shapeFor(zone, renderer) {
    if (!zone.coords || zone.coords.length < 2) return null;
    const style = { color: COLOR, weight: 16, opacity: 0.7, lineCap: 'round', lineJoin: 'round', renderer };
    return zone.kind === 'area'
      ? L.polygon(zone.coords, { ...style, weight: 4, fillColor: COLOR, fillOpacity: 0.35 })
      : L.polyline(zone.coords, style);
  }

  // Map for choosing a zone. onSelect(id) is called when a zone is tapped.
  function create(el, { center, zoom, zones, onSelect }) {
    const map = baseMap(el, center, zoom);
    const renderer = L.canvas({ tolerance: 14 }); // generous tap area on phones
    const layers = {};
    const group = L.featureGroup().addTo(map);
    for (const z of zones) {
      const shape = shapeFor(z, renderer);
      if (!shape) continue;
      shape.bindTooltip(z.name, { direction: 'top', sticky: true });
      shape.on('click', () => { api.select(z.id); onSelect && onSelect(z.id); });
      shape.addTo(group);
      layers[z.id] = shape;
    }
    const api = {
      map,
      hasShapes: Object.keys(layers).length > 0,
      select(id) {
        for (const [zid, layer] of Object.entries(layers)) {
          const on = zid === id;
          layer.setStyle(on
            ? { color: SELECTED, opacity: 0.95, fillColor: SELECTED, fillOpacity: 0.45 }
            : { color: COLOR, opacity: 0.7, fillColor: COLOR, fillOpacity: 0.35 });
          if (on) layer.bringToFront();
        }
      },
      refresh() {
        map.invalidateSize();
        if (!center && api.hasShapes) map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 19 });
      },
    };
    if (!center && api.hasShapes) map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 19 });
    return api;
  }

  window.ZoneMap = { create, baseMap, shapeFor, COLOR, SELECTED, DEFAULT_CENTER };
})();
