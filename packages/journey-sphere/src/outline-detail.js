const EXTENT = 2 ** 24;
const WORLD = 256;
const MAX_CACHE = 32;
const MAX_CONCURRENT = 3;
const MOVE_DEBOUNCE = 60;
const FOCAL_EXCLUSIVE_MS = 2000;
const FRAGMENT_BUFFER_PX = 512;

const inert = () => ({ get: () => null, load: () => Promise.resolve([]), ready: Promise.resolve([]), destroy() {} });
function abortedHandle(reason) {
  const promise = Promise.reject(reason);
  promise.catch(() => {});
  return { get: () => null, load: () => promise, ready: promise, destroy() {} };
}

function object(value) { return value !== null && typeof value === 'object'; }
function latLngPart(value, key, index) {
  return Number.isFinite(value?.[key]) ? value[key] : value?.[index];
}
function pathIsValid(path) {
  // The compiler emits closed rings: one absolute move and integer deltas.
  return typeof path === 'string' &&
    /^(?:M-?\d+ -?\d+(?:l-?\d+ -?\d+){3,}z)(?: M-?\d+ -?\d+(?:l-?\d+ -?\d+){3,}z)*$/.test(path);
}

/** Expand transport rings to the original closed SVG path; legacy paths remain supported.
 * Each ring starts relative to the previous ring's origin (initially 0,0), then
 * stores point deltas. The final closing delta is reconstructed without loss.
 */
export function decodeOutlinePath(feature) {
  const invalid = () => new Error('JourneySphere: invalid detailed outline path encoding.');
  if (!object(feature)) throw invalid();
  if (Object.hasOwn(feature, 'd')) {
    if (Object.hasOwn(feature, 'paths') || Object.hasOwn(feature, 'pathEncoding') ||
        !pathIsValid(feature.d)) throw invalid();
    return feature.d;
  }
  if (feature.pathEncoding !== 'relative-delta-v1' ||
      !Array.isArray(feature.paths) || !feature.paths.length) throw invalid();
  const integer = value => { if (!Number.isSafeInteger(value)) throw invalid(); return value; };
  const rings = [];
  let originX = 0; let originY = 0;
  for (const ring of feature.paths) {
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0) throw invalid();
    originX = integer(originX + integer(ring[0]));
    originY = integer(originY + integer(ring[1]));
    let x = originX; let y = originY;
    const commands = [`M${x} ${y}`];
    for (let index = 2; index < ring.length; index += 2) {
      const dx = integer(ring[index]); const dy = integer(ring[index + 1]);
      x = integer(x + dx); y = integer(y + dy);
      commands.push(`l${dx} ${dy}`);
    }
    commands.push(`l${integer(originX - x)} ${integer(originY - y)}z`);
    rings.push(commands.join(''));
  }
  return rings.join(' ');
}

function sameFingerprint(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}
function validateRecord(data, code, manifest, fragment) {
  if (!object(data) || data.format !== 1 || data.version !== manifest.version ||
      data.extent !== EXTENT || !sameFingerprint(data.fingerprint, manifest.fingerprint) ||
      !Array.isArray(data.features) || data.features.length !== 1) {
    throw new Error(`JourneySphere: invalid detailed outline envelope for ${code}.`);
  }
  const feature = data.features[0];
  if (!object(feature) || feature.countryCode !== code ||
      !Array.isArray(feature.bounds) || feature.bounds.length !== 4 ||
      !feature.bounds.every(Number.isFinite) || feature.bounds[0] > feature.bounds[2] ||
      feature.bounds[1] > feature.bounds[3]) {
    throw new Error(`JourneySphere: invalid detailed outline geometry for ${code}.`);
  }
  if (fragment && (data.fragment !== fragment.id ||
      !feature.bounds.every((value, index) => value === fragment.bounds[index]))) {
    throw new Error(`JourneySphere: invalid detailed outline fragment for ${code}.`);
  }
  const d = decodeOutlinePath(feature);
  if (feature.strokeWidths !== undefined &&
      (!Array.isArray(feature.strokeWidths) || feature.strokeWidths.length !== (d.match(/M/g) || []).length ||
        !feature.strokeWidths.every(width => width === null || (Number.isInteger(width) && width >= 0)))) {
    throw new Error(`JourneySphere: invalid detailed outline geometry for ${code}.`);
  }
  // Drop transport arrays after expansion; only keep a validated spatial index.
  const { pathEncoding, paths, parts: ignoredParts, ...record } = feature;
  const parts = fragment ? [fragment.bounds] : manifest.outlines?.countries?.[code]?.parts;
  if (Array.isArray(parts) && parts.length && parts.every(part => Array.isArray(part) && part.length === 4 &&
      part.every(Number.isFinite) && part[0] <= part[2] && part[1] <= part[3])) {
    const bounds = parts.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
      Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    if (bounds.every((value, index) => value === feature.bounds[index])) record.parts = parts.map(part => [...part]);
  }
  return { ...record, d };
}

