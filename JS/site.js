const CHINA_BASE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";
const CHINA_DETAIL_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";
const LOCAL_BOUNDARIES = "data/visited-boundaries.geojson";

const travelMapData = window.TRAVEL_MAP_DATA || {};
const travelProvinceCodes = travelMapData.PROVINCE_CODES || {};
const travelVisitedPlaces = travelMapData.VISITED_PLACES || [];
const travelSummaryGroups = travelMapData.SUMMARY_GROUPS || [];

const boundaryPlaces = travelVisitedPlaces.filter((place) => place.type === "boundary");
const datavBoundaryPlaces = boundaryPlaces.filter((place) => place.source !== "local");
const localBoundaryPlaces = boundaryPlaces.filter((place) => place.source === "local");
const detailCodes = [...new Set(datavBoundaryPlaces.map((place) => travelProvinceCodes[place.province]).filter(Boolean))];
const visitedNames = new Set(boundaryPlaces.flatMap((place) => place.names));
const placeByName = new Map(boundaryPlaces.flatMap((place) => place.names.map((name) => [name, place])));

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
  }).setView([31.5, 121.8], 4);

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
    "Loading administrative boundaries...";

  const detailRequests = detailCodes.map((code) =>
    fetch(`${CHINA_DETAIL_BASE}/${code}_full.json`).then((response) => response.json()).catch(() => null)
  );
  const localRequest = localBoundaryPlaces.length
    ? fetch(LOCAL_BOUNDARIES).then((response) => response.json()).catch(() => null)
    : Promise.resolve(null);

  Promise.all([fetch(CHINA_BASE).then((response) => response.json()).catch(() => null), ...detailRequests, localRequest])
    .then(([china, ...loaded]) => {
      const local = loaded.pop();
      const details = loaded;
      const baseFeatures = china?.features || [];
      const detailedProvinceCodes = new Set(detailCodes);
      const contextFeatures = baseFeatures.filter(
        (feature) => !detailedProvinceCodes.has(String(feature.properties?.adcode))
      );
      const detailFeatures = details.flatMap((item) => item?.features || []);
      const localFeatures = local?.features || [];
      const allBoundaryFeatures = [...contextFeatures, ...detailFeatures, ...localFeatures];

      L.geoJSON(contextFeatures, {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      L.geoJSON(detailFeatures, {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      L.geoJSON(localFeatures, {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      redrawVisited = function () {
        visitedLayer.clearLayers();
        const renderedFeatures = allBoundaryFeatures.filter((feature) => visited.has(regionName(feature)));
        L.geoJSON(renderedFeatures, {
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
          `Highlighted: ${labels.join(", ") || "none"}.`,
          missingCount > 0 ? `${missingCount} boundary data source${missingCount === 1 ? "" : "s"} unavailable.` : "",
          "Click a colored city to toggle it.",
        ].filter(Boolean).join(" ");
      };

      allBoundaryFeatures.forEach((feature) => {
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
      const bounds = visitedLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.28), { maxZoom: 5 });
    })
    .catch(() => {
      document.querySelector(".leaflet-map-tip").textContent =
        "Administrative boundaries could not be loaded. Please check the network connection and reload.";
    });

  document.querySelector("[data-reset-map]")?.addEventListener("click", () => {
    visited.clear();
    visitedNames.forEach((name) => visited.add(name));
    redrawVisited();
    const bounds = visitedLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.28), { maxZoom: 5 });
  });
}

function regionName(feature) {
  return feature.properties?.name || "";
}

function neutralRegionStyle() {
  return {
    color: "#aeb8c7",
    weight: 0.55,
    fillColor: "#f8fafc",
    fillOpacity: 0.58,
  };
}

function visitedRegionStyle(place) {
  const palette = {
    municipality: ["#ff8a3d", "#c95f15"],
    sar: ["#8b5cf6", "#6441c9"],
    taiwan: ["#2fa84f", "#1f7a3b"],
    korea: ["#2f7df6", "#1557c0"],
    japan: ["#ff8a3d", "#c95f15"],
    default: ["#2f7df6", "#1557c0"],
  };
  const [fillColor, color] = palette[place?.style || place?.group || "default"];
  return {
    color,
    weight: 1,
    fillColor,
    fillOpacity: 0.56,
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
      if (place.province && !travelProvinceCodes[place.province]) {
        warnings.push(`${place.label} uses unknown province "${place.province}". Add it to PROVINCE_CODES.`);
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
  renderVisitedSummary();
  renderTravelMap();
});
