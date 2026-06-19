const DEFAULT_VISITED = new Set(["上海市"]);
const DEFAULT_VISITED_CODES = new Set(["310000"]);
const DETAIL_CODES = [];
const CHINA_BASE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";
const DETAIL_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

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

function renderChinaMap() {
  const container = document.querySelector("#china-map");
  if (!container || !window.d3) return;

  const tip = d3.select(container).append("div").attr("class", "map-tip");
  tip.text("Loading China administrative boundaries...");

  const rect = container.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = window.matchMedia("(max-width: 760px)").matches ? 430 : 580;
  const visited = new Set(DEFAULT_VISITED);
  const visitedCodes = new Set(DEFAULT_VISITED_CODES);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const detailRequests = DETAIL_CODES.map((code) =>
    d3.json(`${DETAIL_BASE}/${code}_full.json`).catch(() => null)
  );

  Promise.all([d3.json(CHINA_BASE), ...detailRequests])
    .then(([china, ...details]) => {
      const baseFeatures = china.features || [];
      const detailFeatures = details.flatMap((item) => item?.features || []);
      const drawFeatures = [
        ...baseFeatures.filter((feature) => !DETAIL_CODES.includes(String(feature.properties?.adcode))),
        ...detailFeatures,
      ];

      const projection = d3
        .geoMercator()
        .center([104, 36])
        .scale(Math.min(width * 0.82, height * 1.05))
        .translate([width * 0.5, height * 0.52]);
      const path = d3.geoPath(projection);
      const map = svg.append("g");

      const zoom = d3
        .zoom()
        .scaleExtent([1, 7])
        .on("zoom", (event) => map.attr("transform", event.transform));

      svg.call(zoom);

      document.querySelector("[data-reset-map]")?.addEventListener("click", () => {
        visited.clear();
        visitedCodes.clear();
        DEFAULT_VISITED.forEach((name) => visited.add(name));
        DEFAULT_VISITED_CODES.forEach((code) => visitedCodes.add(code));
        updateVisited();
        svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity);
      });

      map
        .selectAll(".china-region")
        .data(drawFeatures)
        .join("path")
        .attr("class", (feature) => regionClass(feature, visited, visitedCodes))
        .attr("d", path)
        .on("click", (_, feature) => {
          const name = feature.properties?.name;
          if (!name) return;
          if (visited.has(name)) visited.delete(name);
          else visited.add(name);
          updateVisited();
        })
        .append("title")
        .text((feature) => feature.properties?.name || "行政区");

      map
        .selectAll(".province-outline")
        .data(baseFeatures)
        .join("path")
        .attr("class", "province-outline")
        .attr("d", path);

      const labelData = [
        { name: "Shanghai", coordinates: [121.4737, 31.2304], className: "marker-shanghai" },
        { name: "Hong Kong", coordinates: [114.1694, 22.3193], className: "marker-hk" },
        { name: "Taipei", coordinates: [121.5654, 25.033], className: "marker-taipei" },
      ];

      const markers = map
        .selectAll(".map-marker")
        .data(labelData)
        .join("g")
        .attr("class", (d) => `map-marker ${d.className}`)
        .attr("transform", (d) => `translate(${projection(d.coordinates)})`);

      markers.append("circle").attr("r", 4.5);

      map
        .selectAll(".map-label")
        .data(labelData)
        .join("text")
        .attr("class", "map-label")
        .attr("x", (d) => projection(d.coordinates)[0] + 7)
        .attr("y", (d) => projection(d.coordinates)[1] - 5)
        .text((d) => d.name);

      function updateVisited() {
        map.selectAll(".china-region").attr("class", (feature) => regionClass(feature, visited, visitedCodes));
        tip.text(`Highlighted: ${[...visited].join(", ")}, Hong Kong, Taipei. Click any visible region to toggle it.`);
      }

      updateVisited();
    })
    .catch(() => {
      tip.text("Map data could not be loaded. Please check the network connection and reload.");
    });
}

function regionClass(feature, visited, visitedCodes) {
  const name = feature.properties?.name || "";
  const code = String(feature.properties?.adcode || "");
  const parentCode = String(feature.properties?.parent?.adcode || "");
  const classes = ["china-region"];
  if (visited.has(name) || visitedCodes.has(code) || visitedCodes.has(parentCode)) {
    classes.push("visited");
  }
  if (name.includes("上海") || code === "310000" || parentCode === "310000") classes.push("shanghai");
  if (name.includes("台湾") || name.includes("臺灣") || code === "710000" || parentCode === "710000") {
    classes.push("taiwan");
  }
  return classes.join(" ");
}

window.addEventListener("load", renderChinaMap);
