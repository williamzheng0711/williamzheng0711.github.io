/**
 * Resolve user-facing place names to JourneySphere region ids.
 *
 * The resolver deliberately knows only the small name index. Geometry remains
 * in lazily fetched region shards, so an embed loads data for visited places.
 */

import commonAliases from '../data/embed/aliases.js';
import { normalizePlaceName, placeBucket } from './place-names.js';
export { normalizePlaceName, placeBucket } from './place-names.js';

function endpoint(baseUrl, relative) {
  const root = new URL(String(baseUrl || './'), globalThis.location?.href || 'http://localhost/');
  root.pathname = root.pathname.replace(/\/?$/, '/');
  return new URL(relative, root).href;
}

function candidateLabel(candidate, index, candidates) {
  const label = candidate.qualified;
  // Some source datasets omit parent names: offer an exact ID rather than an
  // ambiguous suggestion that would fail again.
  return label && candidates.filter(item => item.qualified === label).length === 1 ? label : candidate.ids[0];
}

function parseQualified(value) {
  const comma = value.lastIndexOf(',');
  if (comma < 0 || !/^[A-Za-z]{3}$/.test(value.slice(comma + 1).trim())) return { name: value, qualifier: null };
  return { name: value.slice(0, comma).trim(), qualifier: value.slice(comma + 1).trim() };
}

export async function resolvePlaces(names, { baseUrl = './data/embed/', signal } = {}) {
  if (signal?.aborted) throw signal.reason;
  if (!Array.isArray(names)) throw new TypeError('Place names must be an array.');
  const inputs = names.map(name => {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Every place name must be a non-empty string.');
    return name.trim();
  });
  const buckets = new Set();
  for (const input of inputs) {
    const { name } = parseQualified(input);
    const key = normalizePlaceName(name);
    if (!Object.hasOwn(commonAliases, key)) buckets.add(placeBucket(key));
  }
  const loaded = new Map(await Promise.all([...buckets].map(async bucket => {
    const response = await fetch(endpoint(baseUrl, `names/${bucket}.json`), { signal });
    if (!response.ok) throw new Error(`Unable to load place index shard ${bucket} (${response.status}).`);
    const data = await response.json();
    return [bucket, data];
  })));

  const visited = new Set();
  const labels = {};
  const chunks = new Set();
  for (const input of inputs) {
    const parsed = parseQualified(input);
    const key = normalizePlaceName(parsed.name);
    const index = Object.hasOwn(commonAliases, key) ? commonAliases : loaded.get(placeBucket(key));
    const candidates = index && Object.hasOwn(index, key) ? index[key] : [];
    const filtered = parsed.qualifier
      ? candidates.filter(candidate => normalizePlaceName(candidate.country || '') === normalizePlaceName(parsed.qualifier))
      : candidates;
    if (!filtered.length) {
      if (!candidates.length) throw new Error(`Unknown place: ${input}.`);
      throw new Error(`Unknown qualified place: ${input}. Available candidates: ${candidates.map(candidateLabel).join('; ')}.`);
    }
    if (filtered.length > 1) throw new Error(`Ambiguous place: ${input}. Use one of: ${filtered.map(candidateLabel).join('; ')}.`);
    const candidate = filtered[0];
    for (const id of candidate.ids) { visited.add(id); labels[id] = input; }
    for (const chunk of candidate.chunks || []) chunks.add(chunk);
  }
  return { visited: [...visited], labels, chunks: [...chunks].sort() };
}
