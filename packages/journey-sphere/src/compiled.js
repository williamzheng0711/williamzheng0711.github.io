import bundledManifest from '../data/compiled/manifest.js';
import { describeCatalog, encodeVisitedIndices, decodeVisitedIndices } from './state.js';
import { createCompiledLayer } from './compiled-layer.js';

const DEFAULT_DATA_URL = new URL('../data/', import.meta.url);

function validateManifest(manifest) {
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(manifest) || manifest.format !== 1 || manifest.extent !== 2 ** 24 || !isObject(manifest.countries) ||
      typeof manifest.version !== 'string' || manifest.version.length === 0 || !Number.isInteger(manifest.regionCount) ||
      manifest.regionCount < 0 || manifest.regionCount > 0xffffffff ||
      typeof manifest.worldFile !== 'string' || manifest.worldFile.length === 0 ||
      typeof manifest.catalogFile !== 'string' || manifest.catalogFile.length === 0 ||
      !Array.isArray(manifest.fingerprint) || manifest.fingerprint.length !== 2 ||
      manifest.fingerprint.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new Error('JourneySphere: unsupported compiled atlas.');
  }
  let end = 0;
  for (const [code, entry] of Object.entries(manifest.countries)) {
    if (!/^[A-Z]{3}$/.test(code) || !isObject(entry) || !Number.isInteger(entry.start) ||
        !Number.isInteger(entry.count) || entry.start < 0 || entry.count < 0 ||
        entry.start > manifest.regionCount || entry.count > manifest.regionCount - entry.start ||
        (entry.count > 0 && (entry.start !== end || typeof entry.file !== 'string' || entry.file.length === 0))) {
      throw new Error('JourneySphere: invalid compiled country ranges.');
    }
    end += entry.count;
  }
  if (end !== manifest.regionCount) throw new Error('JourneySphere: incomplete compiled atlas.');
}

function validatePayload(data, manifest) {
  if (data.format !== manifest.format || data.version !== manifest.version || data.extent !== manifest.extent ||
      !Array.isArray(data.fingerprint) || data.fingerprint.length !== 2 ||
      data.fingerprint.some((value, index) => value !== manifest.fingerprint[index]) || !Array.isArray(data.features)) {
    throw new Error('JourneySphere: compiled atlas files do not match; deploy the data and manifest together.');
  }
  for (const feature of [...data.features, ...(data.admin1 || [])]) {
    if (typeof feature.d !== 'string' || !feature.d.startsWith('M') ||
        !Array.isArray(feature.bounds) || feature.bounds.length !== 4 || !feature.bounds.every(Number.isFinite) ||
        feature.bounds[0] > feature.bounds[2] || feature.bounds[1] > feature.bounds[3]) {
      throw new Error('JourneySphere: invalid compiled geometry.');
    }
  }
  return data;
}

function parseCountry(data, code, manifest, allowSubset = false) {
  const entry = manifest.countries[code];
  validatePayload(data, manifest);
  const byId = new Map();
  const byIndex = new Map();
  for (const feature of data.features) {
    if (typeof feature.id !== 'string' || !feature.id.startsWith(`${code}:`) || feature.countryCode !== code ||
        !Number.isInteger(feature.index) || feature.index < entry.start || feature.index >= entry.start + entry.count ||
        byId.has(feature.id) || byIndex.has(feature.index)) {
      throw new Error(`JourneySphere: invalid compiled region index for ${code}.`);
    }
    byId.set(feature.id, feature);
    byIndex.set(feature.index, feature);
  }
  if (!allowSubset && byId.size !== entry.count) throw new Error(`JourneySphere: incomplete compiled country ${code}.`);
  return { ...data, byId, byIndex };
}

