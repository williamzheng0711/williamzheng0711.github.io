import test from 'node:test';
import assert from 'node:assert/strict';

import { createJourneySphere } from '../src/index.js';

const REGION_IDS = ['AA:r1', 'AA:r2', 'BB:r1'];

test('ordinary pans reuse the world and detail GeoJSON layers', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const atlas = createAtlas();
    const sphere = await createJourneySphere(createContainer(), {
      atlas,
      leaflet,
      visited: ['AA:r1'],
    });

    assert.equal(leaflet.geoJSONCalls.length, 2);
    leaflet.maps[0].emit('moveend');
    leaflet.maps[0].emit('moveend');
    assert.equal(leaflet.geoJSONCalls.length, 2);

    sphere.destroy();
  });
});

test('loads and displays subdivisions only for visited countries', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const atlas = createAtlas();
    const sphere = await createJourneySphere(createContainer(), {
      atlas,
      leaflet,
      visited: ['AA:r1'],
    });

    assert.deepEqual(atlas.loadCalls, ['AA']);
    assert.equal(detailLayers(leaflet).length, 1);
    assert.equal(detailLayers(leaflet)[0].isAttached(), true);

    await sphere.setVisited(['BB:r1']);

    assert.deepEqual(atlas.loadCalls, ['AA', 'BB']);
    assert.equal(detailLayers(leaflet).length, 2);
    assert.equal(detailLayers(leaflet).find(layer => layer.countryCode === 'AA').isAttached(), false);
    assert.equal(detailLayers(leaflet).find(layer => layer.countryCode === 'BB').isAttached(), true);
    sphere.destroy();
  });
});

test('only visited first-level divisions expose their internal regions, including reset', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const ids = ['AA:r1', 'AA:r2', 'AA:r3'];
    const data = {
      type: 'FeatureCollection',
      features: ids.map((id, i) => feature({ id, countryCode: 'AA', name: id, parentId: i < 2 ? 'west' : 'east' }, i)),
      admin1: { type: 'FeatureCollection', features: ['west', 'east'].map(id => feature({ id, name: id, countryCode: 'AA' })) },
    };
    data.admin1.features[0].geometry.coordinates.push([[0.2, 0.1], [0.3, 0.1], [0.3, 0.2], [0.2, 0.1]]);
    const sphere = await createJourneySphere(createContainer(), {
      leaflet,
      atlas: createAtlas({ catalog: { version: 'parents-1', regionIds: ids, countries: {} }, loadCountry: async () => data }),
      visited: ['AA:r1'],
    });
    const layer = detailLayers(leaflet)[0];
    const style = id => layer.style(layer.features.find(f => f.properties.id === id));
    assert.equal(style('AA:r1').fillOpacity, 0.44);
    assert.ok(style('AA:r2').opacity > 0);
    assert.equal(style('AA:r3').opacity, 0);
    assert.ok(style('east').opacity > 0, 'Unvisited first-level outlines remain visible');
    assert.equal(style('east').fillOpacity, 0);
    assert.equal(layer.features.find(f => f.properties.id === 'west').geometry.coordinates.length, 1, 'Parent outlines omit internal sliver-hole strokes');
    assert.equal(data.admin1.features[0].geometry.coordinates.length, 2, 'Original atlas geometry is preserved');
    const calls = leaflet.geoJSONCalls.length;
    await sphere.setVisited(['AA:r3']);
    assert.equal(style('AA:r1').opacity, 0);
    assert.equal(style('AA:r2').opacity, 0);
    assert.equal(style('AA:r3').fillOpacity, 0.44);
    assert.equal(leaflet.geoJSONCalls.length, calls, 'Changing parent visibility only updates existing styles');
    layer.featureLayers.find(l => l.feature.properties.id === 'east').emit('click');
    assert.deepEqual(sphere.getVisited(), ['AA:r3'], 'First-level outline is not a visit target');
    await sphere.reset();
    assert.ok(style('AA:r2').opacity > 0);
    assert.equal(style('AA:r3').opacity, 0);
    sphere.destroy();
  });
});

