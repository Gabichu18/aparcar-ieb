// Parking zones around IEB, drawn as a sketch from the Google Earth pictures (green areas).
// `path` is the SVG shape on the drawn map (viewBox 0 0 360 520, see public/zonemap.js).
// `shape`: 'line' = street with parking along it, 'area' = filled area.
// `parts`: words for the start, middle and end of a street (used to describe the exact spot).
// Ids must stay stable once the app is in use (old alerts refer to them).
module.exports = [
  {
    id: 'nido-street',
    name: 'Calle de NIDO',
    description: 'Desde la avenida, a lo largo de la residencia NIDO, hasta el cruce con el garaje del IEB.',
    shape: 'line',
    path: 'M318,476 H150',
    parts: ['junto a la avenida', 'a mitad de la calle', 'junto al cruce del garaje'],
  },
  {
    id: 'ieb-street',
    name: 'Calle principal del IEB',
    description: 'En el cruce, girando a la derecha: la calle recta entre el IEB y la residencia, hasta la rotonda.',
    shape: 'line',
    path: 'M130,452 V158',
    parts: ['al principio, junto al cruce', 'a mitad de la calle', 'al final, junto a la rotonda'],
    // Two-sided street: the pin goes on the side you tap. sides[0] = left when walking along the path.
    sides: ['lado del IEB', 'lado de la residencia'],
    width: 36,
  },
  {
    id: 'plaza',
    name: 'Rotonda',
    description: 'Alrededor de la rotonda del fondo.',
    shape: 'ring',
    cx: 130, cy: 104, r: 46,
  },
  {
    id: 'plaza-center',
    name: 'Centro de la rotonda',
    description: 'Plazas en el centro de la rotonda.',
    shape: 'area',
    cx: 130, cy: 104, r: 31,
  },
  {
    id: 'last-section',
    name: 'Tramo final',
    description: 'La calle que sigue recta después de la rotonda.',
    shape: 'line',
    path: 'M130,42 V10',
    parts: ['justo al salir de la rotonda', 'a mitad del tramo', 'al final del tramo'],
    sides: ['lado de las obras', 'lado de la residencia'],
    width: 36,
  },
];
