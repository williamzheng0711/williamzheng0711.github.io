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
  const map = L.map(container, {
    attributionControl: false,
    zoomControl: true,
    scrollWheelZoom: true,
    zoomDelta: 0.5,
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 120,
    minZoom: MIN_MAP_ZOOM,
    inertia: false,
  }).setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);

  const latitudeDraggable = map.dragging?._draggable;
  if (latitudeDraggable?.on) {
    latitudeDraggable.on("predrag", () => {
      const centerPoint = map.getSize().divideBy(2);
      const candidateLayerPoint = centerPoint.subtract(latitudeDraggable._newPos);
      const candidateCenter = map.layerPointToLatLng(candidateLayerPoint);
      const boundedLatitude = Math.max(
        -MAP_LATITUDE_LIMIT,
        Math.min(MAP_LATITUDE_LIMIT, candidateCenter.lat)
      );
      if (boundedLatitude === candidateCenter.lat) return;

      const targetLayerPoint = map.latLngToLayerPoint([boundedLatitude, candidateCenter.lng]);
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

  const visitedLayer = L.featureGroup().addTo(map);
  const contextLayer = L.featureGroup().addTo(map);
  const visited = new Set(visitedNames);
  let renderedAtLongitude = null;
  let clampingLatitude = false;
  let normalizingLongitude = false;
  let redrawVisited = () => {};
  const clampMapLatitude = () => {
    if (clampingLatitude) return false;
    const center = map.getCenter();
    const latitude = Math.max(-MAP_LATITUDE_LIMIT, Math.min(MAP_LATITUDE_LIMIT, center.lat));
    if (latitude === center.lat) return false;

    clampingLatitude = true;
    map.setView([latitude, center.lng], map.getZoom(), { animate: false });
    clampingLatitude = false;
    return true;
  };
  const normalizeMapLongitude = () => {
    if (normalizingLongitude) return false;
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

      redrawVisited = function () {
        visitedLayer.clearLayers();
        const renderedFeatures = allBoundaryFeatures.filter((feature) => visited.has(regionName(feature)));
        L.geoJSON(featuresNearLongitude(renderedFeatures, map.getCenter().lng), {
          style: (feature) => visitedRegionStyle(placeByName.get(regionName(feature))),
          onEachFeature: (feature, layer) => {
            const name = regionName(feature);
            layer.bindTooltip(placeByName.get(name)?.label || name);
            layer.on("click", () => {
              visited.delete(name);
              redrawVisited();
            });
          },
        }).addTo(visitedLayer);

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

      const renderMapLayers = () => {
        const mapLongitude = map.getCenter().lng;
        renderedAtLongitude = mapLongitude;
        contextLayer.clearLayers();

        L.geoJSON(featuresNearLongitude(contextFeatures, mapLongitude), {
          style: contextRegionStyle,
          interactive: false,
        }).addTo(contextLayer);

        L.geoJSON(featuresNearLongitude(refinedCountryFeatures, mapLongitude), {
          style: refinedCountryStyle,
          interactive: false,
        }).addTo(contextLayer);

        L.geoJSON(featuresNearLongitude(cityContextFeatures, mapLongitude), {
          style: neutralRegionStyle,
          interactive: false,
        }).addTo(contextLayer);

        L.geoJSON(featuresNearLongitude(taiwanAdminFeatures, mapLongitude), {
          style: taiwanAdminStyle,
          interactive: false,
        }).addTo(contextLayer);

        L.geoJSON(featuresNearLongitude(greatLakeFeatures, mapLongitude), {
          style: lakeStyle,
          interactive: false,
        }).addTo(contextLayer);

        L.geoJSON(featuresNearLongitude(localFeatures, mapLongitude), {
          style: neutralRegionStyle,
          interactive: false,
        }).addTo(contextLayer);

        featuresNearLongitude(allBoundaryFeatures, mapLongitude).forEach((feature) => {
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
          }).addTo(contextLayer);
        });

        redrawVisited();
      };

      map.on("move", () => {
        if (clampingLatitude || normalizingLongitude) return;
        clampMapLatitude();
        const longitudeWasNormalized = normalizeMapLongitude();
        if (renderedAtLongitude === null) return;
        if (longitudeWasNormalized || Math.abs(map.getCenter().lng - renderedAtLongitude) > 180) {
          renderMapLayers();
        }
      });
      map.on("moveend", renderMapLayers);

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

function featuresNearLongitude(features, mapLongitude) {
  return features.map((feature) => {
    const anchor = featureLongitudeAnchor(feature);
    const offset = Math.round((mapLongitude - anchor) / 360) * 360;
    return offset ? shiftFeatureLongitude(feature, offset) : feature;
  });
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
