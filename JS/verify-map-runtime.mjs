import fs from "node:fs";
import vm from "node:vm";

const dataSource = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const siteSource = fs.readFileSync(new URL("./site.js", import.meta.url), "utf8");
const localBoundaries = JSON.parse(fs.readFileSync(new URL("../data/visited-boundaries.geojson", import.meta.url), "utf8"));
const contextBoundaries = JSON.parse(fs.readFileSync(new URL("../data/context-boundaries.geojson", import.meta.url), "utf8"));
const cityContextBoundaries = JSON.parse(fs.readFileSync(new URL("../data/context-city-boundaries.geojson", import.meta.url), "utf8"));

const dataContext = { window: {} };
vm.createContext(dataContext);
vm.runInContext(dataSource, dataContext, { filename: "visited-places.js" });

const { VISITED_PLACES = [] } = dataContext.window.TRAVEL_MAP_DATA || {};
const boundaryPlaces = VISITED_PLACES.filter((place) => place.type === "boundary");
const bundledBoundaryLabels = (localBoundaries.features || []).map((feature) => feature.properties?.label).filter(Boolean);

const forbiddenFeatureNames = ["东莞市", "江门市", "三明市", "龙岩市"];
const expectedBoundaryLabels = boundaryPlaces.map((place) => place.label);
const greaterChinaLabels = boundaryPlaces
  .filter((place) => !["korea", "japan", "usa", "singapore"].includes(place.group))
  .map((place) => place.label);
const koreaLabels = boundaryPlaces.filter((place) => place.group === "korea").map((place) => place.label);
const japanLabels = boundaryPlaces.filter((place) => place.group === "japan").map((place) => place.label);
const usaLabels = boundaryPlaces.filter((place) => place.group === "usa").map((place) => place.label);
const singaporeLabels = boundaryPlaces.filter((place) => place.group === "singapore").map((place) => place.label);
const contextCountryNames = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.name));
const contextCountryAdmins = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.admin));
const contextCountryIsoCodes = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.iso_a3));
const contextDetailCounts = (cityContextBoundaries.features || []).reduce((counts, feature) => {
  const group = feature.properties?.group;
  if (group) counts[group] = (counts[group] || 0) + 1;
  return counts;
}, {});

const success = await runMapRuntime();
assertEqualSets(success.highlightedLabels, expectedBoundaryLabels, "highlighted boundary labels");
assertEqualSets(success.bundledHighlightedLabels, expectedBoundaryLabels, "bundled polygon labels");
assertStyles(success.highlightedStyles, greaterChinaLabels, "#000095", 0.44, "Greater China");
assertStyles(success.highlightedStyles, koreaLabels, "#C60C30", 0.44, "Korea");
assertStyles(success.highlightedStyles, japanLabels, "#D66A35", 0.44, "Japan");
assertStyles(success.highlightedStyles, usaLabels, "#00205B", 0.44, "United States");
assertStyles(success.highlightedStyles, singaporeLabels, "#EF3340", 0.44, "Singapore");
assertContextOpacity(success.contextStyles, "context-japan", 47, 0.84);
assertContextOpacity(success.contextStyles, "context-korea", 17, 0.84);

if (success.circleMarkerCalls !== 0) {
  throw new Error(`Expected zero point markers, got ${success.circleMarkerCalls}`);
}

if (success.tileLayerCalls !== 0) {
  throw new Error(`Expected zero remote tile layers, got ${success.tileLayerCalls}`);
}

if (!success.contextRequested) {
  throw new Error("Expected local context boundary data to be requested.");
}

if (!success.cityContextRequested) {
  throw new Error("Expected local city context boundary data to be requested.");
}

if (!success.localBoundariesRequested) {
  throw new Error("Expected bundled visited boundary data to be requested.");
}

if (success.remoteFetches.length) {
  throw new Error(`Expected no remote fetches, got: ${success.remoteFetches.join(", ")}`);
}

if (contextCountryNames.has("Japan") || contextCountryNames.has("South Korea")) {
  throw new Error("Expected coarse Japan/South Korea country outlines to be replaced by detailed ADM1 context polygons.");
}

if ((contextBoundaries.features || []).length < 170) {
  throw new Error(`Expected world context boundaries, got only ${contextBoundaries.features.length} country outlines.`);
}

["USA", "SGP", "BRA", "DEU", "ZAF", "AUS"].forEach((isoCode) => {
  if (!contextCountryIsoCodes.has(isoCode)) throw new Error(`Expected world context to include ISO ${isoCode}.`);
});

if (!contextCountryAdmins.has("United States of America") || !contextCountryAdmins.has("Singapore")) {
  throw new Error("Expected world context to include United States and Singapore.");
}

