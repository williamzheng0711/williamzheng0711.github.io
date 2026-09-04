import fs from "node:fs";
import vm from "node:vm";

const dataSource = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const siteSource = fs.readFileSync(new URL("./site.js", import.meta.url), "utf8");
const localBoundaries = JSON.parse(fs.readFileSync(new URL("../data/visited-boundaries.geojson", import.meta.url), "utf8"));
const contextBoundaries = JSON.parse(fs.readFileSync(new URL("../data/context-boundaries.geojson", import.meta.url), "utf8"));
const cityContextBoundaries = JSON.parse(fs.readFileSync(new URL("../data/context-city-boundaries.geojson", import.meta.url), "utf8"));
const refinedContextBoundaries = JSON.parse(fs.readFileSync(new URL("../data/refined-context-boundaries.geojson", import.meta.url), "utf8"));

const dataContext = { window: {} };
vm.createContext(dataContext);
vm.runInContext(dataSource, dataContext, { filename: "visited-places.js" });

const { VISITED_PLACES = [] } = dataContext.window.TRAVEL_MAP_DATA || {};
const boundaryPlaces = VISITED_PLACES.filter((place) => place.type === "boundary");
const bundledBoundaryLabels = (localBoundaries.features || []).map((feature) => feature.properties?.label).filter(Boolean);

const forbiddenFeatureNames = ["东莞市", "江门市", "三明市", "龙岩市"];
const expectedBoundaryLabels = boundaryPlaces.map((place) => place.label);
const greaterChinaLabels = boundaryPlaces
  .filter((place) => !["korea", "japan", "usa", "canada", "singapore"].includes(place.group))
  .map((place) => place.label);
const koreaLabels = boundaryPlaces.filter((place) => place.group === "korea").map((place) => place.label);
const japanLabels = boundaryPlaces.filter((place) => place.group === "japan").map((place) => place.label);
const usaLabels = boundaryPlaces.filter((place) => place.group === "usa").map((place) => place.label);
const canadaLabels = boundaryPlaces.filter((place) => place.group === "canada").map((place) => place.label);
const singaporeLabels = boundaryPlaces.filter((place) => place.group === "singapore").map((place) => place.label);
const contextCountryNames = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.name));
const contextCountryAdmins = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.admin));
const contextCountryIsoCodes = new Set((contextBoundaries.features || []).map((feature) => feature.properties?.iso_a3));
const contextDetailCounts = (cityContextBoundaries.features || []).reduce((counts, feature) => {
  const group = feature.properties?.group;
  if (group) counts[group] = (counts[group] || 0) + 1;
  return counts;
}, {});
const detailedContextExpectations = {
  "context-japan": 47,
  "context-korea": 17,
  "context-usa": 51,
  "context-canada": 13,
  "context-malaysia": 16,
  "context-singapore": 1,
};
const refinedContextExpectations = {
  "context-china": [1, { color: "#7a889a", weight: 0.9, fillOpacity: 0.84 }],
  "context-taiwan": [22, { color: "#7c8999", weight: 0.78, fillOpacity: 0.88 }],
  "context-north-america": [5, { color: "#7ca4bb", weight: 0.72, fillOpacity: 1 }],
};

const success = await runMapRuntime();
assertEqualSets(success.highlightedLabels, expectedBoundaryLabels, "highlighted boundary labels");
assertEqualSets(success.bundledHighlightedLabels, expectedBoundaryLabels, "bundled polygon labels");
assertStyles(success.highlightedStyles, greaterChinaLabels, "#000095", 0.44, "Greater China");
assertStyles(success.highlightedStyles, koreaLabels, "#C60C30", 0.44, "Korea");
assertStyles(success.highlightedStyles, japanLabels, "#D66A35", 0.44, "Japan");
assertStyles(success.highlightedStyles, usaLabels, "#00205B", 0.44, "United States");
assertStyles(success.highlightedStyles, canadaLabels, "#EF3340", 0.44, "Canada");
assertStyles(success.highlightedStyles, singaporeLabels, "#EF3340", 0.44, "Singapore");
Object.entries(detailedContextExpectations).forEach(([group, expectedCount]) => {
  assertContextStyle(success.contextStyles, group, expectedCount, {
    color: "#8d9aad",
    weight: 0.68,
    fillOpacity: 0.84,
  });
});
Object.entries(refinedContextExpectations).forEach(([group, [expectedCount, expectedStyle]]) => {
  assertContextStyle(success.contextStyles, group, expectedCount, expectedStyle);
});
assertRenderedExactlyOnce(success.highlightedLabels, expectedBoundaryLabels, "highlighted visited regions");