test('only visited regions expose hover labels, and labels follow visit toggles', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const sphere = await createJourneySphere(createContainer(), {
      atlas: createAtlas(),
      leaflet,
      visited: ['AA:r1'],
    });
    const layer = detailLayers(leaflet)[0];
    const first = layer.featureLayers.find(item => item.feature.properties.id === 'AA:r1');
    const second = layer.featureLayers.find(item => item.feature.properties.id === 'AA:r2');

    assert.equal(first.tooltipBound, true);
    assert.equal(second.tooltipBound, false);
    second.emit('click');
    await waitFor(() => sphere.getVisited().includes('AA:r2'));
    assert.equal(first.tooltipBound, true);
    assert.equal(second.tooltipBound, true);
    first.emit('click');
    await waitFor(() => sphere.getVisited().length === 1 && sphere.getVisited()[0] === 'AA:r2');
    assert.equal(first.tooltipBound, false);
    assert.equal(second.tooltipBound, true);
    sphere.destroy();
  });
});

test('feature clicks toggle visits and reset restores the initial selection and view', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const changes = [];
    const container = createContainer();
    const sphere = await createJourneySphere(container, {
      atlas: createAtlas(),
      leaflet,
      visited: ['AA:r1'],
      center: [10, 20],
      zoom: 5,
      onChange: change => changes.push(change),
    });

    const aaLayer = detailLayers(leaflet)[0];
    aaLayer.featureLayers.find(layer => layer.feature.properties.id === 'AA:r1').emit('click');
    await waitFor(() => sphere.getVisited().length === 0);
    assert.deepEqual(sphere.getVisited(), []);

    aaLayer.featureLayers.find(layer => layer.feature.properties.id === 'AA:r2').emit('click');
    await waitFor(() => sphere.getVisited()[0] === 'AA:r2');
    assert.deepEqual(sphere.getVisited(), ['AA:r2']);
    assert.equal(changes.length, 2);
    assert.match(changes[1].codeword, /^js1_/);

    await sphere.reset();
    assert.deepEqual(sphere.getVisited(), ['AA:r1']);
    assert.deepEqual(leaflet.maps[0].setViewCalls.at(-1), [[10, 20], 5]);
    sphere.destroy();
  });
});

test('separate instances keep their status elements isolated', async () => {
  await withDom(async () => {
    const leaflet = createLeafletMock();
    const first = await createJourneySphere(createContainer(), {
      atlas: createAtlas(),
      leaflet,
      interactive: false,
    });
    const second = await createJourneySphere(createContainer(), {
      atlas: createAtlas(),
      leaflet,
    });

    assert.equal(leaflet.statusElements.length, 2);
    assert.notEqual(leaflet.statusElements[0], leaflet.statusElements[1]);
    assert.match(leaflet.statusElements[0].textContent, /colored region/i);
    assert.match(leaflet.statusElements[1].textContent, /click to toggle/i);

    first.destroy();
    assert.match(leaflet.statusElements[1].textContent, /click to toggle/i);
    second.destroy();
  });
});

test('a failed country fetch preserves the previously committed selection', async () => {
  await withDom(async () => {
    const atlas = createAtlas({
      loadCountry(code) {
        if (code === 'BB') return Promise.reject(new Error('offline'));
        return Promise.resolve(countryData(code));
      },
    });
    const sphere = await createJourneySphere(createContainer(), {
      atlas,
      leaflet: createLeafletMock(),
      visited: ['AA:r1'],
    });

    await assert.rejects(sphere.setVisited(['BB:r1']), /offline/);
    assert.deepEqual(sphere.getVisited(), ['AA:r1']);
    sphere.destroy();
  });
});

