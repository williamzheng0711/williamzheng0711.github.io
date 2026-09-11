import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import polygonClipping from "polygon-clipping";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputRoot = resolve(packageRoot, "data");

const sourceRoot = resolve(argumentValue("--source-dir") || process.env.JOURNEY_SPHERE_ATLAS_SOURCE_DIR || "atlas-sources");
const naturalEarthCountriesPath = resolve(sourceRoot, "ne_10m_admin_0_countries.geojson");
const naturalEarthLandPath = resolve(sourceRoot, "ne_10m_land.geojson");
const geoBoundariesRoot = resolve(argumentValue("--geoboundaries-dir") || resolve(sourceRoot, "geoboundaries"));
const preclippedRoot = argumentValue("--preclipped-dir") ? resolve(argumentValue("--preclipped-dir")) : null;
const chinaProvinceRoot = resolve(sourceRoot, "china-prefectures", "province");
const naturalEarthAdmin1Path = resolve(sourceRoot, "ne_10m_admin_1_states_provinces.geojson");

const SEMANTICS = {
  CAN: "census divisions and equivalents",
  JPN: "municipalities and equivalents",
  KOR: "provinces retain cities and counties; special and metropolitan cities are single regions",
  MYS: "districts",
  TWN: "counties and special municipalities (22 first-order divisions; selected as the prefecture-equivalent display unit)",
  USA: "counties and county equivalents",
};
const SMALL_COUNTRY_SHARDS = new Set(["SGP", "VAT", "HKG", "MAC"]);
const ADM0_FALLBACK_SHARDS = new Set(["ESH", "HMD", "JEY", "NFK", "PRI", "SOL", "UMI"]);
const COUNTRY_CODE_ALIASES = new Map([["KOS", "XKX"]]);
const CHINA_EXCLUDED_PROVINCES = new Set(["台湾省.json", "香港特别行政区.json", "澳门特别行政区.json"]);
const CHINA_MUNICIPALITIES = new Set(["北京市.json", "上海市.json", "天津市.json", "重庆市.json"]);

const SOURCE_INFO = {
  naturalEarth: {
    name: "Natural Earth",
    version: "repository snapshot (build input is content-addressed in catalog.json)",
    license: "Public domain",
    url: "https://github.com/nvkelso/natural-earth-vector",
    role: "global country context and 10m physical land mask",
  },
  geoBoundaries: {
    name: "geoBoundaries gbOpen",
    version: "6.0.0 pinned source files",
    license: "Open licenses vary by shard; inspect each catalog country sourceLicense/sourceLicenseUrl",
    attribution: "Runfola et al. (2020), geoBoundaries: A global database of political administrative boundaries.",
    url: "https://www.geoboundaries.org/",
    role: "packaged ADM2 country shards",
  },
  chinaPrefectures: {
    name: "ChinaGeoJson",
    version: "repository snapshot (build input is content-addressed in catalog.json)",
    license: "Repository declares MIT; upstream DataV.GeoAtlas data terms are not independently stated",
    attribution: "zhChuXiao/ChinaGeoJson; boundary data collected from DataV.GeoAtlas.",
    url: "https://github.com/zhChuXiao/ChinaGeoJson",
    role: "China prefecture-level divisions with GB/T 2260-style adcodes",
  },
};

for (const requiredPath of [naturalEarthCountriesPath, naturalEarthLandPath, geoBoundariesRoot, chinaProvinceRoot]) {
  if (!existsSync(requiredPath)) throw new Error(`Missing atlas build input: ${requiredPath}`);
}

const [countrySource, landSource] = await Promise.all([
  readJson(naturalEarthCountriesPath),
  readJson(naturalEarthLandPath),
]);
const countryFeatures = dissolveCountries(countrySource.features.map(normalizeCountry).filter(Boolean));
const countryByCode = new Map(countryFeatures.map((feature) => [feature.properties.countryCode, feature]));
const landPolygons = (landSource.features || []).flatMap((feature) => multiPolygonCoordinates(feature.geometry));
const landParts = landPolygons.map((coordinates) => ({ coordinates, bbox: geometryBounds({ type: "Polygon", coordinates }) }));