const worldCopyOffsetCounts = success.worldCopyOffsets.reduce((counts, offset) => {
  counts.set(offset, (counts.get(offset) || 0) + 1);
  return counts;
}, new Map());
if (
  worldCopyOffsetCounts.get(0) !== worldCopyOffsetCounts.get(-360) ||
  worldCopyOffsetCounts.has(360) ||
  [...worldCopyOffsetCounts.keys()].some((offset) => ![0, -360].includes(offset))
) {
  throw new Error(`Expected balanced current and one adjacent world copy, got ${JSON.stringify(Object.fromEntries(worldCopyOffsetCounts))}`);
}

const russiaExtent = longitudeExtent(success.russiaFeature?.geometry?.coordinates);
if (russiaExtent.min < 0 || russiaExtent.max <= 180) {
  throw new Error(`Expected dateline-adjacent Russian parts to stay together, got ${JSON.stringify(russiaExtent)}`);
}
if (datelineSeamEdgeCount(success.russiaFeature?.geometry?.coordinates) !== 0) {
  throw new Error("Expected Russia to render without an explicit 180 degree seam edge.");
}
const russiaEastExtent = longitudeExtent(success.russiaEastFeature?.geometry?.coordinates);
if (russiaEastExtent.min < 0 || russiaEastExtent.max <= 180) {
  throw new Error(`Expected the east-facing Russian copy to stay contiguous, got ${JSON.stringify(russiaEastExtent)}`);
}
const russiaWestExtent = longitudeExtent(success.russiaWestFeature?.geometry?.coordinates);
if (russiaWestExtent.max > 0 || russiaWestExtent.min >= -180) {
  throw new Error(`Expected the west-facing Russian copy to stay contiguous, got ${JSON.stringify(russiaWestExtent)}`);
}

if (success.mapOptions.minZoom !== 2) {
  throw new Error(`Expected minZoom 2 to prevent over-shrinking the world map, got ${success.mapOptions.minZoom}`);
}

if (success.mapOptions.zoomDelta !== 0.5 || success.mapOptions.zoomSnap !== 0.5) {
  throw new Error(`Expected half-step zoom controls, got zoomDelta=${success.mapOptions.zoomDelta}, zoomSnap=${success.mapOptions.zoomSnap}`);
}

if (success.mapOptions.wheelPxPerZoomLevel !== 120) {
  throw new Error(`Expected gentler wheel zoom sensitivity, got wheelPxPerZoomLevel=${success.mapOptions.wheelPxPerZoomLevel}`);
}

if (success.mapOptions.preferCanvas !== true) {
  throw new Error("Expected Canvas rendering so newly exposed regions are redrawn during an active drag.");
}
if (success.mapOptions.renderer?.options?.padding !== 1) {
  throw new Error(`Expected a full-viewport Canvas drag buffer, got ${JSON.stringify(success.mapOptions.renderer)}`);
}

if (success.mapOptions.inertia !== false) {
  throw new Error("Expected map inertia to be disabled so polar drag limits cannot be overshot after mouseup.");
}

if (success.mapOptions.worldCopyJump === true) {
  throw new Error("worldCopyJump must stay disabled; the renderer controls the horizontal wrap.");
}

if (success.mapOptions.maxBounds !== undefined || success.mapOptions.maxBoundsViscosity !== undefined) {
  throw new Error("The map must leave horizontal bounds open; latitude and longitude are clamped by the move handler.");
}

if (success.viewportMinimumZoom({ clientWidth: 1024 }) !== 2.5) {
  throw new Error("Expected a 1024px map to reserve horizontal coverage at zoom 2.5.");
}
if (success.viewportMinimumZoom({ clientWidth: 1570 }) !== 3) {
  throw new Error("Expected a wide map to raise its minimum zoom so one world covers the viewport.");
}

