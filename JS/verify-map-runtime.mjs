import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./site.js', import.meta.url), 'utf8');
const entry = adapter.match(/import \{ createCompiledJourneySphere \} from '(https:\/\/cdn\.jsdelivr\.net\/gh\/williamzheng0711\/journey-sphere@[a-f0-9]{40}\/src\/compiled\.js)'/);
assert.ok(entry, 'Homepage must use the precompiled renderer pinned to a commit');
const base = new URL('../', entry[1]);
const readRemote = async path => {
  const url = new URL(path, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `JourneySphere resource unavailable: ${url}`);
  return response;
};
const readJSON = async path => (await readRemote(path)).json();
const record = JSON.parse(readFileSync(new URL('../data/journeysphere-visits.json', import.meta.url), 'utf8'));
const manifest = await readJSON('data/compiled/manifest.json');
assert.equal(record.atlasVersion, manifest.version, 'Homepage travel record must match the compiled atlas');
assert.equal(new Set(record.visited).size, record.visited.length, 'Travel record must not contain duplicate IDs');

function verifyPayload(data) {
  assert.equal(data.format, manifest.format);
  assert.equal(data.version, manifest.version);
  assert.equal(data.extent, manifest.extent);
  assert.deepEqual(data.fingerprint, manifest.fingerprint);
  assert.ok(data.features.length > 0);
}

const countries = [...new Set(record.visited.map(id => id.split(':')[0]))];
await Promise.all([
  readJSON(`data/compiled/${manifest.worldFile}`).then(verifyPayload),
  ...countries.map(async code => {
    const country = manifest.countries[code];
    assert.ok(country?.file, `No compiled country shard for ${code}`);
    const data = await readJSON(`data/compiled/${country.file}`);
    verifyPayload(data);
    assert.equal(data.features.length, country.count);
    const ids = new Set(data.features.map(feature => feature.id));
    for (const id of record.visited.filter(id => id.startsWith(`${code}:`))) {
      assert.ok(ids.has(id), `Travel record contains unknown region ID: ${id}`);
    }
  }),
  ...['src/compiled.js', 'src/compiled-layer.js', 'src/state.js', 'data/compiled/manifest.js', 'src/style.css'].map(async file => {
    const response = await readRemote(file);
    const text = await response.text();
    assert.ok(text.length > 0, `Empty resource: ${file}`);
    if (file.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
  }),
]);

assert.match(html, /type="module" src="JS\/site\.js"/);
assert.ok(html.includes(`href="${base}src/style.css"`));
assert.ok(adapter.includes(`import manifest from '${base}data/compiled/manifest.js'`));
assert.ok(adapter.includes(`const JOURNEY_SPHERE_DATA_URL = '${base}data/'`));
assert.match(adapter, /record\.atlasVersion !== manifest\.version/);
assert.match(adapter, /dataUrl: JOURNEY_SPHERE_DATA_URL, manifest, visited: record\.visited/);
assert.doesNotMatch(adapter, /loadAtlas|L\.geoJSON|L\.map\(/, 'Homepage must use the compiled package without loading the legacy atlas');
assert.doesNotMatch(html + adapter, /journey-sphere@main\//, 'Code, styles and data must use the same pinned release');

console.log(`Homepage integration verified: ${record.visited.length} region IDs across ${countries.length} countries, atlas ${manifest.version}, pinned compiled renderer.`);