/** Start world and selected-country downloads together, without the full catalog. */
export function loadCompiledAtlas(dataUrl = DEFAULT_DATA_URL, { signal, manifest = bundledManifest } = {}) {
  validateManifest(manifest);
  const dataBase = new URL(String(dataUrl).replace(/\/?$/, '/'), globalThis.location?.href || import.meta.url);
  const base = new URL('compiled/', dataBase);
  const loaded = new Map();
  const pending = new Map();
  let catalogRequest;
  let generation = 0;
  async function read(file) {
    const url = new URL(file, base);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`JourneySphere: ${response.status} loading ${url}`);
    const data = await response.json();
    if (signal?.aborted) throw signal.reason;
    return data;
  }
  const world = read(manifest.worldFile).then(data => validatePayload(data, manifest));
  // Callers may validate selection before awaiting world; still expose its failure.
  world.catch(() => {});
  async function loadCountry(code) {
    if (signal?.aborted) throw signal.reason;
    if (loaded.has(code)) return loaded.get(code);
    if (pending.has(code)) return pending.get(code).promise;
    const entry = manifest.countries[code];
    if (!entry?.file) throw new RangeError(`Unknown selectable country: ${code}`);
    const requestGeneration = generation;
    const request = read(entry.file).then(data => {
      const country = parseCountry(data, code, manifest);
      if (requestGeneration === generation) loaded.set(code, country);
      return country;
    });
    const record = { promise: request, generation: requestGeneration };
    pending.set(code, record);
    try { return await request; } finally { if (pending.get(code) === record) pending.delete(code); }
  }
  return {
    manifest, world, loaded, loadCountry,
    loadCatalog() {
      if (!catalogRequest) {
        let request;
        request = read(manifest.catalogFile).then(catalog => {
          const descriptor = describeCatalog(catalog);
          if (descriptor.version !== manifest.version || descriptor.regionCount !== manifest.regionCount ||
              descriptor.fingerprint.some((value, index) => value !== manifest.fingerprint[index])) {
            throw new Error('JourneySphere: catalog does not match the compiled atlas.');
          }
          return catalog;
        }).catch(error => { if (catalogRequest === request) catalogRequest = undefined; throw error; });
        catalogRequest = request;
      }
      return catalogRequest;
    },
    clear() { generation++; loaded.clear(); pending.clear(); catalogRequest = undefined; },
  };
}

function countryCodes(ids, manifest) {
  if (!Array.isArray(ids)) throw new TypeError('Visited region IDs must be an array.');
  const unique = new Set();
  const codes = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || !id) throw new TypeError('Every visited region ID must be a non-empty string.');
    if (unique.has(id)) throw new RangeError(`Duplicate visited region ID: ${id}`);
    const code = id.split(':')[0];
    if (!manifest.countries[code]?.file) throw new RangeError(`Unknown region ID: ${id}`);
    unique.add(id);
    codes.add(code);
  }
  return [...codes];
}

function codesForIndices(indices, manifest) {
  const codes = [];
  let position = 0;
  for (const [code, entry] of Object.entries(manifest.countries)) {
    if (position < indices.length && indices[position] >= entry.start && indices[position] < entry.start + entry.count) {
      codes.push(code);
      while (position < indices.length && indices[position] < entry.start + entry.count) position++;
    }
  }
  return codes;
}

