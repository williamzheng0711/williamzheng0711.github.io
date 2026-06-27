const LOCAL_BOUNDARIES = "data/visited-boundaries.geojson";
const CONTEXT_BOUNDARIES = "data/context-boundaries.geojson";
const CONTEXT_CITY_BOUNDARIES = "data/context-city-boundaries.geojson";

const travelMapData = window.TRAVEL_MAP_DATA || {};
const travelVisitedPlaces = travelMapData.VISITED_PLACES || [];
const travelSummaryGroups = travelMapData.SUMMARY_GROUPS || [];

const boundaryPlaces = travelVisitedPlaces.filter((place) => place.type === "boundary");
const visitedNames = new Set(boundaryPlaces.flatMap((place) => place.names));
const placeByName = new Map(boundaryPlaces.flatMap((place) => place.names.map((name) => [name, place])));
const INITIAL_MAP_CENTER = [31.5, 121.8];
const INITIAL_MAP_ZOOM = 4;
const MIN_MAP_ZOOM = 2;
const WORLD_LONGITUDE_OFFSETS = [-360, 0, 360];
const DETAILED_CONTEXT_GROUPS = new Set([
  "context-canada",
  "context-japan",
  "context-korea",
  "context-malaysia",
  "context-singapore",
  "context-usa",
]);

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
    worldCopyJump: true,
  }).setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);

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
  let redrawVisited = () => {};

  document.querySelector(".leaflet-map-tip").textContent =
    "Loading local map boundaries...";

  const localRequest = fetch(LOCAL_BOUNDARIES).then((response) => response.json()).catch(() => null);
  const contextRequest = fetch(CONTEXT_BOUNDARIES).then((response) => response.json()).catch(() => null);
  const cityContextRequest = fetch(CONTEXT_CITY_BOUNDARIES).then((response) => response.json()).catch(() => null);

  Promise.all([localRequest, contextRequest, cityContextRequest])
    .then(([local, context, cityContext]) => {
      const localFeatures = local?.features || [];
      const cityContextFeatures = cityContext?.features || [];
      const allBoundaryFeatures = uniqueFeaturesByName(localFeatures);

      L.geoJSON(worldCopies(context?.features || []), {
        style: contextRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      L.geoJSON(worldCopies(cityContextFeatures), {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      L.geoJSON(worldCopies(localFeatures), {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      redrawVisited = function () {
        visitedLayer.clearLayers();
        const renderedFeatures = allBoundaryFeatures.filter((feature) => visited.has(regionName(feature)));
        L.geoJSON(worldCopies(renderedFeatures), {
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

      worldCopies(allBoundaryFeatures).forEach((feature) => {
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

function worldCopies(features) {
  return features.flatMap((feature) =>
    WORLD_LONGITUDE_OFFSETS.map((offset) => shiftFeatureLongitude(feature, offset))
  );
}

function shiftFeatureLongitude(feature, offset) {
  if (!offset || !feature?.geometry) return feature;
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
    const [lng, lat, ...rest] = coordinates;
    return [lng + offset, lat, ...rest];
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
