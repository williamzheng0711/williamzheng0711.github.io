const LOCAL_BOUNDARIES = "data/visited-boundaries.geojson";
const CONTEXT_BOUNDARIES = "data/context-boundaries.geojson";
const CONTEXT_CITY_BOUNDARIES = "data/context-city-boundaries.geojson";
const REFINED_CONTEXT_BOUNDARIES = "data/refined-context-boundaries.geojson";

const travelMapData = window.TRAVEL_MAP_DATA || {};
const travelVisitedPlaces = travelMapData.VISITED_PLACES || [];
const travelSummaryGroups = travelMapData.SUMMARY_GROUPS || [];

const boundaryPlaces = travelVisitedPlaces.filter((place) => place.type === "boundary");
const visitedNames = new Set(boundaryPlaces.flatMap((place) => place.names));
const placeByName = new Map(boundaryPlaces.flatMap((place) => place.names.map((name) => [name, place])));
const INITIAL_MAP_CENTER = [31.5, 121.8];
const INITIAL_MAP_ZOOM = 4;
const MIN_MAP_ZOOM = 2;
const WORLD_COVERAGE_MARGIN = 1.2;
const CANVAS_RENDERER_PADDING = 1;
const MAP_LATITUDE_LIMIT = 85.05112878;
const DETAILED_CONTEXT_GROUPS = new Set([
  "context-canada",
  "context-japan",
  "context-korea",
  "context-malaysia",
  "context-singapore",
  "context-usa",
]);
const REFINED_COUNTRY_CODES = new Set(["CHN", "TWN"]);

const navLinks = [...document.querySelectorAll(".menu-item")];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        link.classList.toggle("current", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-35% 0px -55% 0px" }
);

sections.forEach((section) => observer.observe(section));