if (contextDetailCounts["context-japan"] !== 47 || contextDetailCounts["context-korea"] !== 17) {
  throw new Error(
    `Expected detailed Japan/Korea context boundaries, got Japan=${contextDetailCounts["context-japan"] || 0}, ` +
      `Korea=${contextDetailCounts["context-korea"] || 0}`
  );
}

for (const name of forbiddenFeatureNames) {
  if (success.highlightedLabels.includes(name)) throw new Error(`Forbidden feature was highlighted: ${name}`);
}

if (success.summary && (!success.summary.includes("Taiwan") || !success.summary.includes("Japan"))) {
  throw new Error("Visited summary did not render expected group headings.");
}

if (success.status.includes("unavailable") || success.status.includes("could not be loaded")) {
  throw new Error(`Expected all visited boundaries to render, got status: ${success.status}`);
}

console.log(
  `Map runtime verification passed: ${success.highlightedLabels.length} highlighted boundary regions, ` +
    `${success.bundledHighlightedLabels.length} bundled polygons, ` +
    `${contextBoundaries.features.length} country outlines, ${cityContextBoundaries.features.length} city/province outlines, ` +
    "0 point markers, 0 remote tile layers."
);

async function runMapRuntime(options = {}) {
  const runtime = createRuntime(options);
  vm.createContext(runtime.context);
  vm.runInContext(dataSource, runtime.context, { filename: "visited-places.js" });
  vm.runInContext(siteSource, runtime.context, { filename: "site.js" });

  await runtime.fireLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const [visitedLayer, contextLayer] = runtime.featureGroups;
  const highlightedLabels = flattenLayerLabels(visitedLayer);
  const highlightedStyles = flattenLayerStyles(visitedLayer);
  const contextStyles = flattenFeatureStyles(contextLayer);
  const bundledLabels = new Set(bundledBoundaryLabels);

  return {
    highlightedLabels,
    highlightedStyles,
    contextStyles,
    bundledHighlightedLabels: highlightedLabels.filter((label) => bundledLabels.has(label)),
    circleMarkerCalls: runtime.circleMarkerCalls,
    tileLayerCalls: runtime.tileLayerCalls,
    localBoundariesRequested: runtime.fetchUrls.some((url) => url.endsWith("visited-boundaries.geojson")),
    contextRequested: runtime.fetchUrls.some((url) => url.endsWith("context-boundaries.geojson")),
    cityContextRequested: runtime.fetchUrls.some((url) => url.endsWith("context-city-boundaries.geojson")),
    remoteFetches: runtime.fetchUrls.filter((url) => /^https?:\/\//.test(url)),
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
  let tileLayerCalls = 0;

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
      tileLayerCalls += 1;
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
        const style = typeof options.style === "function" ? options.style(feature) : options.style;
        const layer = createLayer(feature, style);
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
      if (url.endsWith("data/context-boundaries.geojson") || url.endsWith("context-boundaries.geojson")) {
        return Promise.resolve(mockResponse(contextBoundaries));
      }
      if (url.endsWith("data/context-city-boundaries.geojson") || url.endsWith("context-city-boundaries.geojson")) {
        return Promise.resolve(mockResponse(cityContextBoundaries));
      }
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
    get tileLayerCalls() {
      return tileLayerCalls;
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

function createLayer(feature, style) {
  return {
    feature,
    style,
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

function flattenLayerStyles(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.tooltip?.text) return [{ label: layer.tooltip.text, style: layer.style || {} }];
    if (layer.layers) return flattenLayerStyles(layer);
    return [];
  });
}

function flattenFeatureStyles(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.feature) {
      return [{ group: layer.feature.properties?.group, name: layer.feature.properties?.name, style: layer.style || {} }];
    }
    if (layer.layers) return flattenFeatureStyles(layer);
    return [];
  });
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

function assertStyles(actual, labels, fillColor, fillOpacity, groupLabel) {
  const byLabel = new Map(actual.map((item) => [item.label, item.style]));
  labels.forEach((label) => {
    const style = byLabel.get(label);
    if (!style) throw new Error(`${groupLabel} style missing for ${label}`);
    if (String(style.fillColor).toLowerCase() !== fillColor.toLowerCase()) {
      throw new Error(`${groupLabel} color mismatch for ${label}: ${style.fillColor} !== ${fillColor}`);
    }
    if (style.fillOpacity !== fillOpacity) {
      throw new Error(`${groupLabel} opacity mismatch for ${label}: ${style.fillOpacity} !== ${fillOpacity}`);
    }
  });
}

function assertContextOpacity(actual, group, expectedCount, fillOpacity) {
  const styles = actual.filter((item) => item.group === group);
  if (styles.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} ${group} context styles, got ${styles.length}`);
  }
  styles.forEach((item) => {
    if (item.style.fillOpacity !== fillOpacity) {
      throw new Error(`${group} opacity mismatch for ${item.name}: ${item.style.fillOpacity} !== ${fillOpacity}`);
    }
  });
}