const viewportClamp = success.clampMapCenterToViewport({
  getZoom: () => 2,
  getPixelWorldBounds: () => ({ min: { y: 0 }, max: { y: 1024 } }),
  getSize: () => ({ y: 580 }),
  project: (center) => ({ x: center.lng, y: 512 - center.lat * 4 }),
  unproject: (point) => ({ lat: (512 - point[1]) / 4, lng: point[0] }),
}, { lat: 100, lng: 12 });
if (viewportClamp.lat > 55.5 || viewportClamp.lat < -55.5 || viewportClamp.lng !== 12) {
  throw new Error(`Expected the full viewport to stay inside the projected world, got ${JSON.stringify(viewportClamp)}`);
}

const predrag = success.map.dragging?._draggable?.events?.predrag;
if (typeof predrag !== "function") {
  throw new Error("Expected a predrag latitude guard to be attached to Leaflet's draggable handler.");
}
success.map.dragging._draggable._newPos = { x: 0, y: 1000 };
predrag();
if (success.map.dragging._draggable._newPos.y >= 1000) {
  throw new Error("Expected predrag to cap the candidate latitude before Leaflet moves the map.");
}

if (siteSource.includes("WORLD_LONGITUDE_OFFSETS") || siteSource.includes("worldCopies(")) {
  throw new Error("Map source must not enable uncontrolled Leaflet world copies.");
}

assertEastAsiaView(success.setViewCalls[0], "initial map view");
assertEastAsiaView(success.setViewCalls.at(-1), "post-load map view");

success.map.setView([40, 140], 4);
const activeGroupsBeforeMove = success.map.layers.filter((layer) => layer?._target === success.map);
success.map.events.move();
if (success.map.center[0] !== 40 || success.map.center[1] !== 140) {
  throw new Error(`Expected a small horizontal move to stay smooth, got ${JSON.stringify(success.map.center)}`);
}
const activeGroupsAfterMove = success.map.layers.filter((layer) => layer?._target === success.map);
if (
  activeGroupsAfterMove.length !== activeGroupsBeforeMove.length ||
  activeGroupsAfterMove.some((layer, index) => layer !== activeGroupsBeforeMove[index])
) {
  throw new Error("Expected small horizontal move events to keep the current map layers intact.");
}
success.map.setView([100, 220], 4);
success.map.events.move();
const boundedCenter = success.map.center;
if (boundedCenter[0] !== 85.05112878 || boundedCenter[1] !== 220) {
  throw new Error(`Expected latitude to clamp without interrupting horizontal drag, got ${JSON.stringify(boundedCenter)}`);
}
const activeGroupsAfterLargeMove = success.map.layers.filter((layer) => layer?._target === success.map);
if (
  activeGroupsAfterLargeMove.length !== activeGroupsAfterMove.length ||
  activeGroupsAfterLargeMove.some((layer, index) => layer !== activeGroupsAfterMove[index])
) {
  throw new Error("Expected the adjacent world copies to keep the current bundle intact during a long drag.");
}
success.map.events.moveend();
if (success.map.center[0] !== 85.05112878 || success.map.center[1] !== -140) {
  throw new Error(`Expected horizontal normalization at moveend, got ${JSON.stringify(success.map.center)}`);
}
const activeGroupsAfterMoveend = success.map.layers.filter((layer) => layer?._target === success.map);
if (
  activeGroupsAfterMoveend.length !== activeGroupsAfterLargeMove.length ||
  activeGroupsAfterMoveend.every((layer, index) => layer === activeGroupsAfterLargeMove[index])
) {
  throw new Error("Expected moveend to replace the map layers as one complete bundle.");
}

if (success.fitBoundsCalls.length !== 0) {
  throw new Error("Expected initial view to stay in East Asia instead of fitting all worldwide visited regions.");
}

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

if (!success.refinedContextRequested) {
  throw new Error("Expected local refined context boundary data to be requested.");
}

if (!success.localBoundariesRequested) {
  throw new Error("Expected bundled visited boundary data to be requested.");
}

if (success.remoteFetches.length) {
  throw new Error(`Expected no remote fetches, got: ${success.remoteFetches.join(", ")}`);
}

[
  "Canada",
  "China",
  "Japan",
  "Malaysia",
  "Singapore",
  "South Korea",
  "United States of America",
].forEach((countryName) => {
  if (contextCountryNames.has(countryName) || contextCountryAdmins.has(countryName)) {
    throw new Error(`Expected coarse ${countryName} country outline to be replaced by detailed context polygons.`);
  }
});