function renderTravelMap() {
  const container = document.querySelector("#china-map");
  if (!container || !window.L) return;

  container.innerHTML = "";
  const mapOptions = {
    attributionControl: false,
    zoomControl: true,
    scrollWheelZoom: true,
    preferCanvas: true,
    zoomDelta: 0.5,
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 120,
    minZoom: viewportMinimumZoom(container),
    inertia: false,
  };
  if (typeof L.canvas === "function") {
    mapOptions.renderer = L.canvas({ padding: CANVAS_RENDERER_PADDING });
  }
  const map = L.map(container, mapOptions).setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);

  const updateViewportMinimumZoom = () => {
    const minimumZoom = viewportMinimumZoom(container);
    const currentMinimumZoom = typeof map.getMinZoom === "function"
      ? map.getMinZoom()
      : map.options.minZoom;
    if (minimumZoom === currentMinimumZoom) return;
    if (typeof map.setMinZoom === "function") map.setMinZoom(minimumZoom);
    else map.options.minZoom = minimumZoom;
    if (map.getZoom() < minimumZoom) map.setZoom(minimumZoom, { animate: false });
  };
  window.addEventListener("resize", updateViewportMinimumZoom);

  const latitudeDraggable = map.dragging?._draggable;
  if (latitudeDraggable?.on) {
    latitudeDraggable.on("predrag", () => {
      const centerPoint = map.getSize().divideBy(2);
      const candidateLayerPoint = centerPoint.subtract(latitudeDraggable._newPos);
      const candidateCenter = map.layerPointToLatLng(candidateLayerPoint);
      const boundedCenter = clampMapCenterToViewport(map, candidateCenter);
      if (Math.abs(boundedCenter.lat - candidateCenter.lat) < 1e-8) return;

      const targetLayerPoint = map.latLngToLayerPoint([boundedCenter.lat, candidateCenter.lng]);
      latitudeDraggable._newPos.y = centerPoint.y - targetLayerPoint.y;
    });
  }

  const status = L.control({ position: "bottomleft" });
  status.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-map-tip");
    div.textContent = "Loading visited regions...";
    return div;
  };
  status.addTo(map);

  let visitedLayer = L.featureGroup().addTo(map);
  let contextLayer = L.featureGroup().addTo(map);
  const visited = new Set(visitedNames);
  let clampingLatitude = false;
  let normalizingLongitude = false;
  let redrawVisited = () => {};
  const clampMapLatitude = () => {
    if (clampingLatitude) return false;
    const center = map.getCenter();
    const boundedCenter = clampMapCenterToViewport(map, center);
    if (Math.abs(boundedCenter.lat - center.lat) < 1e-8) return false;

    clampingLatitude = true;
    map.setView([boundedCenter.lat, center.lng], map.getZoom(), { animate: false });
    clampingLatitude = false;
    return true;
  };
  const normalizeMapLongitude = () => {
    if (normalizingLongitude || map.dragging?.moving?.()) return false;
    const center = map.getCenter();
    let longitude = center.lng;
    while (longitude > 180) longitude -= 360;
    while (longitude < -180) longitude += 360;
    if (longitude === center.lng) return false;

    normalizingLongitude = true;
    map.setView([center.lat, longitude], map.getZoom(), { animate: false });
    normalizingLongitude = false;
    return true;
  };
  document.querySelector(".leaflet-map-tip").textContent =
    "Loading local map boundaries...";

  const localRequest = fetch(LOCAL_BOUNDARIES).then((response) => response.json()).catch(() => null);
  const contextRequest = fetch(CONTEXT_BOUNDARIES).then((response) => response.json()).catch(() => null);
  const cityContextRequest = fetch(CONTEXT_CITY_BOUNDARIES).then((response) => response.json()).catch(() => null);
  const refinedContextRequest = fetch(REFINED_CONTEXT_BOUNDARIES).then((response) => response.json()).catch(() => null);

  Promise.all([localRequest, contextRequest, cityContextRequest, refinedContextRequest])
    .then(([local, context, cityContext, refinedContext]) => {
      const localFeatures = local?.features || [];
      const contextFeatures = (context?.features || []).filter(
        (feature) => !REFINED_COUNTRY_CODES.has(feature.properties?.iso_a3)
      );
      const cityContextFeatures = cityContext?.features || [];
      const refinedContextFeatures = refinedContext?.features || [];
      const refinedCountryFeatures = refinedContextFeatures.filter(
        (feature) => feature.properties?.kind === "country-coastline"
      );
      const taiwanAdminFeatures = refinedContextFeatures.filter(
        (feature) => feature.properties?.kind === "taiwan-administration"
      );
      const greatLakeFeatures = refinedContextFeatures.filter(
        (feature) => feature.properties?.kind === "great-lake"
      );
      const allBoundaryFeatures = uniqueFeaturesByName(localFeatures);

      const updateMapStatus = (renderedFeatures) => {
        const labels = renderedFeatures.map((feature) => {
          const name = regionName(feature);
          return placeByName.get(name)?.label || name;
        });
        const missingCount = visited.size - renderedFeatures.length;
        document.querySelector(".leaflet-map-tip").textContent = [
          // `Highlighted: ${labels.join(", ") || "none"}.`,
          `Move mouse over a colored region to see its name. `,
          missingCount > 0 ? `${missingCount} boundary data source${missingCount === 1 ? "" : "s"} unavailable.` : "",
          "Click a colored city to toggle it.",
        ].filter(Boolean).join(" ");
      };

      const buildVisitedLayer = (mapLongitude) => {
        const nextVisitedLayer = L.featureGroup();
        const renderedFeatures = allBoundaryFeatures.filter((feature) => visited.has(regionName(feature)));
        L.geoJSON(featuresNearLongitudeCopies(renderedFeatures, mapLongitude), {
          style: (feature) => visitedRegionStyle(placeByName.get(regionName(feature))),
          onEachFeature: (feature, layer) => {
            const name = regionName(feature);
            layer.bindTooltip(placeByName.get(name)?.label || name);
            layer.on("click", () => {
              visited.delete(name);
              redrawVisited();
            });
          },
        }).addTo(nextVisitedLayer);
        updateMapStatus(renderedFeatures);
        return nextVisitedLayer;
      };

      redrawVisited = function () {
        const nextVisitedLayer = buildVisitedLayer(map.getCenter().lng);
        nextVisitedLayer.addTo(map);
        visitedLayer.remove();
        visitedLayer = nextVisitedLayer;
      };

      const buildContextLayer = (mapLongitude) => {
        const nextContextLayer = L.featureGroup();

        L.geoJSON(featuresNearLongitudeCopies(contextFeatures, mapLongitude), {
          style: contextRegionStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        L.geoJSON(featuresNearLongitudeCopies(refinedCountryFeatures, mapLongitude), {
          style: refinedCountryStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        L.geoJSON(featuresNearLongitudeCopies(cityContextFeatures, mapLongitude), {
          style: neutralRegionStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        L.geoJSON(featuresNearLongitudeCopies(taiwanAdminFeatures, mapLongitude), {
          style: taiwanAdminStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        L.geoJSON(featuresNearLongitudeCopies(greatLakeFeatures, mapLongitude), {
          style: lakeStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        L.geoJSON(featuresNearLongitudeCopies(localFeatures, mapLongitude), {
          style: neutralRegionStyle,
          interactive: false,
        }).addTo(nextContextLayer);

        featuresNearLongitudeCopies(allBoundaryFeatures, mapLongitude).forEach((feature) => {
          const name = regionName(feature);
          if (!name || !placeByName.has(name)) return;
          L.geoJSON(feature, {
            style: { fillOpacity: 0, opacity: 0, weight: 0 },
            onEachFeature: (_, layer) => {
              layer.on("click", () => {
                if (visited.has(name)) visited.delete(name);
                else visited.add(name);
                redrawVisited();
              });
            },
          }).addTo(nextContextLayer);
        });

        return nextContextLayer;
      };

      const renderMapLayers = () => {
        const mapLongitude = map.getCenter().lng;
        // Build both groups away from the map first. The old groups stay visible
        // until this complete bundle is ready, so a drag never exposes a clear
        // or partially rebuilt map.
        const nextContextLayer = buildContextLayer(mapLongitude);
        const nextVisitedLayer = buildVisitedLayer(mapLongitude);

        nextContextLayer.addTo(map);
        nextVisitedLayer.addTo(map);
        contextLayer.remove();
        visitedLayer.remove();
        contextLayer = nextContextLayer;
        visitedLayer = nextVisitedLayer;
      };

      let renderFrame = null;
      const scheduleMapRender = () => {
        if (renderFrame !== null) return;
        const render = () => {
          renderFrame = null;
          renderMapLayers();
        };
        if (typeof window.requestAnimationFrame === "function") {
          renderFrame = window.requestAnimationFrame(render);
        } else {
          render();
        }
      };

      map.on("move", () => {
        if (clampingLatitude) return;
        // The draggable predrag hook clamps before Leaflet projects the move.
        // Calling setView from inside an active drag would reset SVG paths and
        // make the map appear briefly unloaded at the pole.
        if (!map.dragging?.moving?.()) clampMapLatitude();
      });
      map.on("moveend", () => {
        normalizeMapLongitude();
        scheduleMapRender();
      });

      renderMapLayers();
      resetMapView(map);
    })
    .catch(() => {
      document.querySelector(".leaflet-map-tip").textContent =
        "Local map boundaries could not be loaded. Please check the bundled GeoJSON files.";
    });

  document.querySelector("[data-reset-map]")?.addEventListener("click", () => {
    visited.clear();
    visitedNames.forEach((name) => visited.add(name));
    redrawVisited();
    resetMapView(map);
  });
}

function resetMapView(map) {
  map.setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);
}

function viewportMinimumZoom(container) {
  const width = Number(container?.clientWidth) || 0;
  if (width <= 0) return MIN_MAP_ZOOM;

  const requiredWorldWidth = Math.max(256 * (2 ** MIN_MAP_ZOOM), width * WORLD_COVERAGE_MARGIN);
  const zoom = Math.log2(requiredWorldWidth / 256);
  return Math.max(MIN_MAP_ZOOM, Math.ceil(zoom * 2) / 2);
}

function clampMapCenterToViewport(map, center) {
  const fallbackLatitude = Math.max(
    -MAP_LATITUDE_LIMIT,
    Math.min(MAP_LATITUDE_LIMIT, center.lat)
  );
  if (
    fallbackLatitude !== center.lat &&
    typeof map?.getPixelWorldBounds !== "function"
  ) {
    return { lat: fallbackLatitude, lng: center.lng };
  }

  if (
    typeof map?.getPixelWorldBounds !== "function" ||
    typeof map?.project !== "function" ||
    typeof map?.unproject !== "function" ||
    typeof map?.getSize !== "function"
  ) {
    return { lat: fallbackLatitude, lng: center.lng };
  }

  const zoom = map.getZoom();
  const worldBounds = map.getPixelWorldBounds(zoom);
  const mapSize = map.getSize();
  if (
    !worldBounds?.min ||
    !worldBounds?.max ||
    !Number.isFinite(worldBounds.min.y) ||
    !Number.isFinite(worldBounds.max.y) ||
    !Number.isFinite(mapSize?.y)
  ) {
    return { lat: fallbackLatitude, lng: center.lng };
  }

  const halfViewportHeight = mapSize.y / 2;
  const minimumProjectedY = worldBounds.min.y + halfViewportHeight;
  const maximumProjectedY = worldBounds.max.y - halfViewportHeight;
  if (minimumProjectedY > maximumProjectedY) {
    return { lat: 0, lng: center.lng };
  }

  const projectedCenter = map.project(center, zoom);
  const boundedProjectedY = Math.max(
    minimumProjectedY,
    Math.min(maximumProjectedY, projectedCenter.y)
  );
  if (Math.abs(boundedProjectedY - projectedCenter.y) < 1e-8) {
    return { lat: center.lat, lng: center.lng };
  }

  const boundedLatitude = map.unproject(
    [projectedCenter.x, boundedProjectedY],
    zoom
  ).lat;
  return { lat: boundedLatitude, lng: center.lng };
}

function regionName(feature) {
  return feature.properties?.name || "";
}

function uniqueFeaturesByName(features) {
  const seen = new Set();
  return features.filter((feature) => {
    const name = regionName(feature);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

const featureLongitudeAnchors = new WeakMap();
const featureLongitudeRanges = new WeakMap();
const mergedDatelineGeometries = new WeakMap();

function featuresNearLongitude(features, mapLongitude) {
  return features.map((feature) => {
    if (featureCrossesDateline(feature)) {
      return shiftFeaturePartsNearLongitude(feature, mapLongitude);
    }

    const anchor = featureLongitudeAnchor(feature);
    const offset = Math.round((mapLongitude - anchor) / 360) * 360;
    return offset ? shiftFeatureLongitude(feature, offset) : feature;
  });
}

function featuresNearLongitudeCopies(features, mapLongitude) {
  // Keep one neighboring copy ready so Canvas always has geometry available
  // when the pane is dragged across the date line without tripling redraw cost.
  return featuresNearLongitude(features, mapLongitude).flatMap((feature) => [
    markWorldCopy(feature, 0),
    markWorldCopy(feature, -360),
  ]);
}

function markWorldCopy(feature, offset) {
  return {
    ...feature,
    properties: { ...feature.properties, __worldCopyOffset: offset },
    geometry: offset ? shiftGeometryLongitude(feature.geometry, offset) : feature.geometry,
  };
}

function featureCrossesDateline(feature) {
  const { min, max } = featureLongitudeRange(feature);
  return max - min > 180;
}

function featureLongitudeRange(feature) {
  if (featureLongitudeRanges.has(feature)) return featureLongitudeRanges.get(feature);
  let min = Infinity;
  let max = -Infinity;

  visitCoordinateLongitudes(feature.geometry?.coordinates, (longitude) => {
    min = Math.min(min, longitude);
    max = Math.max(max, longitude);
  });

  const range = min === Infinity ? { min: 0, max: 0 } : { min, max };
  featureLongitudeRanges.set(feature, range);
  return range;
}

function featureLongitudeAnchor(feature) {
  if (featureLongitudeAnchors.has(feature)) return featureLongitudeAnchors.get(feature);
  let total = 0;
  let count = 0;

  visitCoordinateLongitudes(feature.geometry?.coordinates, (longitude) => {
    total += longitude;
    count += 1;
  });

  const anchor = count ? total / count : 0;
  featureLongitudeAnchors.set(feature, anchor);
  return anchor;
}

function visitCoordinateLongitudes(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number") {
    visit(coordinates[0]);
    return;
  }
  coordinates.forEach((child) => visitCoordinateLongitudes(child, visit));
}

function shiftFeatureLongitude(feature, offset) {
  return {
    ...feature,
    properties: { ...feature.properties },
    geometry: shiftGeometryLongitude(feature.geometry, offset),
  };
}

function shiftFeaturePartsNearLongitude(feature, mapLongitude) {
  const geometry = mergedDatelineGeometry(feature.geometry);
  return {
    ...feature,
    properties: { ...feature.properties },
    geometry: shiftGeometryPartsNearLongitude(geometry, mapLongitude),
  };
}

function mergedDatelineGeometry(geometry) {
  if (!geometry || geometry.type !== "MultiPolygon") return geometry;
  if (mergedDatelineGeometries.has(geometry)) return mergedDatelineGeometries.get(geometry);

  const polygons = geometry.coordinates || [];
  const mergedPolygons = [];
  const consumed = new Set();

  polygons.forEach((polygon, index) => {
    if (consumed.has(index)) return;
    const edge = datelineEdge(polygon?.[0]);
    if (!edge) {
      mergedPolygons.push(polygon);
      return;
    }

    const partnerIndex = polygons.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === index || consumed.has(candidateIndex)) return false;
      const candidateEdge = datelineEdge(candidate?.[0]);
      return candidateEdge && edge.sign !== candidateEdge.sign && matchingDatelineSpan(edge, candidateEdge);
    });

    if (partnerIndex === -1) {
      mergedPolygons.push(polygon);
      return;
    }

    const partner = polygons[partnerIndex];
    const merged = mergeDatelinePolygons(polygon, edge, partner, datelineEdge(partner[0]));
    if (!merged) {
      mergedPolygons.push(polygon);
      return;
    }

    consumed.add(index);
    consumed.add(partnerIndex);
    mergedPolygons.push(merged);
  });

  const result = { ...geometry, coordinates: mergedPolygons };
  mergedDatelineGeometries.set(geometry, result);
  return result;
}

function datelineEdge(ring) {
  if (!Array.isArray(ring)) return null;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (
      isDatelineLongitude(start?.[0]) &&
      isDatelineLongitude(end?.[0]) &&
      Math.abs(start[0] - end[0]) < 1e-6 &&
      Math.abs(start[1] - end[1]) > 1e-6
    ) {
      return { index, start, end, sign: start[0] > 0 ? 1 : -1 };
    }
  }
  return null;
}

function isDatelineLongitude(longitude) {
  return typeof longitude === "number" && Math.abs(Math.abs(longitude) - 180) < 1e-6;
}

function matchingDatelineSpan(first, second) {
  const firstLatitudes = [first.start[1], first.end[1]].sort((a, b) => a - b);
  const secondLatitudes = [second.start[1], second.end[1]].sort((a, b) => a - b);
  return firstLatitudes.every((latitude, index) => Math.abs(latitude - secondLatitudes[index]) < 1e-5);
}

function mergeDatelinePolygons(firstPolygon, firstEdge, secondPolygon, secondEdge) {
  let positivePolygon = firstPolygon;
  let positiveEdge = firstEdge;
  let negativePolygon = secondPolygon;
  let negativeEdge = secondEdge;
  if (positiveEdge.sign < 0) {
    positivePolygon = secondPolygon;
    positiveEdge = secondEdge;
    negativePolygon = firstPolygon;
    negativeEdge = firstEdge;
  }

  const shiftedNegativePolygon = shiftCoordinatesLongitude(negativePolygon, 360);
  const positivePath = pathWithoutDatelineEdge(positivePolygon[0], positiveEdge);
  const negativePath = pathWithoutDatelineEdge(shiftedNegativePolygon[0], negativeEdge);
  const outerRing = concatenateDatelinePaths(positivePath, negativePath);
  if (!outerRing) return null;

  return [
    outerRing,
    ...positivePolygon.slice(1),
    ...shiftedNegativePolygon.slice(1),
  ];
}

function pathWithoutDatelineEdge(ring, edge) {
  const ringLength = ring.length - 1;
  const path = [];
  for (let step = 0; step < ringLength; step += 1) {
    path.push(ring[(edge.index + 1 + step) % ringLength]);
  }
  return path;
}

function concatenateDatelinePaths(firstPath, secondPath) {
  let continuation = secondPath;
  if (!sameCoordinate(firstPath.at(-1), continuation[0])) {
    continuation = [...continuation].reverse();
  }
  if (!sameCoordinate(firstPath.at(-1), continuation[0])) return null;

  const ring = [...firstPath, ...continuation.slice(1)];
  if (!sameCoordinate(ring[0], ring.at(-1))) ring.push([...ring[0]]);
  return ring;
}

function sameCoordinate(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    Math.abs(first[0] - second[0]) < 1e-6 &&
    Math.abs(first[1] - second[1]) < 1e-6
  );
}

function shiftGeometryPartsNearLongitude(geometry, mapLongitude) {
  if (!geometry) return geometry;
  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((child) =>
        shiftGeometryPartsNearLongitude(child, mapLongitude)
      ),
    };
  }

  const multiGeometry = ["MultiPolygon", "MultiLineString", "MultiPoint"].includes(geometry.type);
  if (!multiGeometry) {
    const offset = longitudeOffset(coordinatePartLongitudeAnchor(geometry.coordinates), mapLongitude);
    return shiftGeometryLongitude(geometry, offset);
  }

  return {
    ...geometry,
    coordinates: geometry.coordinates.map((part) => {
      const offset = longitudeOffset(coordinatePartLongitudeAnchor(part), mapLongitude);
      return shiftCoordinatesLongitude(part, offset);
    }),
  };
}

function longitudeOffset(anchor, mapLongitude) {
  return Math.round((mapLongitude - anchor) / 360) * 360;
}

function coordinatePartLongitudeAnchor(coordinates) {
  const longitudes = [];
  visitCoordinateLongitudes(coordinates, (longitude) => longitudes.push(longitude));
  if (!longitudes.length) return 0;

  const reference = longitudes[0];
  let total = 0;
  longitudes.forEach((longitude) => {
    let unwrapped = longitude;
    while (unwrapped - reference > 180) unwrapped -= 360;
    while (unwrapped - reference < -180) unwrapped += 360;
    total += unwrapped;
  });
  return total / longitudes.length;
}

function shiftGeometryLongitude(geometry, offset) {
  return {
    ...geometry,
    coordinates: shiftCoordinatesLongitude(geometry.coordinates, offset),
  };
}

function shiftCoordinatesLongitude(coordinates, offset) {
  if (typeof coordinates?.[0] === "number") {
    const [longitude, latitude, ...rest] = coordinates;
    return [longitude + offset, latitude, ...rest];
  }
  return coordinates.map((child) => shiftCoordinatesLongitude(child, offset));
}

function neutralRegionStyle(feature) {
  const isDetailedCountryContext = DETAILED_CONTEXT_GROUPS.has(feature?.properties?.group);
  return {
    color: isDetailedCountryContext ? "#8d9aad" : "#aeb8c7",
    weight: isDetailedCountryContext ? 0.68 : 0.55,
    fillColor: "#f8fafc",
    fillOpacity: isDetailedCountryContext ? 0.84 : 0.42,
  };
}

function contextRegionStyle() {
  return {
    color: "#94a3b8",
    weight: 0.9,
    fillColor: "#f8fafc",
    fillOpacity: 0.84,
  };
}

function refinedCountryStyle() {
  return {
    color: "#7a889a",
    weight: 0.9,
    fillColor: "#f8fafc",
    fillOpacity: 0.84,
  };
}

function taiwanAdminStyle() {
  return {
    color: "#7c8999",
    weight: 0.78,
    fillColor: "#f8fafc",
    fillOpacity: 0.88,
  };
}

function lakeStyle() {
  return {
    color: "#7ca4bb",
    weight: 0.72,
    fillColor: "#eef7fb",
    fillOpacity: 1,
  };
}

function visitedRegionStyle(place) {
  const palette = {
    greaterChina: ["#000095", "#00006b"],
    korea: ["#C60C30", "#8d0922"],
    japan: ["#D66A35", "#9b4a24"],
    usa: ["#00205B", "#00153d"],
    singapore: ["#EF3340", "#aa1f2a"],
  };
  const key = ["korea", "japan", "usa", "singapore"].includes(place?.group) ? place.group : "greaterChina";
  const [fillColor, color] = palette[key];
  return {
    color,
    weight: 1.05,
    opacity: 0.88,
    fillColor,
    fillOpacity: 0.44,
  };
}

function renderVisitedSummary() {
  const container = document.querySelector("#visited-place-summary");
  if (!container) return;

  container.innerHTML = travelSummaryGroups.map((group) => {
    const places = travelVisitedPlaces.filter((place) =>
      group.key === "boundary" ? place.type === "boundary" && !place.group : place.group === group.key
    );
    const tags = places.map((place) => `<span class="visited-tag">${place.label}</span>`).join("");
    return `
      <section class="visited-group">
        <h3>${group.title}</h3>
        <div class="visited-tags">${tags}</div>
      </section>
    `;
  }).join("");
}

function validateVisitedPlaces() {
  const warnings = [];
  const labels = new Set();

  travelVisitedPlaces.forEach((place, index) => {
    const labelKey = `${place.type}:${place.label}`;
    if (!place.label) warnings.push(`VISITED_PLACES[${index}] is missing label.`);
    if (labels.has(labelKey)) warnings.push(`Duplicate visited label for ${place.type}: ${place.label}.`);
    labels.add(labelKey);

    if (place.type === "boundary") {
      if (!Array.isArray(place.names) || place.names.length === 0) {
        warnings.push(`${place.label || `VISITED_PLACES[${index}]`} boundary entry needs names.`);
      }
    } else if (place.type === "marker") {
      warnings.push(`${place.label || `VISITED_PLACES[${index}]`} marker entries are not rendered. Use boundary polygons.`);
    } else {
      warnings.push(`${place.label || `VISITED_PLACES[${index}]`} has unknown type "${place.type}".`);
    }
  });

  if (warnings.length) console.warn(`Travel map data warnings:\n${warnings.join("\n")}`);
}

window.addEventListener("load", () => {
  validateVisitedPlaces();
  // renderVisitedSummary();
  renderTravelMap();
});
