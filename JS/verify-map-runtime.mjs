import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const base = 'packages/journey-sphere/';
const html = read('index.html');
const adapter = read('JS/site.js');
const manifest = json(`${base}data/compiled/manifest.json`);
const record = json('data/journeysphere-visits.json');
const startup = json('packages/journey-sphere/data/startup.json');
assert.equal(record.atlasVersion, manifest.version);
assert.equal(startup.atlasVersion, manifest.version);
assert.deepEqual(startup.visited, record.visited);
assert.deepEqual(startup.labels, record.labels);
assert.equal(new Set(record.visited).size, record.visited.length);
function verifyPayload(data) {
  assert.equal(data.format, manifest.format);
  assert.equal(data.version, manifest.version);
  assert.equal(data.extent, manifest.extent);
  assert.deepEqual(data.fingerprint, manifest.fingerprint);
  assert.ok(data.features.length > 0);
}
verifyPayload(json(`${base}data/compiled/${manifest.worldFile}`));
const countries = [...new Set(record.visited.map(id => id.split(':')[0]))];
assert.deepEqual(Object.keys(startup.countries), countries);
for (const code of countries) {
  const entry = manifest.countries[code];
  const full = json(`${base}data/compiled/${entry.file}`);
  verifyPayload(full);
  verifyPayload(startup.countries[code]);
  assert.equal(full.features.length, entry.count);
  const selected = full.features.filter(feature => record.visited.includes(feature.id));
  assert.deepEqual(startup.countries[code].features, selected, 'Startup must retain exact visited geometry and indices');
  assert.equal(selected.length, record.visited.filter(id => id.startsWith(`${code}:`)).length);
}
assert.ok(html.includes('href="packages/leaflet/leaflet.css"'));
assert.ok(html.includes('src="packages/leaflet/leaflet.js"'));
assert.ok(html.includes('href="packages/journey-sphere/data/startup.json"'));
assert.ok(adapter.includes('initialCountries: record.countries'));
assert.doesNotMatch(html + adapter, /cdn\.jsdelivr\.net/, 'Startup must not depend on third-party map resources');
console.log(`Verified ${record.visited.length} exact region geometries across ${countries.length} countries; local startup assets and matching atlas.`);

// Detect hand edits to generated map artifacts, without needing the source checkout.
const provenance = json(`${base}export-manifest.json`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [file, hash] of Object.entries(provenance.files)) {
  assert.equal(sha256(readFileSync(new URL(`../${base}${file}`, import.meta.url))), hash, `Generated map file was edited: ${file}`);
}
assert.equal(sha256(readFileSync(new URL('../data/journeysphere-visits.json', import.meta.url))), provenance.recordSha256, 'Travel record changed; run node JS/sync-map.mjs');
for (const file of ['src/compiled.js', 'src/compiled-layer.js', 'src/state.js', 'src/style.css']) {
  assert.equal(provenance.files[file], provenance.sourceHashes[file], `Deployment must use canonical map source: ${file}`);
}
console.log('Generated map artifact hashes and travel-record provenance verified.');