if (contextCountryNames.has("Taiwan") || contextCountryAdmins.has("Taiwan")) {
  throw new Error("Expected coarse Taiwan country outline to be replaced by county/city boundaries.");
}

if ((contextBoundaries.features || []).length < 170) {
  throw new Error(`Expected world context boundaries, got only ${contextBoundaries.features.length} country outlines.`);
}

["AUS", "BRA", "DEU", "IND", "MEX", "ZAF"].forEach((isoCode) => {
  if (!contextCountryIsoCodes.has(isoCode)) throw new Error(`Expected world context to include ISO ${isoCode}.`);
});

Object.entries(detailedContextExpectations).forEach(([group, expectedCount]) => {
  if (contextDetailCounts[group] !== expectedCount) {
    throw new Error(`Expected ${expectedCount} ${group} context boundaries, got ${contextDetailCounts[group] || 0}.`);
  }
});

const taiwanAdminFeatures = refinedContextBoundaries.features.filter(
  (feature) => feature.properties?.kind === "taiwan-administration"
);
if (taiwanAdminFeatures.length !== 22) {
  throw new Error(`Expected 22 Taiwan county/city boundaries, got ${taiwanAdminFeatures.length}.`);
}

if (!taiwanAdminFeatures.some((feature) => feature.properties?.name === "桃園市")) {
  throw new Error("Expected 桃園市 in the Taiwan administrative boundaries.");
}

const greatLakeNames = new Set(
  refinedContextBoundaries.features
    .filter((feature) => feature.properties?.kind === "great-lake")
    .map((feature) => feature.properties?.name)
);
["Lake Superior", "Lake Michigan", "Lake Huron", "Lake Erie", "Lake Ontario"].forEach((name) => {
  if (!greatLakeNames.has(name)) throw new Error(`Expected Great Lake boundary for ${name}.`);
});

const northAmericaFeatures = cityContextBoundaries.features.filter(
  (feature) => ["context-usa", "context-canada"].includes(feature.properties?.group)
);
if (!northAmericaFeatures.every((feature) => feature.properties?.source === "Natural Earth 10m Admin 1 States/Provinces (lakes)")) {
  throw new Error("Expected United States and Canada boundaries to use Natural Earth 10m lake-aware geometry.");
}

const northAmericaCoordinateCount = northAmericaFeatures.reduce(
  (total, feature) => total + countCoordinates(feature.geometry?.coordinates),
  0
);
if (northAmericaCoordinateCount < 130000) {
  throw new Error(`Expected detailed North America geometry, got only ${northAmericaCoordinateCount} coordinate pairs.`);
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
  `Map runtime verification passed: ${success.highlightedRegionCount} highlighted boundary regions, ` +
    `${success.bundledRegionCount} bundled polygons, ` +
    `${contextBoundaries.features.length} country outlines, ${cityContextBoundaries.features.length} city/province outlines, ` +
    `${taiwanAdminFeatures.length} Taiwan county/city outlines, and ${greatLakeNames.size} Great Lakes; ` +
    "0 point markers, 0 remote tile layers."
);