await mkdir(resolve(outputRoot, "countries"), { recursive: true });
await writeJson(resolve(outputRoot, "world.geojson"), featureCollection(countryFeatures));

const catalogCountries = Object.fromEntries(countryFeatures.map((feature) => {
  const { countryCode, name } = feature.properties;
  return [countryCode, {
    name,
    file: null,
    coverage: "country-only",
    adminLevel: 0,
    semantics: "country outline; detailed shard not bundled",
    source: "naturalEarth",
    featureCount: 0,
  }];
}));
const allRegionIds = [];

const detailSources = await discoverDetailSources(geoBoundariesRoot);
for (const config of detailSources) {
  const { countryCode } = config;
  if (countryCode === "CHN") continue;
  const sourcePath = preclippedRoot && existsSync(resolve(preclippedRoot, config.file))
    ? resolve(preclippedRoot, config.file)
    : resolve(geoBoundariesRoot, config.file);
  const alreadyClipped = Boolean(preclippedRoot && sourcePath.startsWith(preclippedRoot));
  const source = await readJson(sourcePath);
  const counters = { clipped: 0, dropped: 0, ids: [] };
  const features = source.features.map((feature) => {
    const sourceCode = String(feature.properties?.shapeID || "");
    const name = String(feature.properties?.shapeName || "Unnamed region");
    const regionId = `${countryCode}:ADM${config.adminLevel}:${sourceCode || stableHash(`${name}:${JSON.stringify(feature.geometry)}`)}`;
    const rawGeometry = alreadyClipped ? roundGeometry(feature.geometry) : clipToLand(feature.geometry, landParts, counters);
    const geometry = normalizePolygonalGeometry(rawGeometry);
    if (!geometry) {
      if (alreadyClipped || rawGeometry) counters.dropped += 1;
      counters.ids.push(regionId);
      return null;
    }
    return {
      type: "Feature",
      properties: {
        id: regionId,
        name,
        countryCode,
        adminLevel: config.adminLevel,
        sourceCode: sourceCode || null,
      },
      geometry,
    };
  }).filter(Boolean).sort(compareFeatureIds);
  const relativeFile = `countries/${countryCode}.geojson`;
  const outputPath = resolve(outputRoot, relativeFile);
  await writeJson(outputPath, featureCollection(features));
  if (!countryByCode.has(countryCode) && features.length) {
    const outline = countryOutlineFromRegions(countryCode, config.metadata?.source?.boundaryName || countryCode, features);
    countryFeatures.push(outline);
    countryByCode.set(countryCode, outline);
  }
  allRegionIds.push(...features.map((feature) => feature.properties.id));
  catalogCountries[countryCode] = {
    name: countryByCode.get(countryCode)?.properties.name || countryCode,
    file: relativeFile,
    coverage: counters.dropped > 0 ? "partial" : config.adminLevel === 2 || countryCode === "TWN" ? "complete" : config.adminLevel === 0 ? "small-country" : "fallback",
    adminLevel: config.adminLevel,
    semantics: SEMANTICS[countryCode] || (config.adminLevel === 2 ? "source-defined second-order administrative divisions" : "fallback administrative coverage; ADM2 unavailable from pinned source"),
    source: "geoBoundaries",
    sourceAdminLevel: config.sourceLevel,
    sourceName: config.metadata?.source?.boundarySource || "geoBoundaries gbOpen",
    sourceLicense: config.metadata?.source?.boundaryLicense || "CC BY 4.0",
    sourceLicenseUrl: config.metadata?.source?.licenseSource || "https://www.geoboundaries.org/",
    featureCount: features.length,
    landClipped: true,
    droppedAfterLandClip: counters.dropped,
    droppedRegionIds: counters.ids.sort(),
    sha256: await sha256(outputPath),
  };
}

const preclippedChinaPath = preclippedRoot ? resolve(preclippedRoot, "CHN_ADM2.geojson") : null;
const chinaFeatures = preclippedChinaPath && existsSync(preclippedChinaPath)
  ? normalizePreparedFeatures(await readJson(preclippedChinaPath), "CHN", 2)
  : await buildChinaPrefectures(chinaProvinceRoot, landParts);
