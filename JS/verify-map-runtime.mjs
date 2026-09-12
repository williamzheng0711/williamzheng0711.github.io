import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const JOURNEY_SPHERE_BASE = 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@main/';
const readLocal = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const readRemoteJSON = async path => {
  const url = new URL(path, JOURNEY_SPHERE_BASE);
  const response = await fetch(url);
  assert.ok(response.ok, `JourneySphere resource unavailable: ${url}`);
  return response.json();
};

const catalog = await readRemoteJSON('data/catalog.json');
const record = readLocal('data/journeysphere-visits.json');
assert.equal(record.atlasVersion, catalog.version, 'Homepage travel record must pin the atlas version');

const regionIds = new Set(catalog.regionIds);
for (const id of record.visited) {
  assert.ok(regionIds.has(id), `Homepage record contains unknown region ID: ${id}`);
}

const countryCodes = new Set(record.visited.map(id => id.split(':', 1)[0]));
for (const code of countryCodes) {
  const entry = catalog.countries[code];
  assert.ok(entry?.file, `JourneySphere has no data shard for ${code}`);
  await readRemoteJSON(`data/${entry.file}`);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./site.js', import.meta.url), 'utf8');
assert.match(html, /type="module" src="JS\/site\.js"/);
assert.match(adapter, /import \{ createJourneySphere, loadAtlas \} from 'https:\/\/cdn\.jsdelivr\.net\/gh\/williamzheng0711\/journey-sphere@main\/src\/index\.js'/);
assert.match(html, /https:\/\/cdn\.jsdelivr\.net\/gh\/williamzheng0711\/journey-sphere@main\/src\/style\.css/);
assert.match(adapter, /loadAtlas\(JOURNEY_SPHERE_DATA_URL\)/);
assert.doesNotMatch(adapter, /L\.geoJSON|L\.map\(/, 'Homepage must consume the package, not duplicate its renderer');

console.log(`Homepage integration verified: ${record.visited.length} stable region IDs, atlas ${catalog.version}, public package renderer.`);