function projected(value, map) {
  const lat = latLngPart(value, 'lat', 0);
  const lng = latLngPart(value, 'lng', 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (typeof map.project === 'function') {
    const point = map.project({ lat, lng }, 0);
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      return { x: point.x * EXTENT / WORLD, y: point.y * EXTENT / WORLD };
    }
  }
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: ((lng + 180) / 360) * EXTENT,
    y: (0.5 - Math.log((1 + Math.sin(clamped * Math.PI / 180)) /
      (1 - Math.sin(clamped * Math.PI / 180))) / (4 * Math.PI)) * EXTENT,
  };
}

function viewport(map, bufferPixels = 0, zoom = map.getZoom?.()) {
  if (typeof map.getBounds !== 'function') return null;
  const bounds = map.getBounds();
  const sw = typeof bounds?.getSouthWest === 'function' ? bounds.getSouthWest() : { lat: bounds?.getSouth?.(), lng: bounds?.getWest?.() };
  const ne = typeof bounds?.getNorthEast === 'function' ? bounds.getNorthEast() : { lat: bounds?.getNorth?.(), lng: bounds?.getEast?.() };
  const a = projected(sw, map); const b = projected(ne, map);
  if (!a || !b) return null;
  const west = latLngPart(sw, 'lng', 1); const east = latLngPart(ne, 'lng', 1);
  let left = a.x; let right = b.x;
  if (Number.isFinite(west) && Number.isFinite(east) && east < west) right += EXTENT;
  if (right < left) right += EXTENT;
  const margin = Math.max(256, (right - left) * 0.04,
    bufferPixels * EXTENT / (WORLD * 2 ** zoom));
  return { left: left - margin, right: right + margin, top: Math.min(a.y, b.y) - margin, bottom: Math.max(a.y, b.y) + margin };
}

function intersectsBounds(b, view) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return false;
  if (b[3] < view.top || b[1] > view.bottom) return false;
  const first = Math.floor((view.left - b[2]) / EXTENT);
  const last = Math.ceil((view.right - b[0]) / EXTENT);
  for (let shift = first; shift <= last; shift += 1) {
    if (b[2] + shift * EXTENT >= view.left && b[0] + shift * EXTENT <= view.right) return true;
  }
  return false;
}

function intersects(entry, view) {
  return (entry.parts || [entry.bounds]).some(bounds => intersectsBounds(bounds, view));
}