const chinaPath = resolve(outputRoot, "countries/CHN.geojson");
await writeJson(chinaPath, featureCollection(chinaFeatures));
allRegionIds.push(...chinaFeatures.map((feature) => feature.properties.id));
catalogCountries.CHN = {
  name: countryByCode.get("CHN")?.properties.name || "China",
  file: "countries/CHN.geojson",
  coverage: "complete",
  adminLevel: 2,
  semantics: "prefecture-level divisions; direct-controlled municipalities are single regions",
  source: "chinaPrefectures",
  sourceAdminLevel: 2,
  sourceName: "zhChuXiao/ChinaGeoJson (DataV.GeoAtlas upstream)",
  sourceLicense: "Repository declares MIT; upstream DataV terms not independently stated",
  sourceLicenseUrl: "https://github.com/zhChuXiao/ChinaGeoJson",
  featureCount: chinaFeatures.length,
  landClipped: true,
  sha256: await sha256(chinaPath),
};

for (const countryFeature of countryFeatures) {
  const countryCode = countryFeature.properties.countryCode;
  if (catalogCountries[countryCode]?.file) continue;
  if (!SMALL_COUNTRY_SHARDS.has(countryCode) && !ADM0_FALLBACK_SHARDS.has(countryCode) && !countryFeature.properties.smallCountry) continue;
  if (!countryFeature) continue;
  const feature = {
    type: "Feature",
    properties: {
      id: `${countryCode}:ADM0:${countryCode}`,
      name: countryFeature.properties.name,
      countryCode,
      adminLevel: 0,
      sourceCode: countryCode,
    },
    geometry: countryFeature.geometry,
  };
  const outputPath = resolve(outputRoot, `countries/${countryCode}.geojson`);
  await writeJson(outputPath, featureCollection([feature]));
  allRegionIds.push(feature.properties.id);
  catalogCountries[countryCode] = {
    name: countryFeature.properties.name,
    file: `countries/${countryCode}.geojson`,
    coverage: "complete",
    adminLevel: 0,
    semantics: "small-country exception; represented as one country region",
    source: "naturalEarth",
    featureCount: 1,
    landClipped: true,
    sha256: await sha256(outputPath),
  };
}

countryFeatures.sort((a, b) => a.properties.countryCode.localeCompare(b.properties.countryCode));
await writeJson(resolve(outputRoot, "world.geojson"), featureCollection(countryFeatures));

const catalog = {
  version: "journeysphere-atlas-v2",
  datasetId: "journeysphere-atlas-v2",
  generatedAt: process.env.JOURNEY_SPHERE_GENERATED_AT || "reproducible-build",
  countryCodeStandard: "ISO 3166-1 alpha-3",
  defaultAdminLevel: 2,
  smallCountryPolicy: "Countries where subdivision adds noise may use one ADM0 region; bundled exception: SGP.",
  waterPolicy: "Detailed regions are intersected with the Natural Earth 10m physical-land mask. Inland holes are preserved; marine administrative areas are removed.",
  coveragePolicy: "A country-only entry is explicit planned lazy coverage, not ADM2 completeness.",
  worldFile: "world.geojson",
  paletteFile: "palette.json",
  regionIds: allRegionIds.sort(),
  countries: Object.fromEntries(Object.entries(catalogCountries).sort(([a], [b]) => a.localeCompare(b))),
  sources: SOURCE_INFO,
  inputChecksums: {
    naturalEarthCountries: await sha256(naturalEarthCountriesPath),
    naturalEarthLand: await sha256(naturalEarthLandPath),
  },
};
await writeJson(resolve(outputRoot, "catalog.json"), catalog);
if (existsSync(naturalEarthAdmin1Path)) {
  const python = process.env.JOURNEY_SPHERE_PYTHON || "python3";
  execFileSync(python, [
    resolve(scriptDirectory, "attach-admin1.py"),
    "--admin1", naturalEarthAdmin1Path,
    "--china-province-dir", chinaProvinceRoot,
    "--data-dir", outputRoot,
  ], { stdio: "inherit" });
}
const paletteBuilderPath = resolve(scriptDirectory, "build-palette.mjs");
if (existsSync(paletteBuilderPath)) execFileSync(process.execPath, [paletteBuilderPath], { stdio: "inherit" });

