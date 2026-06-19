const CHINA_BASE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";
const CHINA_DETAIL_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

const travelMapData = window.TRAVEL_MAP_DATA || {};
const travelProvinceCodes = travelMapData.PROVINCE_CODES || {};
const travelVisitedPlaces = travelMapData.VISITED_PLACES || [];
const travelSummaryGroups = travelMapData.SUMMARY_GROUPS || [];

const boundaryPlaces = travelVisitedPlaces.filter((place) => place.type === "boundary");
const markerPlaces = travelVisitedPlaces.filter((place) => place.type === "marker");
const detailCodes = [...new Set(boundaryPlaces.map((place) => travelProvinceCodes[place.province]).filter(Boolean))];
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
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([31.5, 121.8], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 11,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const status = L.control({ position: "bottomleft" });
  status.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-map-tip");
    div.textContent = "Loading visited regions...";
    return div;
  };
  status.addTo(map);

  const visitedLayer = L.featureGroup().addTo(map);
  const contextLayer = L.featureGroup().addTo(map);
  const markerLayer = L.featureGroup().addTo(map);
  const visited = new Set(visitedNames);
  let redrawVisited = () => {};

  markerPlaces.forEach((place) => {
    const [lng, lat] = place.coordinates;
    L.circleMarker([lat, lng], markerStyle(place.group))
      .bindTooltip(place.label, {
        permanent: true,
        direction: tooltipDirection(place.group),
        offset: tooltipOffset(place),
        className: `place-tooltip tooltip-${place.group}`,
      })
      .addTo(markerLayer);
  });

  document.querySelector(".leaflet-map-tip").textContent =
    "City markers loaded. Loading administrative boundaries...";

  const markerBounds = markerLayer.getBounds();
  if (markerBounds.isValid()) map.fitBounds(markerBounds.pad(0.22), { maxZoom: 5 });

  const detailRequests = detailCodes.map((code) =>
    fetch(`${CHINA_DETAIL_BASE}/${code}_full.json`).then((response) => response.json()).catch(() => null)
  );

  Promise.all([fetch(CHINA_BASE).then((response) => response.json()), ...detailRequests])
    .then(([china, ...details]) => {
      const baseFeatures = china.features || [];
      const detailedProvinceCodes = new Set(detailCodes);
      const contextFeatures = baseFeatures.filter(
        (feature) => !detailedProvinceCodes.has(String(feature.properties?.adcode))
      );
      const detailFeatures = details.flatMap((item) => item?.features || []);
      const allBoundaryFeatures = [...contextFeatures, ...detailFeatures];

      L.geoJSON(contextFeatures, {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      L.geoJSON(detailFeatures, {
        style: neutralRegionStyle,
        interactive: false,
      }).addTo(contextLayer);

      redrawVisited = function () {
        visitedLayer.clearLayers();
        L.geoJSON(allBoundaryFeatures.filter((feature) => visited.has(regionName(feature))), {
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

        const labels = [...visited].map((name) => placeByName.get(name)?.label || name);
        document.querySelector(".leaflet-map-tip").textContent =
          `Highlighted: ${labels.join(", ")}. City markers show Taiwan, Korea, and Japan.`;
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
      const bounds = L.featureGroup([visitedLayer, markerLayer]).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.28), { maxZoom: 5 });
    })
    .catch(() => {
      document.querySelector(".leaflet-map-tip").textContent =
        "Administrative boundaries could not be loaded. City markers remain available.";
    });

  document.querySelector("[data-reset-map]")?.addEventListener("click", () => {
    visited.clear();
    visitedNames.forEach((name) => visited.add(name));
    redrawVisited();
    const bounds = L.featureGroup([visitedLayer, markerLayer]).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.28), { maxZoom: 5 });
  });
}

function regionName(feature) {
  return feature.properties?.name || "";
}

function neutralRegionStyle() {
  return {
    color: "#8c98aa",
    weight: 0.65,
    fillColor: "#f3f5f8",
    fillOpacity: 0.32,
  };
}

function visitedRegionStyle(place) {
  const palette = {
    municipality: ["#ff8a3d", "#c95f15"],
    sar: ["#8b5cf6", "#6441c9"],
    default: ["#2f7df6", "#1557c0"],
  };
  const [fillColor, color] = palette[place?.style || "default"];
  return {
    color,
    weight: 1.2,
    fillColor,
    fillOpacity: 0.5,
  };
}

function markerStyle(group) {
  const colors = {
    taiwan: "#2fa84f",
    korea: "#2f7df6",
    japan: "#ff8a3d",
    sar: "#8b5cf6",
  };
  return {
    radius: 5,
    color: "#ffffff",
    weight: 2,
    fillColor: colors[group] || "#2f7df6",
    fillOpacity: 0.95,
  };
}

function tooltipDirection(group) {
  if (group === "taiwan") return "right";
  if (group === "japan") return "top";
  return "right";
}

function tooltipOffset(place) {
  if (place.labelOffset) return L.point(place.labelOffset[0], place.labelOffset[1]);
  return L.point(6, -4);
}

function renderVisitedSummary() {
  const container = document.querySelector("#visited-place-summary");
  if (!container) return;

  container.innerHTML = travelSummaryGroups.map((group) => {
    const places = travelVisitedPlaces.filter((place) =>
      group.key === "boundary" ? place.type === "boundary" : place.group === group.key
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
      if (!Array.isArray(place.coordinates) || place.coordinates.length !== 2) {
        warnings.push(`${place.label || `VISITED_PLACES[${index}]`} marker entry needs [longitude, latitude].`);
      }
      if (place.labelOffset && (!Array.isArray(place.labelOffset) || place.labelOffset.length !== 2)) {
        warnings.push(`${place.label} labelOffset must be [x, y].`);
      }
      if (!place.group) warnings.push(`${place.label} marker entry needs group.`);
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
