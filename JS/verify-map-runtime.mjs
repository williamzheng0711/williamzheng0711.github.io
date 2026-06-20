import fs from "node:fs";
import vm from "node:vm";

const dataSource = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const siteSource = fs.readFileSync(new URL("./site.js", import.meta.url), "utf8");
const localBoundaries = JSON.parse(fs.readFileSync(new URL("../data/visited-boundaries.geojson", import.meta.url), "utf8"));

const dataContext = { window: {} };
vm.createContext(dataContext);
vm.runInContext(dataSource, dataContext, { filename: "visited-places.js" });

const { PROVINCE_CODES = {}, VISITED_PLACES = [] } = dataContext.window.TRAVEL_MAP_DATA || {};
const boundaryPlaces = VISITED_PLACES.filter((place) => place.type === "boundary");
const datavPlaces = boundaryPlaces.filter((place) => place.source !== "local");
const localPlaces = boundaryPlaces.filter((place) => place.source === "local");
const provincePlaces = datavPlaces.filter((place) => place.province);
const baseBoundaryPlaces = datavPlaces.filter((place) => !place.province);
const expectedDetailCodes = [...new Set(provincePlaces.map((place) => PROVINCE_CODES[place.province]))];

const forbiddenFeatureNames = ["东莞市", "江门市", "三明市", "龙岩市"];
const baseFeatures = [
  ...baseBoundaryPlaces.map((place, index) => mockFeature(place.names[0], 100000 + index)),
  mockFeature("台湾省", 710000),
  mockFeature("日本", 392000),
  mockFeature("대한민국", 410000),
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
assertEqualSets(success.localHighlightedLabels, localPlaces.map((place) => place.label), "local polygon labels");

if (success.circleMarkerCalls !== 0) {
  throw new Error(`Expected zero point markers, got ${success.circleMarkerCalls}`);
}

for (const name of forbiddenFeatureNames) {
  if (success.highlightedLabels.includes(name)) throw new Error(`Forbidden feature was highlighted: ${name}`);
}

if (!success.summary.includes("Taiwan") || !success.summary.includes("Japan")) {
  throw new Error("Visited summary did not render expected group headings.");
}

if (success.status.includes("unavailable")) {
  throw new Error(`Expected all visited boundaries to render, got status: ${success.status}`);
}

console.log(
  `Map runtime verification passed: ${success.highlightedLabels.length} highlighted boundary regions, ` +
    `${success.localHighlightedLabels.length} local polygons, ${success.requestedDetailCodes.length} province detail requests, ` +
    "0 point markers."
);

async function runMapRuntime() {
  const runtime = createRuntime();
  vm.createContext(runtime.context);
  vm.runInContext(dataSource, runtime.context, { filename: "visited-places.js" });
  vm.runInContext(siteSource, runtime.context, { filename: "site.js" });

  await runtime.fireLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const [visitedLayer] = runtime.featureGroups;
  const highlightedLabels = flattenLayerLabels(visitedLayer);
  const localLabels = new Set(localPlaces.map((place) => place.label));

  return {
    highlightedLabels,
    localHighlightedLabels: highlightedLabels.filter((label) => localLabels.has(label)),
    requestedDetailCodes: runtime.fetchUrls
      .map((url) => url.match(/bound\/(\d+)_full\.json/)?.[1])
      .filter((code) => code && code !== "100000"),
    circleMarkerCalls: runtime.circleMarkerCalls,
    status: runtime.status.textContent,
    summary: runtime.summary.innerHTML,
  };
}

function createRuntime() {
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
  let circleMarkerCalls = 0;

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
    circleMarker() {
      circleMarkerCalls += 1;
      throw new Error("Point markers should not be used for visited places.");
    },
  };

  const context = {
    console,
    fetch(url) {
      fetchUrls.push(url);
      if (url.endsWith("data/visited-boundaries.geojson") || url.endsWith("visited-boundaries.geojson")) {
        return Promise.resolve(mockResponse(localBoundaries));
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
    get circleMarkerCalls() {
      return circleMarkerCalls;
    },
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