console.log(`Built ${countryFeatures.length} country outlines and ${allRegionIds.length} stable region IDs.`);
console.log(`Detailed shards: ${Object.values(catalogCountries).filter((country) => country.file).length}; planned country-only entries: ${Object.values(catalogCountries).filter((country) => !country.file).length}.`);

async function buildChinaPrefectures(directory, land) {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".json") && !CHINA_EXCLUDED_PROVINCES.has(name)).sort();
  const features = [];
  for (const filename of filenames) {
    const source = await readJson(resolve(directory, filename));
    if (CHINA_MUNICIPALITIES.has(filename)) {
      const polygons = source.features.flatMap((feature) => multiPolygonCoordinates(feature.geometry));
      const united = polygonClipping.union(...polygons.map((polygon) => [polygon]));
      const geometry = clipToLand(fromMultiPolygon(united), land, { clipped: 0, dropped: 0 });
      const provinceCode = String(source.features[0]?.properties?.parent?.adcode || source.features[0]?.properties?.acroutes?.[1] || "");
      const name = filename.replace(/\.json$/, "");
      features.push(makeChinaFeature(provinceCode, name, geometry));
      continue;
    }
    for (const feature of source.features) {
      const code = String(feature.properties?.adcode || "");
      const geometry = clipToLand(feature.geometry, land, { clipped: 0, dropped: 0 });
      if (geometry) features.push(makeChinaFeature(code, String(feature.properties?.name || code), geometry));
    }
  }
  return features.sort(compareFeatureIds);
}

function makeChinaFeature(code, name, geometry) {
  return {
    type: "Feature",
    properties: { id: `CHN:ADM2:${code}`, name, countryCode: "CHN", adminLevel: 2, sourceCode: code },
    geometry,
  };
}

function normalizePreparedFeatures(source, countryCode, adminLevel) {
  return source.features.map((feature) => {
    const code = String(feature.properties?.shapeID || feature.properties?.sourceCode || "");
    const geometry = normalizePolygonalGeometry(roundGeometry(feature.geometry));
    if (!geometry) return null;
    return {
      type: "Feature",
      properties: {
        id: `${countryCode}:ADM${adminLevel}:${code}`,
        name: String(feature.properties?.shapeName || feature.properties?.name || code),
        countryCode,
        adminLevel,
        sourceCode: code,
      },
      geometry,
    };
  }).filter(Boolean).sort(compareFeatureIds);
}

function countryOutlineFromRegions(countryCode, name, features) {
  const polygons = features.flatMap((feature) => multiPolygonCoordinates(feature.geometry));
  return {
    type: "Feature",
    properties: {
      countryCode,
      iso3: countryCode,
      name,
      nameZhHans: null,
      nameZhHant: null,
      mapColorSlot: 1,
    },
    geometry: fromMultiPolygon(polygonClipping.union(...polygons.map((polygon) => [polygon]))),
  };
}

function normalizeCountry(feature) {
  const properties = feature.properties || {};
  const rawCountryCode = [properties.ISO_A3, properties.ISO_A3_EH, properties.ADM0_A3]
    .find((value) => /^[A-Z]{3}$/.test(String(value || "")));
  if (!rawCountryCode) return null;
  const countryCode = COUNTRY_CODE_ALIASES.get(rawCountryCode) || rawCountryCode;
  return {
    type: "Feature",
    properties: {
      countryCode,
      iso3: countryCode,
      name: properties.NAME_EN || properties.NAME_LONG || properties.ADMIN || properties.NAME,
      nameZhHans: properties.NAME_ZH || null,
      nameZhHant: properties.NAME_ZHT || null,
      mapColorSlot: Number(properties.MAPCOLOR13) || 1,
      smallCountry: properties.TINY !== undefined && Number(properties.TINY) !== -99,
    },
    geometry: roundGeometry(feature.geometry),
  };
}