test('the latest asynchronous setVisited request wins', async () => {
  await withDom(async () => {
    const aa = deferred();
    const bb = deferred();
    const atlas = createAtlas({
      loadCountry(code) {
        return code === 'AA' ? aa.promise : bb.promise;
      },
    });
    const changes = [];
    const sphere = await createJourneySphere(createContainer(), {
      atlas,
      leaflet: createLeafletMock(),
      onChange: change => changes.push(change.visited),
    });

    const older = sphere.setVisited(['AA:r1']);
    const newer = sphere.setVisited(['BB:r1']);
    bb.resolve(countryData('BB'));
    await newer;
    assert.deepEqual(sphere.getVisited(), ['BB:r1']);

    aa.resolve(countryData('AA'));
    await older;
    assert.deepEqual(sphere.getVisited(), ['BB:r1']);
    assert.deepEqual(changes, [['BB:r1']]);
    sphere.destroy();
  });
});

test('destroy disconnects observers, removes the map and blocks further updates', async () => {
  await withDom(async ({ observers }) => {
    const leaflet = createLeafletMock();
    const container = createContainer();
    const sphere = await createJourneySphere(container, {
      atlas: createAtlas(),
      leaflet,
    });

    sphere.destroy();
    sphere.destroy();

    assert.equal(observers.length, 1);
    assert.equal(observers[0].disconnectCalls, 1);
    assert.equal(leaflet.maps[0].removeCalls, 1);
    assert.equal(container.classList.contains('journeysphere'), false);
    await assert.rejects(sphere.setVisited(['AA:r1']), /destroyed/i);
  });
});

test('destroy aborts an in-flight country request without reporting a teardown error', async () => {
  await withDom(async () => {
    let requestSignal;
    const errors = [];
    const atlas = createAtlas({
      loadCountry(_code, { signal }) {
        requestSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      },
    });
    const leaflet = createLeafletMock();
    const sphere = await createJourneySphere(createContainer(), {
      atlas,
      leaflet,
      onError: error => errors.push(error),
    });

    const update = sphere.setVisited(['BB:r1']);
    await waitFor(() => requestSignal !== undefined);
    const statusBeforeDestroy = leaflet.statusElements[0].textContent;
    sphere.destroy();

    assert.equal(requestSignal.aborted, true);
    await assert.rejects(update, { name: 'AbortError' });
    assert.deepEqual(errors, []);
    assert.equal(leaflet.statusElements[0].textContent, statusBeforeDestroy);
  });
});

test('a requested map minZoom is preserved initially and after resize', async () => {
  await withDom(async ({ observers }) => {
    const leaflet = createLeafletMock();
    const container = createContainer();
    const sphere = await createJourneySphere(container, {
      atlas: createAtlas(),
      leaflet,
      mapOptions: { minZoom: 6 },
    });

    assert.equal(leaflet.maps[0].options.minZoom, 6);
    container.clientWidth = 1200;
    container.clientHeight = 900;
    observers[0].callback();
    assert.deepEqual(leaflet.maps[0].setMinZoomCalls, [6]);
    sphere.destroy();
  });
});

function createAtlas(overrides = {}) {
  const loadCalls = [];
  const atlas = {
    world: {
      type: 'FeatureCollection',
      features: ['AA', 'BB', 'CC'].map(countryFeature),
    },
    catalog: {
      version: 'test-1',
      regionIds: REGION_IDS,
      countries: {},
    },
    palette: {
      AA: { color: '#112233' },
      BB: { color: '#445566' },
    },
    loadCalls,
    loadCountry(code) {
      return Promise.resolve(countryData(code));
    },
    ...overrides,
  };
  const implementation = atlas.loadCountry.bind(atlas);
  atlas.loadCountry = (code, options) => {
    loadCalls.push(code);
    return implementation(code, options);
  };
  return atlas;
}

function countryFeature(code) {
  return feature({ countryCode: code, name: code }, Number(code.charCodeAt(0)));
}