async function runMapRuntime(options = {}) {
  const runtime = createRuntime(options);
  vm.createContext(runtime.context);
  vm.runInContext(dataSource, runtime.context, { filename: "visited-places.js" });
  vm.runInContext(siteSource, runtime.context, { filename: "site.js" });

  await runtime.fireLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const activeGroups = runtime.featureGroups.filter((group) => group._target === runtime.map);
  const visitedLayer = activeGroups.find((group) => flattenLayerLabels(group).length > 0);
  const contextLayer = activeGroups.find((group) => flattenFeatureStyles(group).length > 0);
  if (!visitedLayer || !contextLayer) {
    throw new Error(`Expected active visited/context layer groups, got ${activeGroups.length}.`);
  }
  const highlightedLabels = flattenLayerLabels(visitedLayer);
  const highlightedStyles = flattenLayerStyles(visitedLayer);
  const contextStyles = flattenFeatureStyles(contextLayer);
  const bundledLabels = new Set(bundledBoundaryLabels);
  const shiftFeatures = runtime.context.featuresNearLongitude;
  const russiaSourceFeature = contextBoundaries.features.find((feature) => feature.properties?.iso_a3 === "RUS");

  return {
    highlightedLabels,
    highlightedStyles,
    contextStyles,
    worldCopyOffsets: flattenWorldCopyOffsets(contextLayer),
    russiaFeature: contextStyles.find((item) => item.name === "Russia")?.feature || null,
    russiaEastFeature: shiftFeatures([russiaSourceFeature], 180)[0],
    russiaWestFeature: shiftFeatures([russiaSourceFeature], -180)[0],
    highlightedRegionCount: new Set(highlightedLabels).size,
    bundledRegionCount: new Set(highlightedLabels.filter((label) => bundledLabels.has(label))).size,
    bundledHighlightedLabels: highlightedLabels.filter((label) => bundledLabels.has(label)),
    circleMarkerCalls: runtime.circleMarkerCalls,
    tileLayerCalls: runtime.tileLayerCalls,
    mapOptions: runtime.map.options || {},
    map: runtime.map,
    clampMapCenterToViewport: runtime.context.clampMapCenterToViewport,
    viewportMinimumZoom: runtime.context.viewportMinimumZoom,
    setViewCalls: runtime.map.setViewCalls,
    fitBoundsCalls: runtime.map.fitBoundsCalls,
    localBoundariesRequested: runtime.fetchUrls.some((url) => url.endsWith("visited-boundaries.geojson")),
    contextRequested: runtime.fetchUrls.some((url) => url.endsWith("context-boundaries.geojson")),
    cityContextRequested: runtime.fetchUrls.some((url) => url.endsWith("context-city-boundaries.geojson")),
    refinedContextRequested: runtime.fetchUrls.some((url) => url.endsWith("refined-context-boundaries.geojson")),
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
    options: {},
    layers: [],
    center: [0, 0],
    zoom: 0,
    dragging: {
      _draggable: {
        events: {},
        _newPos: { x: 0, y: 0 },
        on(event, listener) {
          this.events[event] = listener;
          return this;
        },
        moving() {
          return false;
        },
      },
    },
    events: {},
    fitBoundsCalls: [],
    setViewCalls: [],
    setView(center, zoom) {
      this.center = center;
      if (zoom !== undefined) this.zoom = zoom;
      this.setViewCalls.push({ center, zoom });
      return this;
    },
    getCenter() {
      return { lat: this.center[0], lng: this.center[1] };
    },
    getZoom() {
      return this.zoom;
    },
    getSize() {
      return {
        y: 580,
        divideBy() {
          return {
            x: 512,
            y: 290,
            subtract(point) {
              return { x: this.x - point.x, y: this.y - point.y };
            },
          };
        },
      };
    },
    layerPointToLatLng(point) {
      return { lat: 100 - point.y * 0.01, lng: 0 };
    },
    latLngToLayerPoint(center) {
      const latitude = Array.isArray(center) ? center[0] : center.lat;
      return { y: (100 - latitude) * 10 };
    },
    on(event, listener) {
      this.events[event] = listener;
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
    map(_container, options = {}) {
      map.options = options;
      return map;
    },
    canvas(options = {}) {
      return { options };
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
      if (url.endsWith("data/refined-context-boundaries.geojson") || url.endsWith("refined-context-boundaries.geojson")) {
        return Promise.resolve(mockResponse(refinedContextBoundaries));
      }
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
    map,
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
    _target: null,
    addTo(target) {
      this._target = target;
      if (!target.layers.includes(this)) target.layers.push(this);
      return this;
    },
    remove() {
      if (this._target?.layers) {
        this._target.layers = this._target.layers.filter((layer) => layer !== this);
      }
      this._target = null;
      return this;
    },
    clearLayers() {
      this.layers = [];
    },
    eachLayer(callback) {
      this.layers.forEach(callback);
      return this;
    },
    addLayer(layer) {
      if (!this.layers.includes(layer)) this.layers.push(layer);
      if (layer && typeof layer === "object") layer._target = this;
      return this;
    },
    removeLayer(layer) {
      this.layers = this.layers.filter((candidate) => candidate !== layer);
      if (layer?._target === this) layer._target = null;
      return this;
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
    if (layer.feature?.properties?.__worldCopyOffset !== undefined && layer.feature.properties.__worldCopyOffset !== 0) {
      return [];
    }
    if (layer.tooltip?.text) return [layer.tooltip.text];
    if (layer.layers) return flattenLayerLabels(layer);
    return [];
  });
}

function flattenLayerStyles(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.feature?.properties?.__worldCopyOffset !== undefined && layer.feature.properties.__worldCopyOffset !== 0) {
      return [];
    }
    if (layer.tooltip?.text) return [{ label: layer.tooltip.text, style: layer.style || {} }];
    if (layer.layers) return flattenLayerStyles(layer);
    return [];
  });
}

