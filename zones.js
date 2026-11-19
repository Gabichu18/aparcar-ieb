// Parking zones around IEB, drawn as a sketch from the Google Earth pictures (green areas).
// `path` is the SVG shape on the drawn map (viewBox 0 0 360 520, see public/zonemap.js).
// `shape`: 'line' = street with parking along it, 'area' = filled area.
// Ids must stay stable once the app is in use (old alerts refer to them).
module.exports = [
  {
    id: 'nido-street',
    name: 'Calle de NIDO',
    description: 'Desde la avenida, a lo largo de la residencia NIDO, hasta la esquina del garaje.',
    shape: 'line',
    path: 'M318,476 H170 Q130,476 130,436 V414',
  },
  {
    id: 'ieb-street',
    name: 'Calle principal del IEB',
    description: 'Tras girar a la derecha: la calle recta entre el IEB y la residencia, hasta la rotonda.',
    shape: 'line',
    path: 'M130,398 V158',
  },
  {
    id: 'plaza',
    name: 'Rotonda',
    description: 'Alrededor de la rotonda del fondo.',
    shape: 'ring',
    cx: 130, cy: 104, r: 40,
  },
  {
    id: 'plaza-center',
    name: 'Centro de la rotonda',
    description: 'Plazas en el centro de la rotonda.',
    shape: 'area',
    cx: 130, cy: 104, r: 19,
  },
  {
    id: 'last-section',
    name: 'Tramo final',
    description: 'La calle que sigue recta después de la rotonda.',
    shape: 'line',
    path: 'M130,52 V12',
  },
];