/** Fully interactive renderer using precompiled paths and the same js1 visit bits. */
export async function createCompiledJourneySphere(container, options = {}) {
  const L = options.leaflet || globalThis.L;
  if (!L?.map || !L?.GridLayer || typeof Path2D !== 'function') {
    throw new TypeError('JourneySphere compiled maps require Leaflet 1.9.4 and Canvas Path2D.');
  }
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) throw new TypeError('JourneySphere requires a map container.');
  const opacity = options.fillOpacity ?? 0.44;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('fillOpacity must be between 0 and 1.');
  if (options.mapOptions?.crs && options.mapOptions.crs !== L.CRS?.EPSG3857) {
    throw new TypeError('JourneySphere compiled maps require Leaflet CRS.EPSG3857.');
  }
  if (options.signal?.aborted) throw options.signal.reason;
  const manifest = options.manifest || bundledManifest;
  validateManifest(manifest);
  const initialIndices = options.codeword ? decodeVisitedIndices(options.codeword, manifest) : null;
  const initialInput = options.visited || [];
  const initialCodes = initialIndices ? codesForIndices(initialIndices, manifest) : countryCodes(initialInput, manifest);
  const initialIds = initialIndices ? null : [...initialInput];
  const bootstrap = new Map();
  if (options.initialCountries !== undefined) {
    if (options.initialCountries === null || typeof options.initialCountries !== 'object' || Array.isArray(options.initialCountries)) {
      throw new TypeError('initialCountries must be an object keyed by country code.');
    }
    for (const [code, data] of Object.entries(options.initialCountries)) {
      if (!manifest.countries[code]?.file) throw new RangeError(`Unknown initial country: ${code}`);
      bootstrap.set(code, parseCountry(data, code, manifest, true));
    }
  }
  const requests = new AbortController();
  let map;
  let layer;
  let atlas;
  let resizeObserver;
  let destroyed = false;
  let selectionRequest = 0;
  let detailsReady = Promise.resolve();
  const abort = () => { requests.abort(options.signal.reason); destroy(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    selectionRequest++;
    requests.abort();
    options.signal?.removeEventListener('abort', abort);
    resizeObserver?.disconnect();
    map?.remove();
    layer = null;
    atlas?.clear();
    container.classList.remove('journeysphere');
  }
  try {
    atlas = loadCompiledAtlas(options.dataUrl, { signal: requests.signal, manifest });
    const bootstrapReady = code => {
      const country = bootstrap.get(code);
      if (!country) return false;
      if (initialIndices) {
        const entry = manifest.countries[code];
        return initialIndices.every(index => index < entry.start || index >= entry.start + entry.count || country.byIndex.has(index));
      }
      return initialIds.every(id => id.split(':')[0] !== code || country.byId.has(id));
    };
    const startupCountries = initialCodes.filter(code => !bootstrapReady(code));
    const [world] = await Promise.all([atlas.world, ...startupCountries.map(atlas.loadCountry)]);
    if (destroyed) throw requests.signal.reason;
    const countryFor = code => atlas.loaded.get(code) || bootstrap.get(code);
    const recordFor = id => countryFor(id.split(':')[0])?.byId.get(id);
    function validateIds(ids) {
      return ids.map(id => {
        const record = recordFor(id);
        if (!record) throw new RangeError(`Unknown region ID: ${id}`);
        return record.index;
      });
    }
    const idsForIndices = indices => {
      const records = new Map([...bootstrap.values(), ...atlas.loaded.values()].flatMap(country => [...country.byIndex]));
      return indices.map(index => {
        const record = records.get(index);
        if (!record) throw new RangeError(`Unknown compiled region index: ${index}`);
        return record.id;
      });
    };
    let visited = new Set(initialIndices ? idsForIndices(initialIndices) : initialIds);
    let indices = validateIds([...visited]);
    const original = [...visited];
    let active = new Set([...visited].map(id => id.split(':')[0]));
    const center = options.center || [31.5, 121.8];
    const zoom = options.zoom ?? 4;
    const minimumZoom = () => Math.max(2, options.mapOptions?.minZoom ?? 2,
      Math.ceil(Math.log2(Math.max(container.clientWidth, container.clientHeight) * 1.2 / 256) * 2) / 2);
    container.classList.add('journeysphere');
    map = L.map(container, {
      worldCopyJump: true, fadeAnimation: false, inertia: true, inertiaDeceleration: 2400, inertiaMaxSpeed: 1200,
      zoomDelta: 0.5, zoomSnap: 0.5, wheelPxPerZoomLevel: 120,
      maxZoom: options.maxZoom ?? 12, ...options.mapOptions, minZoom: minimumZoom(),
    }).setView(center, zoom);
    map.attributionControl?.addAttribution('JourneySphere | <a href="https://www.naturalearthdata.com/">Natural Earth</a> | <a href="https://www.geoboundaries.org/">geoBoundaries</a>');
    const status = L.control({ position: 'bottomleft' });
    let statusElement;
    const readyText = options.interactive === false
      ? 'Move over a visited colored region to see its name.'
      : 'Move over a visited region to see its name. Click to toggle your visit.';
    status.onAdd = () => {
      statusElement = L.DomUtil.create('div', 'journeysphere-status');
      statusElement.setAttribute('role', 'status');
      statusElement.textContent = readyText;
      L.DomEvent.disableClickPropagation(statusElement);
      return statusElement;
    };
    status.addTo(map);
    const emitError = error => {
      if (destroyed || error?.name === 'AbortError') return;
      statusElement.textContent = `Map data unavailable: ${error.message}`;
      options.onError?.(error);
    };
    const getCodeword = () => encodeVisitedIndices(indices, manifest);
    async function update(selection, fromCodeword = false) {
      if (destroyed) throw new Error('JourneySphere has been destroyed.');
      const values = fromCodeword ? decodeVisitedIndices(selection, manifest) : selection;
      const codes = fromCodeword ? codesForIndices(values, manifest) : countryCodes(values, manifest);
      const snapshot = [...values];
      const request = ++selectionRequest;
      const needsFullCountry = code => {
        const country = bootstrap.get(code);
        if (!country) return true;
        const entry = manifest.countries[code];
        return snapshot.some(value => fromCodeword
          ? value >= entry.start && value < entry.start + entry.count && !country.byIndex.has(value)
          : value.split(':')[0] === code && !country.byId.has(value));
      };
      await Promise.all(codes.filter(needsFullCountry).map(atlas.loadCountry));
      const next = fromCodeword ? idsForIndices(snapshot) : snapshot;
      const nextIndices = validateIds(next);
      if (destroyed || request !== selectionRequest) return;
      visited = new Set(next);
      indices = nextIndices;
      active = new Set(codes);
      layer.refresh();
      statusElement.textContent = readyText;
      options.onChange?.({ visited: [...visited], codeword: getCodeword() });
    }
    layer = createCompiledLayer(L, {
      world, extent: manifest.extent,
      getCountries: () => [...active].map(countryFor).filter(Boolean),
      getVisited: () => visited,
      colorFor: code => options.colors?.[code] || manifest.countries[code]?.color || '#64748b',
      fillOpacity: opacity, labels: options.labels || {}, interactive: options.interactive !== false,
      onToggle(id) {
        const next = new Set(visited);
        if (next.has(id)) next.delete(id); else next.add(id);
        update([...next]).catch(emitError);
      },
      onError: emitError,
    }).addTo(map);
    const resize = () => { if (!destroyed) { map.invalidateSize({ pan: false }); map.setMinZoom(minimumZoom()); } };
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(container);
    const loadInitialDetails = async () => {
      if (destroyed) return;
      const results = await Promise.allSettled(initialCodes.map(async code => {
        const country = await atlas.loadCountry(code);
        if (!destroyed && country && layer) layer.refresh();
        return country;
      }));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      for (const error of errors) emitError(error);
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'JourneySphere country details failed.');
    };
    const nextFrame = () => new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
    detailsReady = (async () => {
      await nextFrame();
      if (destroyed) return;
      await nextFrame();
      if (destroyed) return;
      await loadInitialDetails();
    })();
    detailsReady.catch(() => {});
    let clamping = false;
    map.on('moveend', () => {
      if (clamping || destroyed || map.dragging?.moving()) return;
      const pos = map.getCenter();
      const bounds = map.getPixelWorldBounds();
      const half = map.getSize().y / 2;
      const point = map.project(pos);
      const y = Math.max(bounds.min.y + half, Math.min(bounds.max.y - half, point.y));
      if (Math.abs(y - point.y) < 0.5) return;
      clamping = true;
      map.panTo(map.unproject([point.x, y]), { animate: false });
      clamping = false;
    });
    return {
      map, getVisited: () => [...visited], getCodeword,
      setVisited: ids => update(ids), setCodeword: word => update(word, true),
      reset: async () => { await update(original); if (!destroyed) map.setView(center, zoom); },
      loadCatalog: () => { if (destroyed) throw new Error('JourneySphere has been destroyed.'); return atlas.loadCatalog(); },
      detailsReady,
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