function flattenFeatureStyles(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.feature?.properties?.__worldCopyOffset !== undefined && layer.feature.properties.__worldCopyOffset !== 0) {
      return [];
    }
    if (layer.feature) {
      return [{
        feature: layer.feature,
        group: layer.feature.properties?.group,
        name: layer.feature.properties?.name,
        style: layer.style || {},
      }];
    }
    if (layer.layers) return flattenFeatureStyles(layer);
    return [];
  });
}

function flattenWorldCopyOffsets(layerGroup) {
  return layerGroup.layers.flatMap((layer) => {
    if (layer.feature) return [layer.feature.properties?.__worldCopyOffset];
    if (layer.layers) return flattenWorldCopyOffsets(layer);
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

function assertContextStyle(actual, group, expectedCount, expectedStyle) {
  const styles = actual.filter((item) => item.group === group);
  const uniqueNames = new Set(styles.map((item) => item.name));
  if (uniqueNames.size !== expectedCount) {
    throw new Error(`Expected ${expectedCount} unique ${group} context styles, got ${uniqueNames.size}`);
  }
  if (styles.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} ${group} context styles, got ${styles.length}`);
  }
  styles.forEach((item) => {
    if (String(item.style.color).toLowerCase() !== expectedStyle.color.toLowerCase()) {
      throw new Error(`${group} border color mismatch for ${item.name}: ${item.style.color} !== ${expectedStyle.color}`);
    }
    if (item.style.weight !== expectedStyle.weight) {
      throw new Error(`${group} border weight mismatch for ${item.name}: ${item.style.weight} !== ${expectedStyle.weight}`);
    }
    if (item.style.fillOpacity !== expectedStyle.fillOpacity) {
      throw new Error(
        `${group} opacity mismatch for ${item.name}: ${item.style.fillOpacity} !== ${expectedStyle.fillOpacity}`
      );
    }
  });
}

function assertRenderedExactlyOnce(actualLabels, expectedLabels, label) {
  const counts = actualLabels.reduce((summary, item) => {
    summary.set(item, (summary.get(item) || 0) + 1);
    return summary;
  }, new Map());
  expectedLabels.forEach((item) => {
    if (counts.get(item) !== 1) {
      throw new Error(`Expected one rendered copy for ${label} "${item}", got ${counts.get(item) || 0}`);
    }
  });
}

function assertEastAsiaView(call, label) {
  if (!call) throw new Error(`Missing ${label}.`);
  const [lat, lng] = call.center || [];
  if (lat !== 31.5 || lng !== 121.8 || call.zoom !== 4) {
    throw new Error(`Expected ${label} to be East Asia [31.5, 121.8] zoom 4, got ${JSON.stringify(call)}`);
  }
}

function countCoordinates(value) {
  if (!Array.isArray(value)) return 0;
  if (typeof value[0] === "number") return 1;
  return value.reduce((total, item) => total + countCoordinates(item), 0);
}

function longitudeExtent(value) {
  let min = Infinity;
  let max = -Infinity;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") {
      min = Math.min(min, coordinates[0]);
      max = Math.max(max, coordinates[0]);
      return;
    }
    coordinates.forEach(visit);
  };
  visit(value);
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

function datelineSeamEdgeCount(value) {
  let count = 0;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length > 1 && Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
      for (let index = 0; index < coordinates.length - 1; index += 1) {
        const first = coordinates[index];
        const second = coordinates[index + 1];
        if (
          Math.abs(Math.abs(first[0]) - 180) < 1e-6 &&
          Math.abs(Math.abs(second[0]) - 180) < 1e-6 &&
          Math.abs(first[0] - second[0]) < 1e-6 &&
          Math.abs(first[1] - second[1]) > 1e-6
        ) {
          count += 1;
        }
      }
      return;
    }
    coordinates.forEach(visit);
  };
  visit(value);
  return count;
}
