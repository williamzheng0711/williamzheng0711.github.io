import fs from "node:fs";
import vm from "node:vm";

const dataSource = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const siteSource = fs.readFileSync(new URL("./site.js", import.meta.url), "utf8");

const dataContext = { window: {} };
vm.createContext(dataContext);
vm.runInContext(dataSource, dataContext, { filename: "visited-places.js" });

const { PROVINCE_CODES = {}, VISITED_PLACES = [] } = dataContext.window.TRAVEL_MAP_DATA || {};
const boundaryPlaces = VISITED_PLACES.filter((place) => place.type === "boundary");
const markerPlaces = VISITED_PLACES.filter((place) => place.type === "marker");
const provincePlaces = boundaryPlaces.filter((place) => place.province);
const baseBoundaryPlaces = boundaryPlaces.filter((place) => !place.province);
const expectedDetailCodes = [...new Set(provincePlaces.map((place) => PROVINCE_CODES[place.province]))];

const forbiddenFeatureNames = ["东莞市", "江门市", "三明市", "龙岩市"];
const baseFeatures = [
  ...baseBoundaryPlaces.map((place, index) => mockFeature(place.names[0], 100000 + index)),
  mockFeature("台湾省", 710000),
  mockFeature("浙江省", 330000),
];
const detailByCode = Object.fromEntries(
  expectedDetailCodes.map((code) => {
    const features = provincePlaces
      .filter((place) => PROVINCE_CODES[place.province] === code)
      .map((place, index) => mockFeature(place.names[0], Number(code) + index + 1));

    if (code === "440000") features.push(mockFeature("东莞市", 441900), mockFeature("江门市", 440700));
    if (code === "350000") features.push(mockFeature("三明市", 350400), mockFeature("龙岩市", 350800));

    return [code, { features }];
  })
);

const success = await runMapRuntime();
assertEqualSets(success.requestedDetailCodes, expectedDetailCodes, "province detail fetches");
assertEqualSets(success.highlightedLabels, boundaryPlaces.map((place) => place.label), "highlighted boundary labels");
assertEqualSets(success.markerLabels, markerPlaces.map((place) => place.label), "marker labels");
assertMarkerRendering(success.markerLayers, markerPlaces, "success marker rendering");

for (const name of forbiddenFeatureNames) {
  if (success.highlightedLabels.includes(name)) throw new Error(`Forbidden feature was highlighted: ${name}`);
}

if (!success.summary.includes("Taiwan") || !success.summary.includes("Japan")) {
  throw new Error("Visited summary did not render expected group headings.");
}

const fallback = await runMapRuntime({ failChinaBoundary: true });
assertEqualSets(fallback.markerLabels, markerPlaces.map((place) => place.label), "fallback marker labels");
assertMarkerRendering(fallback.markerLayers, markerPlaces, "fallback marker rendering");

if (fallback.highlightedLabels.length !== 0) {
  throw new Error("Fallback scenario should not highlight administrative boundaries.");
}

if (!fallback.status.includes("City markers remain available")) {
  throw new Error("Fallback status did not explain that city markers remain available.");
}

console.log(
  `Map runtime verification passed: ${success.highlightedLabels.length} highlighted boundaries, ` +
    `${success.markerLabels.length} markers, ${success.requestedDetailCodes.length} province detail requests, ` +
    "marker fallback verified."
);

async function runMapRuntime(options = {}) {
  const runtime = createRuntime(options);
  vm.createContext(runtime.context);
  vm.runInContext(dataSource, runtime.context, { filename: "visited-places.js" });
  vm.runInContext(siteSource, runtime.context, { filename: "site.js" });

  await runtime.fireLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const [visitedLayer, , markerLayer] = runtime.featureGroups;
  return {
    highlightedLabels: flattenLayerLabels(visitedLayer),
    markerLabels: markerLayer.layers.map((layer) => layer.tooltip.text),
    markerLayers: markerLayer.layers,
    requestedDetailCodes: runtime.fetchUrls
      .map((url) => url.match(/bound\/(\d+)_full\.json/)?.[1])
      .filter((code) => code && code !== "100000"),
    status: runtime.status.textContent,
    summary: runtime.summary.innerHTML,
  };
}

