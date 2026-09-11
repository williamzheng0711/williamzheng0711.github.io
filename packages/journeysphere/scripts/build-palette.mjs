import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '..');
const sourcePath = resolve(argumentValue('--source') || resolve(scriptDirectory, 'palette-source.json'));
const worldPath = resolve(argumentValue('--world') || resolve(packageRoot, 'data/world.geojson'));
const catalogPath = resolve(argumentValue('--catalog') || resolve(packageRoot, 'data/catalog.json'));
const outputPath = resolve(argumentValue('--output') || resolve(packageRoot, 'data/palette.json'));

const [source, world, catalog] = await Promise.all([
  readJson(sourcePath),
  readJson(worldPath),
  readOptionalJson(catalogPath),
]);
const countries = source.countries || {};
const features = world.features || [];
const worldCodes = features.map(feature => feature.properties?.countryCode || feature.properties?.ADM0_A3);
const catalogCodes = Object.keys(catalog?.countries || {});
const codes = [...new Set([...worldCodes, ...catalogCodes])];
const errors = [];

for (const code of codes) {
  if (!countries[code]) errors.push(`${code}: missing palette source entry`);
}
for (const [code, entry] of Object.entries(countries)) validateEntry(code, entry, errors);
if (new Set(worldCodes).size !== worldCodes.length) errors.push('World atlas contains duplicate country codes');
if (errors.length) throw new Error(`Invalid palette source:\n${errors.join('\n')}`);

const neighbors = countryAdjacency(features);
const selected = new Map();
const orderedCodes = [...new Set(codes)].sort((first, second) => {
  const lockedDifference = Number(Boolean(countries[second].locked)) - Number(Boolean(countries[first].locked));
  if (lockedDifference) return lockedDifference;
  const degreeDifference = (neighbors.get(second)?.size || 0) - (neighbors.get(first)?.size || 0);
  return degreeDifference || first.localeCompare(second);
});

for (const code of orderedCodes) {
  const entry = countries[code];
  const candidates = entry.candidates;
  const choice = entry.locked
    ? candidates.find(candidate => candidate.color === entry.initial)
    : chooseCandidate(code, entry, selected, neighbors);
  selected.set(code, choice);
}

const palette = Object.fromEntries([...new Set(codes)].sort().map(code => {
  const entry = countries[code];
  const choice = selected.get(code);
  return [code, {
    color: choice.color,
    rationale: choice.rationale,
    locked: Boolean(entry.locked),
    candidates: entry.candidates,
  }];
}));

await writeFile(outputPath, `${JSON.stringify(palette, null, 2)}\n`);
console.log(`JourneySphere palette: ${Object.keys(palette).length} countries, ${edgeCount(neighbors)} land adjacencies -> ${outputPath}`);

function chooseCandidate(code, entry, selectedColors, adjacency) {
  const chosenNeighbors = [...(adjacency.get(code) || [])]
    .map(neighbor => selectedColors.get(neighbor))
    .filter(Boolean);
  if (!chosenNeighbors.length) {
    return entry.candidates.find(candidate => candidate.color === entry.initial);
  }

  return entry.candidates.reduce((best, candidate) => {
    const distance = Math.min(...chosenNeighbors.map(neighbor => colorDistance(candidate.color, neighbor.color)));
    const initialTieBreak = candidate.color === entry.initial ? 0.000001 : 0;
    const score = distance + initialTieBreak;
    return !best || score > best.score ? { ...candidate, score } : best;
  }, null);
}

function validateEntry(code, entry, validationErrors) {
  if (!/^[A-Z]{3}$/.test(code)) validationErrors.push(`${code}: key must be an uppercase three-letter atlas code`);
  if (typeof entry?.name !== 'string' || !entry.name) validationErrors.push(`${code}: missing name`);
  if (!Array.isArray(entry?.candidates) || entry.candidates.length === 0) {
    validationErrors.push(`${code}: candidates must be a non-empty array`);
    return;
  }
  const colors = new Set();
  for (const candidate of entry.candidates) {
    if (!/^#[0-9A-F]{6}$/.test(candidate?.color || '')) validationErrors.push(`${code}: invalid color ${candidate?.color}`);
    if (typeof candidate?.rationale !== 'string' || !candidate.rationale) validationErrors.push(`${code}: candidate missing rationale`);
    if (colors.has(candidate?.color)) validationErrors.push(`${code}: duplicate candidate ${candidate?.color}`);
    colors.add(candidate?.color);
  }
  if (!colors.has(entry.initial)) validationErrors.push(`${code}: initial must match a candidate color`);
}

function countryAdjacency(countryFeatures) {
  const segments = new Map();
  const adjacency = new Map();
  for (const feature of countryFeatures) {
    const code = feature.properties?.countryCode || feature.properties?.ADM0_A3;
    adjacency.set(code, new Set());
    visitRings(feature.geometry, ring => {
      for (let index = 1; index < ring.length; index += 1) {
        const key = segmentKey(ring[index - 1], ring[index]);
        if (!key) continue;
        if (!segments.has(key)) segments.set(key, new Set());
        segments.get(key).add(code);
      }
    });
  }

  for (const owners of segments.values()) {
    const sharing = [...owners];
    for (let first = 0; first < sharing.length; first += 1) {
      for (let second = first + 1; second < sharing.length; second += 1) {
        adjacency.get(sharing[first]).add(sharing[second]);
        adjacency.get(sharing[second]).add(sharing[first]);
      }
    }
  }
  return adjacency;
}

function visitRings(geometry, visit) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visit);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(polygon => polygon.forEach(visit));
  else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(child => visitRings(child, visit));
}

function segmentKey(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return null;
  const firstKey = `${Number(first[0]).toFixed(5)},${Number(first[1]).toFixed(5)}`;
  const secondKey = `${Number(second[0]).toFixed(5)},${Number(second[1]).toFixed(5)}`;
  if (firstKey === secondKey) return null;
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

function colorDistance(first, second) {
  const a = oklab(first);
  const b = oklab(second);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function oklab(hex) {
  const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]);
  const m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]);
  const s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function edgeCount(adjacency) {
  return [...adjacency.values()].reduce((total, entries) => total + entries.size, 0) / 2;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