function countryData(code) {
  const ids = REGION_IDS.filter(id => id.startsWith(`${code}:`));
  return {
    type: 'FeatureCollection',
    features: ids.map((id, index) => feature({ id, countryCode: code, name: id }, index)),
  };
}

function feature(properties, offset = 0) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[offset, 0], [offset + 1, 0], [offset + 1, 1], [offset, 0]]],
    },
  };
}

function createContainer() {
  const classes = new Set();
  return {
    clientWidth: 800,
    clientHeight: 500,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    },
  };
}

function createLeafletMock() {
  const mock = {
    maps: [],
    geoJSONCalls: [],
    statusElements: [],
  };

  mock.map = (container, options) => {
    const handlers = new Map();
    const layers = new Set();
    const map = {
      container,
      options,
      layers,
      setViewCalls: [],
      setMinZoomCalls: [],
      removeCalls: 0,
      attributionControl: { addAttribution() {} },
      dragging: { moving: () => false },
      setView(center, zoom) {
        this.center = { lat: center[0], lng: center[1] };
        this.setViewCalls.push([center, zoom]);
        return this;
      },
      addLayer(layer) { layers.add(layer); },
      removeLayer(layer) { layers.delete(layer); },
      hasLayer(layer) { return layers.has(layer); },
      on(event, handler) { handlers.set(event, handler); return this; },
      emit(event) { handlers.get(event)?.(); },
      getCenter() { return this.center; },
      getPixelWorldBounds() { return { min: { y: 0 }, max: { y: 1024 } }; },
      getSize() { return { x: container.clientWidth, y: container.clientHeight }; },
      project(position) { return { x: position.lng, y: 512 }; },
      unproject(point) { return { lat: point[1], lng: point[0] }; },
      panTo() {},
      invalidateSize() {},
      setMinZoom(value) { this.setMinZoomCalls.push(value); },
      remove() { this.removeCalls += 1; layers.clear(); },
    };
    mock.maps.push(map);
    return map;
  };

  mock.canvas = options => ({ options });
  mock.geoJSON = (features, options) => {
    const featureLayers = features.map(featureItem => {
      const handlers = new Map();
      const featureLayer = {
        feature: featureItem,
        tooltipBound: false,
        bindTooltip() { this.tooltipBound = true; return this; },
        unbindTooltip() { this.tooltipBound = false; return this; },
        on(event, handler) { handlers.set(event, handler); return this; },
        emit(event) { handlers.get(event)?.(); },
      };
      options.onEachFeature?.(featureItem, featureLayer);
      return featureLayer;
    });
    let attachedMap = null;
    const layer = {
      features,
      options,
      featureLayers,
      countryCode: features[0]?.properties.countryCode,
      addTo(map) { attachedMap = map; map.addLayer(this); return this; },
      remove() { attachedMap?.removeLayer(this); attachedMap = null; return this; },
      setStyle(style) { this.style = style; return this; },
      isAttached() { return attachedMap !== null; },
    };
    mock.geoJSONCalls.push(layer);
    return layer;
  };

  mock.control = () => ({
    addTo(map) {
      const element = this.onAdd(map);
      mock.statusElements.push(element);
      return this;
    },
  });
  mock.DomUtil = { create: () => createElement() };
  mock.DomEvent = { disableClickPropagation() {} };
  return mock;
}

function detailLayers(leaflet) {
  return leaflet.geoJSONCalls.slice(1);
}

function createElement() {
  return {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

async function withDom(run) {
  const previousDocument = globalThis.document;
  const previousResizeObserver = globalThis.ResizeObserver;
  const observers = [];

  globalThis.document = {
    createElement,
    querySelector: () => null,
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.disconnectCalls = 0;
      observers.push(this);
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnectCalls += 1; }
  };

  try {
    await run({ observers });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousResizeObserver;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for asynchronous state update.');
}
