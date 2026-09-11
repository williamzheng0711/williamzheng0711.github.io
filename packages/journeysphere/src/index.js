import { featuresNearLongitudeCopies } from './geometry.js';
import { encodeVisited, decodeVisited, validateVisited } from './state.js';
export { encodeVisited, decodeVisited, validateVisited } from './state.js';

const DEFAULT_DATA_URL = new URL('../data/', import.meta.url);
const EMPTY = { type: 'FeatureCollection', features: [] };

// Context outlines show the division's exterior, not sliver holes left between
// independently simplified child regions. Visited geometry keeps all holes.
function exteriorGeometry(geometry) {
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: geometry.coordinates.slice(0, 1) };
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map(polygon => polygon.slice(0, 1)) };
  return geometry;
}

async function readJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`JourneySphere: ${response.status} loading ${url}`);
  return response.json();
}

/** Load a self-hosted atlas. Geometry is fetched only for selected countries. */
export async function loadAtlas(dataUrl = DEFAULT_DATA_URL, { signal } = {}) {
  const base = new URL(String(dataUrl).replace(/\/?$/, '/'), globalThis.location?.href || import.meta.url);
  const [world, catalog, palette] = await Promise.all([
    readJSON(new URL('world.geojson', base), signal),
    readJSON(new URL('catalog.json', base), signal),
    readJSON(new URL('palette.json', base), signal),
  ]);
  return { world, catalog, palette, loadCountry: (code, { signal: countrySignal } = {}) => {
    const entry = catalog.countries[code];
    if (!entry?.file) return Promise.resolve(EMPTY);
    return readJSON(new URL(entry.file, base), countrySignal || signal);
  }};
}

