// Parking zones around IEB, drawn as a sketch from the Google Earth pictures (green areas).
// `path` is the SVG shape on the drawn map (viewBox 0 0 360 520, see public/zonemap.js).
// `shape`: 'line' = street with parking along it, 'area' = filled area.
// Ids must stay stable once the app is in use (old alerts refer to them).
module.exports = [
  {
    id: 'nido-street',
    name: 'Calle de NIDO',
    description: 'Desde la avenida, junto a la residencia NIDO, hasta la rampa del garaje.',
    shape: 'line',
    path: 'M318,476 H176 Q112,476 112,412 V332',
  },
  {
    id: 'ieb-street',
    name: 'Calle principal del IEB',
    description: 'Tras girar a la derecha en la rampa del garaje: la calle entre el IEB y las residencias, hasta la rotonda.',
    shape: 'line',
    path: 'M112,318 Q112,284 146,276 Q186,266 186,226 V158',
  },
  {
    id: 'plaza',
    name: 'Rotonda',
    description: 'Alrededor de la rotonda del fondo.',
    shape: 'ring',
    cx: 186, cy: 104, r: 40,
  },
  {
    id: 'plaza-center',
    name: 'Centro de la rotonda',
    description: 'Plazas en el centro de la rotonda.',
    shape: 'area',
    cx: 186, cy: 104, r: 19,
  },
  {
    id: 'last-section',
    name: 'Tramo final',
    description: 'La calle que sigue después de la rotonda.',
    shape: 'line',
    path: 'M134,80 Q106,72 84,54 Q62,36 30,32',
  },
];
