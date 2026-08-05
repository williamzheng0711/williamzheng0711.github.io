import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const sourceDirectoryArgument = process.argv.find((argument) => argument.startsWith("--source-dir="));
const sourceDirectory = sourceDirectoryArgument && path.resolve(sourceDirectoryArgument.slice("--source-dir=".length));

if (!sourceDirectory || !fs.statSync(sourceDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("Usage: node JS/build-refined-map-data.mjs --source-dir=/path/to/downloaded-map-sources");
}

const ROOT = path.resolve(import.meta.dirname, "..");
const countrySource = readJson(path.join(sourceDirectory, "ne_10m_admin_0_countries_lakes.geojson"));
const lakeSource = readJson(path.join(sourceDirectory, "ne_10m_lakes.geojson"));
const northAmericaAdminSource = readJson(path.join(sourceDirectory, "ne_10m_admin_1_states_provinces_lakes.geojson"));
const taiwanAdminSource = JSON.parse(
  execFileSync("unzip", ["-p", path.join(sourceDirectory, "gadm41_TWN_2.json.zip")], { encoding: "utf8" })
);
const cityContextPath = path.join(ROOT, "data", "context-city-boundaries.geojson");
const contextBoundaryPath = path.join(ROOT, "data", "context-boundaries.geojson");
const visitedBoundaryPath = path.join(ROOT, "data", "visited-boundaries.geojson");
const contextBoundaries = readJson(contextBoundaryPath);
const cityContext = readJson(cityContextPath);
const visitedBoundaries = readJson(visitedBoundaryPath);

const TAIWAN_NAME_OVERRIDES = new Map([
  ["台北市", "臺北市"],
  ["台中", "臺中市"],
  ["台南", "臺南市"],
  ["台東縣", "臺東縣"],
  ["馬祖列島", "連江縣"],
]);
const TAIWAN_VISITED_LABELS = new Map([
  ["花蓮縣", "花蓮縣"],
  ["臺北市", "台北市"],
  ["新北市", "新北市"],
  ["南投縣", "南投縣"],
  ["桃園市", "桃園市"],
]);
const GREAT_LAKES = new Set(["Lake Erie", "Lake Ontario", "Lake Superior", "Lake Michigan", "Lake Huron"]);

const taiwanFeatures = taiwanAdminSource.features.map((feature) => {
  const name = canonicalTaiwanName(feature.properties.NL_NAME_2);
  return makeFeature(
    {
      name,
      group: "context-taiwan",
      kind: "taiwan-administration",
      source: "GADM 4.1 level 2",
    },
    feature.geometry
  );
});
const taiwanFeatureByName = new Map(taiwanFeatures.map((feature) => [feature.properties.name, feature]));

const chinaFeature = countrySource.features.find((feature) => feature.properties.ADM0_A3 === "CHN");
if (!chinaFeature) throw new Error("Natural Earth 10m China boundary was not found.");

const greatLakeFeatures = lakeSource.features
  .filter((feature) => GREAT_LAKES.has(feature.properties.name || feature.properties.name_en))
  .map((feature) => makeFeature(
    {
      name: feature.properties.name || feature.properties.name_en,
      group: "context-north-america",
      kind: "great-lake",
      source: "Natural Earth 10m lakes",
    },
    feature.geometry
  ));

if (greatLakeFeatures.length !== GREAT_LAKES.size) {
  throw new Error(`Expected ${GREAT_LAKES.size} Great Lakes, found ${greatLakeFeatures.length}.`);
}

const refinedContext = {
  type: "FeatureCollection",
  features: [
    makeFeature(
      {
        name: "China",
        group: "context-china",
        kind: "country-coastline",
        source: "Natural Earth 10m Admin 0 Countries (lakes)",
      },
      chinaFeature.geometry
    ),
    ...taiwanFeatures,
    ...greatLakeFeatures,
  ],
};

const northAmericaFeatures = northAmericaAdminSource.features
  .filter((feature) => feature.properties.adm0_a3 === "USA" || feature.properties.adm0_a3 === "CAN")
  .map((feature) => makeFeature(
    {
      name: feature.properties.name,
      group: feature.properties.adm0_a3 === "USA" ? "context-usa" : "context-canada",
      source: "Natural Earth 10m Admin 1 States/Provinces (lakes)",
    },
    feature.geometry
  ));

const usaFeatureCount = northAmericaFeatures.filter((feature) => feature.properties.group === "context-usa").length;
const canadaFeatureCount = northAmericaFeatures.filter((feature) => feature.properties.group === "context-canada").length;
if (usaFeatureCount !== 51 || canadaFeatureCount !== 13) {
  throw new Error(`Expected 51 United States and 13 Canada boundaries, found ${usaFeatureCount} and ${canadaFeatureCount}.`);
}

const upgradedCityContext = {
  ...cityContext,
  features: [
    ...cityContext.features.filter((feature) => !["context-usa", "context-canada"].includes(feature.properties?.group)),
    ...northAmericaFeatures,
  ],
};

const upgradedContextBoundaries = {
  ...contextBoundaries,
  features: contextBoundaries.features.filter((feature) => !["CHN", "TWN"].includes(feature.properties?.iso_a3)),
};

const updatedTaiwanVisitedFeatures = [...TAIWAN_VISITED_LABELS].map(([name, label]) => {
  const sourceFeature = taiwanFeatureByName.get(name);
  if (!sourceFeature) throw new Error(`Taiwan boundary was not found for ${name}.`);
  return makeFeature(
    {
      name,
      label,
      group: "taiwan",
      source: "GADM 4.1 level 2",
    },
    sourceFeature.geometry
  );
});

const upgradedVisitedBoundaries = {
  ...visitedBoundaries,
  features: [
    ...updatedTaiwanVisitedFeatures,
    ...visitedBoundaries.features.filter((feature) => feature.properties?.group !== "taiwan"),
  ],
};

writeJson(path.join(ROOT, "data", "refined-context-boundaries.geojson"), refinedContext);
writeJson(contextBoundaryPath, upgradedContextBoundaries);
writeJson(cityContextPath, upgradedCityContext);
writeJson(visitedBoundaryPath, upgradedVisitedBoundaries);

console.log(
  `Built refined map data: ${taiwanFeatures.length} Taiwan boundaries, ${greatLakeFeatures.length} Great Lakes, ` +
  `${usaFeatureCount} United States states/districts, and ${canadaFeatureCount} Canadian provinces/territories.`
);

function canonicalTaiwanName(name) {
  return TAIWAN_NAME_OVERRIDES.get(name) || name;
}

function makeFeature(properties, geometry) {
  return { type: "Feature", properties, geometry };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}