/** Create a map using Leaflet 1.9.4 supplied by the host. No remote tiles. */
export async function createJourneySphere(container, options = {}) {
  const L = options.leaflet || globalThis.L;
  if (!L?.map || !L?.geoJSON) throw new TypeError('JourneySphere requires Leaflet 1.9.4.');
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) throw new TypeError('JourneySphere requires a map container.');
  const atlas = options.atlas || await loadAtlas(options.dataUrl);
  const { world, catalog, palette } = atlas;
  const stateCatalog = { version: catalog.version, regionIds: catalog.regionIds };
  const initial = options.codeword ? decodeVisited(options.codeword, stateCatalog) : (options.visited || []);
  validateVisited(initial, stateCatalog);
  let visited = new Set(initial);
  const original = [...visited];
  const center = options.center || [31.5, 121.8];
  const zoom = options.zoom ?? 4;
  const opacity = options.fillOpacity ?? 0.44;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('fillOpacity must be between 0 and 1.');
  const minimumZoom = () => Math.max(2, options.mapOptions?.minZoom ?? 2, Math.ceil(Math.log2(Math.max(container.clientWidth, container.clientHeight) * 1.2 / 256) * 2) / 2);
  container.classList.add('journeysphere');
  const map = L.map(container, {
    preferCanvas: true, worldCopyJump: true, inertia: true,
    inertiaDeceleration: 2400, inertiaMaxSpeed: 1200,
    zoomDelta: 0.5, zoomSnap: 0.5, wheelPxPerZoomLevel: 120,
    maxZoom: options.maxZoom ?? 12,
    ...options.mapOptions,
    minZoom: minimumZoom(),
  }).setView(center, zoom);
  map.attributionControl?.addAttribution('JourneySphere | <a href="https://www.naturalearthdata.com/">Natural Earth</a> | <a href="https://www.geoboundaries.org/">geoBoundaries</a>');
  const baseRenderer = L.canvas({ padding: 0.5 });
  const detailRenderer = L.canvas({ padding: 0.5 });
  let destroyed = false;
  let revision = 0;
  let selectionRequest = 0;
  const requests = new AbortController();
  const loaded = new Map();
  const pending = new Map();
  const parentByRegion = new Map();
  let activeParents = new Set();
  const parentKey = (properties) => `${properties.countryCode}:${properties.parentId || properties.id}`;
  const activeCountries = () => new Set([...visited].map(id => id.split(':')[0]));
  let active = activeCountries();
  const colorFor = (code) => options.colors?.[code] || palette[code]?.color || palette.countries?.[code]?.color || '#64748b';
  const countryStyle = (feature) => ({
    color: active.has(feature.properties.countryCode) ? '#8795a6' : '#c1cbd5',
    weight: active.has(feature.properties.countryCode) ? 0.8 : 0.45,
    fillColor: '#f8fafc', fillOpacity: 0.84,
  });
  const regionStyle = (feature) => {
    if (feature.properties.__journeysphereAdmin1) {
      const parentVisited = activeParents.has(parentKey(feature.properties));
      return { color: '#8795a6', weight: parentVisited ? 0.8 : 0.55,
        opacity: parentVisited ? 0.75 : 0.4, fillOpacity: 0 };
    }
    const selected = visited.has(feature.properties.id);
    const parentVisited = activeParents.has(parentKey(feature.properties));
    return {
      color: selected ? colorFor(feature.properties.countryCode) : '#9aa8b7',
      weight: selected ? 1.05 : parentVisited ? 0.55 : 0,
      opacity: selected ? 0.88 : parentVisited ? 0.65 : 0,
      fillColor: selected ? colorFor(feature.properties.countryCode) : '#f8fafc',
      fillOpacity: selected ? opacity : 0,
    };
  };
  const worldLayer = L.geoJSON(featuresNearLongitudeCopies(world.features, 0), {
    renderer: baseRenderer, style: countryStyle, interactive: false,
  }).addTo(map);
  const status = L.control({ position: 'bottomleft' });
  let statusElement;
  status.onAdd = () => {
    statusElement = L.DomUtil.create('div', 'journeysphere-status');
    statusElement.setAttribute('role', 'status');
    L.DomEvent.disableClickPropagation(statusElement);
    return statusElement;
  };
  status.addTo(map);
  const setStatus = (text) => { if (!destroyed) statusElement.textContent = text; };
  const emitError = (error) => {
    if (destroyed || error.name === 'AbortError') return;
    setStatus(`Map data unavailable: ${error.message}`);
    options.onError?.(error);
  };
  async function countryLayer(code) {
    if (loaded.has(code)) return loaded.get(code);
    if (pending.has(code)) return pending.get(code);
    const request = (async () => {
      const data = await atlas.loadCountry(code, { signal: requests.signal });
      if (destroyed) return null;
      for (const feature of data.features) {
        parentByRegion.set(feature.properties.id, parentKey(feature.properties));
      }
      const outlines = (data.admin1?.features || []).map(feature => ({
        ...feature, geometry: exteriorGeometry(feature.geometry),
        properties: { ...feature.properties, __journeysphereAdmin1: true },
      }));
      const tooltipSyncs = [];
      const layer = L.geoJSON(featuresNearLongitudeCopies([...outlines, ...data.features], 0), {
        renderer: detailRenderer, style: regionStyle,
        onEachFeature(feature, layer) {
          if (feature.properties.__journeysphereAdmin1) {
            layer.options = { ...layer.options, interactive: false };
            return;
          }
          const label = document.createElement('span');
          label.textContent = options.labels?.[feature.properties.id] || feature.properties.name;
          let tooltipBound = false;
          const syncTooltip = () => {
            const shouldShow = visited.has(feature.properties.id);
            if (shouldShow && !tooltipBound) {
              layer.bindTooltip(label, { sticky: true });
              tooltipBound = true;
            } else if (!shouldShow && tooltipBound) {
              layer.unbindTooltip?.();
              tooltipBound = false;
            }
          };
          tooltipSyncs.push(syncTooltip);
          syncTooltip();
          if (options.interactive !== false) layer.on('click', () => {
            const next = new Set(visited);
            if (next.has(feature.properties.id)) next.delete(feature.properties.id);
            else next.add(feature.properties.id);
            setVisited([...next]).catch(emitError);
          });
        },
      });
      layer.syncTooltips = () => tooltipSyncs.forEach(syncTooltip => syncTooltip());
      loaded.set(code, layer);
      return layer;
    })();
    pending.set(code, request);
    try { return await request; } finally { pending.delete(code); }
  }
  async function render() {
    const current = ++revision;
    const countries = [...active];
    setStatus('Loading map boundaries…');
    await Promise.all(countries.map(countryLayer));
    if (destroyed || current !== revision) return;
    activeParents = new Set([...visited].map(id => parentByRegion.get(id)).filter(Boolean));
    worldLayer.setStyle(countryStyle);
    for (const [code, layer] of loaded) {
      if (!active.has(code)) { layer.remove(); continue; }
      layer.setStyle(regionStyle);
      layer.syncTooltips?.();
      if (!map.hasLayer(layer)) layer.addTo(map);
    }
    setStatus(options.interactive === false ? 'Move over a visited colored region to see its name.' : 'Move over a visited region to see its name. Click to toggle your visit.');
  }
  async function setVisited(ids) {
    if (destroyed) throw new Error('JourneySphere has been destroyed.');
    validateVisited(ids, stateCatalog);
    const next = [...ids];
    const request = ++selectionRequest;
    // Fetch prerequisites before committing so a failed fetch preserves the current state.
    await Promise.all([...new Set(next.map(id => id.split(':')[0]))].map(countryLayer));
    if (destroyed || request !== selectionRequest) return;
    visited = new Set(next);
    active = activeCountries();
    await render();
    if (!destroyed && request === selectionRequest) options.onChange?.({ visited: [...visited], codeword: encodeVisited([...visited], stateCatalog) });
  }
  const resize = () => { if (!destroyed) { map.invalidateSize({ pan: false }); map.setMinZoom(minimumZoom()); } };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  // Clamp the viewport to Mercator land latitudes; horizontal wrapping remains unlimited.
  let clamping = false;
  const clampLatitude = () => {
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
  };
  map.on('moveend', clampLatitude);
  function destroy() {
    if (destroyed) return;
    destroyed = true; revision++;
    requests.abort();
    resizeObserver?.disconnect();
    map.remove(); loaded.clear(); pending.clear(); parentByRegion.clear(); activeParents.clear();
    container.classList.remove('journeysphere');
  }
  try { await render(); } catch (error) { destroy(); throw error; }
  return {
    map, catalog,
    getVisited: () => [...visited],
    getCodeword: () => encodeVisited([...visited], stateCatalog),
    setVisited,
    setCodeword: (word) => setVisited(decodeVisited(word, stateCatalog)),
    reset: async () => { await setVisited(original); if (!destroyed) map.setView(center, zoom); },
    destroy,
  };
}