function createRuntime(options = {}) {
  const loadHandlers = [];
  const fetchUrls = [];
  const featureGroups = [];
  const status = { textContent: "", className: "" };
  const mapContainer = { innerHTML: "" };
  const summary = { innerHTML: "" };
  const resetButton = {
    listener: null,
    addEventListener(event, listener) {
      if (event === "click") this.listener = listener;
    },
  };
  const map = {
    layers: [],
    fitBoundsCalls: [],
    setView() {
      return this;
    },
    fitBounds(bounds, options) {
      this.fitBoundsCalls.push({ bounds, options });
      return this;
    },
  };

  class MockIntersectionObserver {
    observe() {}
  }

  const L = {
    DomUtil: {
      create(tagName, className) {
        status.tagName = tagName;
        status.className = className;
        return status;
      },
    },
    control() {
      return {
        onAdd: null,
        addTo(targetMap) {
          this.element = this.onAdd(targetMap);
          return this;
        },
      };
    },
    map() {
      return map;
    },
    tileLayer() {
      return {
        addTo(targetMap) {
          targetMap.layers.push(this);
          return this;
        },
      };
    },
    featureGroup(initialLayers = []) {
      const group = createFeatureGroup(initialLayers);
      featureGroups.push(group);
      return group;
    },
    geoJSON(input, options = {}) {
      const features = Array.isArray(input) ? input : input?.features ? input.features : [input];
      const group = createFeatureGroup();

      features.filter(Boolean).forEach((feature) => {
        const layer = createLayer(feature);
        if (options.onEachFeature) options.onEachFeature(feature, layer);
        group.layers.push(layer);
      });

      return group;
    },
    circleMarker(latLng, style) {
      return {
        latLng,
        style,
        tooltip: null,
        bindTooltip(text, options) {
          this.tooltip = { text, options };
          return this;
        },
        addTo(group) {
          group.layers.push(this);
          return this;
        },
      };
    },
    point(x, y) {
      return [x, y];
    },
  };

  const context = {
    console,
    fetch(url) {
      fetchUrls.push(url);
      if (options.failChinaBoundary && url.endsWith("100000_full.json")) {
        return Promise.reject(new Error("mock China boundary failure"));
      }
      if (url.endsWith("100000_full.json")) return Promise.resolve(mockResponse({ features: baseFeatures }));

      const code = url.match(/bound\/(\d+)_full\.json/)?.[1];
      if (code && detailByCode[code]) return Promise.resolve(mockResponse(detailByCode[code]));

      return Promise.resolve(mockResponse({ features: [] }));
    },
    document: {
      querySelector(selector) {
        if (selector === "#china-map") return mapContainer;
        if (selector === "#visited-place-summary") return summary;
        if (selector === "[data-reset-map]") return resetButton;
        if (selector === ".leaflet-map-tip") return status;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    IntersectionObserver: MockIntersectionObserver,
    L,
    window: {
      L,
      addEventListener(event, listener) {
        if (event === "load") loadHandlers.push(listener);
      },
    },
  };

  return {
    context,
    featureGroups,
    fetchUrls,
    status,
    summary,
    async fireLoad() {
      for (const listener of loadHandlers) await listener();
    },
  };
}

function createFeatureGroup(initialLayers = []) {
  return {
    layers: [...initialLayers],
    addTo(target) {
      target.layers.push(this);
      return this;
    },
    clearLayers() {
      this.layers = [];
    },
    getBounds() {
      return {
        isValid: () => this.layers.length > 0,
        pad: () => this,
      };
    },
  };
}

function createLayer(feature) {
  return {
    feature,
    events: {},
    tooltip: null,
    bindTooltip(text) {
      this.tooltip = { text };
      return this;
    },
    on(event, listener) {
      this.events[event] = listener;
      return this;
    },
  };
}

function flattenLayerLabels(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.tooltip?.text) return [layer.tooltip.text];
    if (layer.layers) return flattenLayerLabels(layer);
    return [];
  });
}

function mockFeature(name, adcode) {
  return { type: "Feature", properties: { name, adcode }, geometry: null };
}

function mockResponse(payload) {
  return { json: () => Promise.resolve(payload) };
}

function assertEqualSets(actual, expected, label) {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected)].sort();
  if (actualSorted.join("\n") !== expectedSorted.join("\n")) {
    throw new Error(
      `${label} mismatch\nActual:\n${actualSorted.join("\n")}\nExpected:\n${expectedSorted.join("\n")}`
    );
  }
}

function assertMarkerRendering(markerLayers, expectedPlaces, label) {
  const layerByLabel = new Map(markerLayers.map((layer) => [layer.tooltip?.text, layer]));

  expectedPlaces.forEach((place) => {
    const layer = layerByLabel.get(place.label);
    if (!layer) throw new Error(`${label}: missing marker layer for ${place.label}`);

    const [expectedLng, expectedLat] = place.coordinates;
    const [actualLat, actualLng] = layer.latLng;
    if (actualLng !== expectedLng || actualLat !== expectedLat) {
      throw new Error(
        `${label}: ${place.label} coordinate mismatch, got [${actualLng}, ${actualLat}], ` +
          `expected [${expectedLng}, ${expectedLat}]`
      );
    }

    const expectedOffset = place.labelOffset || [6, -4];
    const actualOffset = layer.tooltip.options.offset;
    if (actualOffset[0] !== expectedOffset[0] || actualOffset[1] !== expectedOffset[1]) {
      throw new Error(
        `${label}: ${place.label} label offset mismatch, got [${actualOffset.join(", ")}], ` +
          `expected [${expectedOffset.join(", ")}]`
      );
    }
  });
}