function dissolveCountries(features) {
  const grouped = new Map();
  for (const feature of features) {
    const code = feature.properties.countryCode;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(feature);
  }
  return [...grouped.entries()].map(([code, parts]) => {
    if (parts.length === 1) return parts[0];
    const polygons = parts.flatMap((feature) => multiPolygonCoordinates(feature.geometry));
    return { ...parts[0], geometry: fromMultiPolygon(polygonClipping.union(...polygons.map((polygon) => [polygon]))) };
  }).sort((a, b) => a.properties.countryCode.localeCompare(b.properties.countryCode));
}

async function discoverDetailSources(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".geojson")).sort();
  const metadataPath = resolve(directory, "metadata.json");
  const metadata = existsSync(metadataPath) ? await readJson(metadataPath) : null;
  const metadataByCountry = new Map((metadata?.files || []).map((entry) => [entry.iso3, entry]));
  const selected = new Map();
  for (const file of files) {
    const match = file.match(/^([A-Z]{3})(?:_ADM([012]))?\.geojson$/);
    if (!match) continue;
    const countryCode = match[1];
    const metadataEntry = metadataByCountry.get(countryCode);
    const sourceLevel = Number(String(metadataEntry?.sourceLevel || match[2] || (countryCode === "TWN" ? "ADM1" : "ADM2")).replace("ADM", ""));
    const adminLevel = Number(metadataEntry?.displayAdminLevel ?? sourceLevel);
    const prior = selected.get(countryCode);
    if (!prior || adminLevel > prior.adminLevel || countryCode === "TWN") {
      selected.set(countryCode, { countryCode, adminLevel, sourceLevel, metadata: metadataEntry, file });
    }
  }
  return [...selected.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode));
}

function clipToLand(geometry, land, counters) {
  const subject = multiPolygonCoordinates(geometry);
  if (!subject.length) return null;
  const bbox = geometryBounds(geometry);
  const candidates = land.filter((part) => bboxOverlaps(bbox, part.bbox)).map((part) => part.coordinates);
  try {
    const clipped = polygonClipping.intersection(subject, candidates);
    if (!clipped.length) {
      counters.dropped += 1;
      return null;
    }
    counters.clipped += 1;
    return fromMultiPolygon(clipped);
  } catch (error) {
    throw new Error(`Land clipping failed for bbox ${bbox.join(",")}: ${error.message}`);
  }
}

function multiPolygonCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(multiPolygonCoordinates);
  return [];
}

function fromMultiPolygon(coordinates) {
  if (!coordinates.length) return null;
  const rounded = roundCoordinates(coordinates);
  return rounded.length === 1
    ? { type: "Polygon", coordinates: rounded[0] }
    : { type: "MultiPolygon", coordinates: rounded };
}

function roundGeometry(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  return { type: geometry.type, coordinates: roundCoordinates(geometry.coordinates) };
}

function normalizePolygonalGeometry(geometry) {
  if (!geometry) return null;
  const normalizePolygon = (polygon) => {
    if (!Array.isArray(polygon) || !isValidRing(polygon[0])) return null;
    return [polygon[0], ...polygon.slice(1).filter(isValidRing)];
  };
  if (geometry.type === "Polygon") {
    const polygon = normalizePolygon(geometry.coordinates);
    return polygon ? { type: "Polygon", coordinates: polygon } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates.map(normalizePolygon).filter(Boolean);
    if (!polygons.length) return null;
    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}

function isValidRing(ring) {
  return Array.isArray(ring)
    && ring.length >= 4
    && ring.every((position) => Array.isArray(position) && position.length >= 2 && position.every(Number.isFinite));
}

function roundCoordinates(value) {
  if (Array.isArray(value)) return value.map(roundCoordinates);
  return Number(Number(value).toFixed(5));
}

function geometryBounds(geometry) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const polygon of multiPolygonCoordinates(geometry)) {
    for (const ring of polygon) {
      for (const [longitude, latitude] of ring) {
        west = Math.min(west, longitude); south = Math.min(south, latitude);
        east = Math.max(east, longitude); north = Math.max(north, latitude);
      }
    }
  }
  return [west, south, east, north];
}

function bboxOverlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function compareFeatureIds(a, b) {
  return a.properties.id.localeCompare(b.properties.id);
}

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function argumentValue(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