export function createOutlineDetail({ map, manifest, dataUrl = './', signal, onChange, onError } = {}) {
  if (!map || !object(manifest?.outlines) || !object(manifest.outlines.countries)) return inert();
  if (signal?.aborted) return abortedHandle(signal.reason || new Error('outline detail aborted'));
  const config = manifest.outlines;
  const minZoom = Number.isFinite(config.minZoom) ? config.minZoom : 6;
  const detailZoom = Number.isFinite(config.detailZoom) ? config.detailZoom : minZoom;
  const countries = config.countries;
  const cache = new Map();
  const composites = new Map();
  const pending = new Map();
  const queue = [];
  const queued = new Map();
  let active = 0;
  let timer;
  let destroyed = false;
  let latest = Promise.resolve([]);
  let viewCodes = [];
  let view = null;
  let focalKey = null;
  let focalCountry = null;
  let focalBudget = null;
  let focalBlocked = false;
  let focalTimer;
  const listeners = [];
  const dataBase = new URL(String(dataUrl).replace(/\/?$/, '/'), globalThis.location?.href || import.meta.url);
  const base = new URL('compiled/', dataBase);
  const fail = error => {
    if (error?.obsolete || error?.name === 'AbortError') return;
    if (typeof onError === 'function') { try { onError(error); } catch {} }
  };
  const keyFor = (code, zoom) => `${code}:${zoom < detailZoom && countries[code]?.overviewFile &&
    countries[code].overviewFile !== countries[code].file ? 'overview' : 'detail'}`;
  const codeFor = key => key.split(':')[0];
  const fragmentFor = key => countries[codeFor(key)]?.fragments?.find(fragment => key === `${codeFor(key)}:fragment:${fragment.id}`);
  const fileFor = key => {
    const entry = countries[codeFor(key)];
    return fragmentFor(key)?.file || (key.endsWith(':overview') ? entry?.overviewFile : entry?.file);
  };
  const neededFragments = (code, zoom) => {
    const buffered = viewport(map, FRAGMENT_BUFFER_PX, zoom);
    return buffered ? (countries[code]?.fragments || []).filter(fragment => intersectsBounds(fragment.bounds, buffered)) : [];
  };
  function composite(code, zoom) {
    const required = neededFragments(code, zoom);
    if (!required.length || required.some(fragment => !cache.has(`${code}:fragment:${fragment.id}`))) return null;
    // Include previously cached whole polygons as well. New view coverage is
    // checked synchronously, before moveend and the deferred download callback.
    const keys = countries[code].fragments.map(fragment => `${code}:fragment:${fragment.id}`).filter(key => cache.has(key));
    const signature = keys.join('|');
    let assembled = composites.get(code);
    if (!assembled || assembled.signature !== signature) {
      const records = keys.map(key => cache.get(key));
      const bounds = records.reduce((a, record) => [Math.min(a[0], record.bounds[0]), Math.min(a[1], record.bounds[1]),
        Math.max(a[2], record.bounds[2]), Math.max(a[3], record.bounds[3])], [Infinity, Infinity, -Infinity, -Infinity]);
      const record = { ...records[0], d: records.map(record => record.d).join(' '), bounds,
        parts: records.flatMap(record => record.parts || [record.bounds]) };
      if (records.every(record => Array.isArray(record.strokeWidths))) record.strokeWidths = records.flatMap(record => record.strokeWidths);
      else delete record.strokeWidths;
      assembled = { signature, record }; composites.set(code, assembled);
    }
    for (const key of keys) { const record = cache.get(key); cache.delete(key); cache.set(key, record); }
    return assembled.record;
  }

  function visible() {
    if (destroyed || typeof map.getZoom !== 'function' || map.getZoom() < minZoom) return [];
    view = viewport(map);
    if (!view) return [];
    const centerX = (view.left + view.right) / 2;
    const centerY = (view.top + view.bottom) / 2;
    const distance = entry => Math.min(...(entry.parts || [entry.bounds]).map(bounds => {
      const shift = Math.round((centerX - (bounds[0] + bounds[2]) / 2) / EXTENT) * EXTENT;
      const dx = Math.max(bounds[0] + shift - centerX, 0, centerX - bounds[2] - shift);
      const dy = Math.max(bounds[1] - centerY, 0, centerY - bounds[3]);
      return dx * dx + dy * dy;
    }));
    // A tile margin completes an already visible country's geometry. It must
    // not activate an otherwise offscreen country on a narrow mobile view.
    return Object.entries(countries).filter(([, entry]) => intersects(entry, view)).sort((a, b) => {
      const area = e => Array.isArray(e.bounds) && e.bounds.length === 4 && e.bounds.every(Number.isFinite)
        ? Math.max(0, e.bounds[2] - e.bounds[0]) * Math.max(0, e.bounds[3] - e.bounds[1]) : Infinity;
      // Refine the user's focal area before distant islands in a wide view.
      return distance(a[1]) - distance(b[1]) || area(a[1]) - area(b[1]);
    }).flatMap(([code, entry]) => entry.fragments
      ? neededFragments(code, map.getZoom()).map(fragment => `${code}:fragment:${fragment.id}`)
      : cache.has(`${code}:detail`) ? `${code}:detail` : keyFor(code, map.getZoom()));
  }
  function updateVisibility() {
    viewCodes = visible();
    const country = viewCodes.length ? codeFor(viewCodes[0]) : null;
    focalKey = viewCodes.find(key => codeFor(key) === country && !cache.has(key)) || viewCodes[0] || null;
    focalBlocked = focalKey !== null && !cache.has(focalKey);
    if (country !== focalCountry || !focalBlocked) focalBudget = null;
    focalCountry = country;
    if (focalBlocked && !focalBudget) {
      const requests = viewCodes.filter(key => codeFor(key) === country).map(key => pending.get(key)).filter(Boolean);
      focalBudget = { country, startedAt: requests.length ? Math.min(...requests.map(request => request.startedAt)) : null };
    }
    armFocalBudget();
    const wanted = new Set(viewCodes);
    for (const [code, task] of pending) if (!wanted.has(code)) {
      pending.delete(code);
      task.obsolete = true;
      const error = new Error('outline no longer visible'); error.obsolete = true;
      task.settled = true; task.reject(error);
      task.controller.abort(error);
    }
    for (const [code, item] of queued) if (!wanted.has(code)) {
      queued.delete(code); item.obsolete = true;
      const error = new Error('outline no longer visible'); error.obsolete = true;
      item.reject(error);
    }
    trimCache();
    pump();
    return viewCodes;
  }
  function armFocalBudget() {
    clearTimeout(focalTimer); focalTimer = undefined;
    if (!focalBlocked || focalBudget?.startedAt === null || !focalBudget) return;
    const budget = focalBudget;
    const remaining = FOCAL_EXCLUSIVE_MS - (Date.now() - budget.startedAt);
    if (remaining <= 0) { focalBlocked = false; return; }
    focalTimer = setTimeout(() => {
      focalTimer = undefined;
      if (destroyed || focalBudget !== budget || !focalBlocked) return;
      // A slow focal coast keeps downloading while other visible countries
      // can refine. Partial arrivals and repeated loads retain the country's
      // original budget, including fragments that start in a later free slot.
      focalBlocked = false;
      pump();
    }, remaining);
  }
  function trimCache() {
    const visibleCountries = new Set(viewCodes.map(codeFor));
    while (cache.size > MAX_CACHE) {
      const evict = [...cache.keys()].find(key => !visibleCountries.has(codeFor(key)));
      // A wide viewport can contain more than 32 countries. Keep visible
      // outlines until the view changes instead of repeatedly downloading them.
      if (evict === undefined) break;
      cache.delete(evict);
      composites.delete(codeFor(evict));
    }
  }
  function insert(code, record) {
    if (destroyed) return;
    if (cache.has(code)) cache.delete(code);
    cache.set(code, record);
    composites.delete(codeFor(code));
    if (code.endsWith(':detail')) cache.delete(`${codeFor(code)}:overview`);
    trimCache();
  }
  function fetchCode(key) {
    if (destroyed) return Promise.reject(new Error('outline detail destroyed'));
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return Promise.resolve(value); }
    if (pending.has(key)) return pending.get(key).promise;
    const code = codeFor(key);
    const entry = countries[code];
    const file = fileFor(key);
    if (!object(entry) || typeof file !== 'string' || file.length === 0) return Promise.reject(new Error(`Invalid outline manifest entry for ${code}.`));
    const controller = new AbortController();
    const task = { controller, promise: null, done: null, resolve: null, reject: null, settled: false, startedAt: Date.now() };
    task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
    task.done = fetch(new URL(file, base), { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`JourneySphere: ${response.status} loading outline ${code}`);
      return response.json();
    }).then(data => {
      const record = validateRecord(data, code, manifest, fragmentFor(key));
      if (destroyed || controller.signal.aborted) throw controller.signal.reason || new Error('outline detail aborted');
      insert(key, record);
      if (viewCodes.includes(key)) { try { onChange?.(record, code); } catch (error) { fail(error); } }
      return record;
    }).catch(error => { if (task.obsolete) error.obsolete = true; throw error; })
      .then(record => { if (!task.settled) { task.settled = true; task.resolve(record); } return record; }, error => {
        if (!task.settled) { task.settled = true; task.reject(error); }
        throw error;
      }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    task.promise.catch(() => {});
    task.done.catch(() => {});
    pending.set(key, task);
    return task.promise;
  }
  function pump() {
    while (!destroyed && queue.length) {
      if (focalBlocked && cache.has(focalKey)) {
        focalKey = viewCodes.find(key => codeFor(key) === focalCountry && !cache.has(key)) || focalKey;
        if (cache.has(focalKey)) {
          focalBlocked = false; focalBudget = null;
          clearTimeout(focalTimer); focalTimer = undefined;
        }
      }
      // Give the focal country the available download bandwidth, then fill the
      // remaining viewport in parallel. A cached focal coast needs no gate.
      if (active >= MAX_CONCURRENT) break;
      // Newly needed focal fragments take the next free slot ahead of older
      // queued neighbors, even when one cached part or an expired budget exists.
      const priority = queue.findIndex(item => !item.obsolete && codeFor(item.code) === focalCountry && viewCodes.includes(item.code));
      if (focalBlocked && priority < 0) break;
      const index = priority < 0 ? 0 : priority;
      const [item] = queue.splice(index, 1);
      if (queued.get(item.code) === item) queued.delete(item.code);
      if (item.obsolete) continue;
      if (!viewCodes.includes(item.code) || cache.has(item.code)) { item.resolve(cache.get(item.code) || null); continue; }
      active += 1;
      const request = fetchCode(item.code);
      const task = pending.get(item.code);
      if (codeFor(item.code) === focalCountry && focalBudget?.startedAt === null) {
        focalBudget.startedAt = task?.startedAt ?? Date.now();
        armFocalBudget();
      }
      request.then(item.resolve, item.reject);
      let released = false;
      const release = failed => {
        if (released) return;
        released = true;
        active -= 1;
        const countryComplete = !viewCodes.some(key => codeFor(key) === focalCountry && !cache.has(key));
        if (codeFor(item.code) === focalCountry && !task?.obsolete && (failed || countryComplete)) {
          focalBudget = null; focalBlocked = false;
          clearTimeout(focalTimer); focalTimer = undefined;
        }
        pump();
      };
      (task?.done || request).then(() => release(false), () => release(true));
      // Cancellation settles promptly even when an underlying fetch ignores
      // abort. Its late completion cannot hold the next viewport's focal slot.
      request.catch(() => { if (task?.obsolete) release(true); });
    }
  }
  function enqueue(code) {
    if (cache.has(code)) return Promise.resolve(cache.get(code));
    if (pending.has(code)) return pending.get(code).promise;
    if (queued.has(code)) return queued.get(code).promise;
    const item = { code, promise: null, resolve: null, reject: null };
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
    queued.set(code, item); queue.push(item); pump();
    return item.promise;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined; updateVisibility();
      const codes = [...viewCodes];
      const request = Promise.all(codes.map(code => enqueue(code))).then(records => aggregate(codes, records));
      latest = request; request.catch(fail);
    }, MOVE_DEBOUNCE);
  }
  function load() {
    if (destroyed) return Promise.reject(new Error('outline detail destroyed'));
    clearTimeout(timer); timer = undefined;
    updateVisibility();
    const codes = [...viewCodes];
    const request = Promise.all(codes.map(code => enqueue(code))).then(records => aggregate(codes, records));
    latest = request;
    request.catch(() => {});
    return request;
  }
  function aggregate(keys, records) {
    const byCountry = new Map();
    keys.forEach((key, index) => {
      const code = codeFor(key);
      const record = countries[code]?.fragments ? composite(code, map.getZoom()) : records[index];
      if (record) byCountry.set(code, record);
    });
    return [...byCountry.values()];
  }
  const onMove = schedule;
  map.on?.('moveend', onMove); map.on?.('zoomend', onMove);
  listeners.push(['moveend', onMove], ['zoomend', onMove]);
  schedule();
  const abort = () => destroy(signal?.reason || new Error('outline detail aborted'));
  signal?.addEventListener('abort', abort, { once: true });
  function destroy(reason = new Error('outline detail destroyed')) {
    if (destroyed) return;
    destroyed = true; clearTimeout(timer); clearTimeout(focalTimer);
    listeners.forEach(([event, handler]) => map.off?.(event, handler));
    signal?.removeEventListener('abort', abort);
    queue.splice(0).forEach(item => item.reject(reason));
    queued.clear();
    pending.forEach(task => {
      if (!task.settled) { task.settled = true; task.reject(reason); }
      task.controller.abort(reason);
    });
    cache.clear(); pending.clear(); composites.clear();
  }
  return {
    get(code, zoom = map.getZoom?.()) {
      if (zoom < minZoom) return null;
      if (countries[code]?.fragments) return composite(code, zoom);
      // Keep the best cached coastline visible while its next tier downloads.
      // Zooming out can reuse exact detail without an overview request.
      const key = cache.has(`${code}:detail`) ? `${code}:detail` : keyFor(code, zoom);
      const fallback = cache.has(key) ? key : `${code}:overview`;
      if (!cache.has(fallback)) return null;
      const value = cache.get(fallback); cache.delete(fallback); cache.set(fallback, value); return value;
    },
    load, get ready() { return latest; }, destroy,
  };
}
