import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(packageRoot, "data");
const catalog = await readJson(resolve(dataRoot, "catalog.json"));
const world = await readJson(resolve(dataRoot, catalog.worldFile));
const palette = await readJson(resolve(dataRoot, catalog.paletteFile));
const errors = [];
const countryCodes = world.features.map((feature) => feature.properties?.countryCode);

for (const code of countryCodes) {
  if (!/^[A-Z]{3}$/.test(code || "")) errors.push(`Invalid world countryCode: ${code}`);
  if (!catalog.countries[code]) errors.push(`World country missing from catalog: ${code}`);
  if (!palette[code]) errors.push(`World country missing from palette: ${code}`);
}
for (const feature of world.features) {
  if (!validPolygonalGeometry(feature.geometry)) errors.push(`World country has invalid or empty geometry: ${feature.properties?.countryCode}`);
}

const actualRegionIds = [];
for (const [code, country] of Object.entries(catalog.countries)) {
  if (!country.file) {
    if (country.coverage !== "country-only") errors.push(`${code}: missing file must be country-only`);
    continue;
  }
  const shardPath = resolve(dataRoot, country.file);
  const shard = await readJson(shardPath);
  const checksum = createHash("sha256").update(await readFile(shardPath)).digest("hex");
  if (checksum !== country.sha256) errors.push(`${code}: checksum mismatch`);
  if (shard.features.length !== country.featureCount) errors.push(`${code}: feature count mismatch`);
  const admin1Features = shard.admin1?.features || [];
  const admin1Ids = new Set(admin1Features.map((feature) => feature.properties?.id));
  if (admin1Features.length !== (country.admin1FeatureCount || 0)) errors.push(`${code}: ADM1 feature count mismatch`);
  for (const feature of admin1Features) {
    const properties = feature.properties || {};
    if (properties.countryCode !== code) errors.push(`${code}: ADM1 ${properties.id} countryCode mismatch`);
    if (!properties.id?.startsWith(`${code}:ADM1:`)) errors.push(`${code}: malformed ADM1 id ${properties.id}`);
    if (!validPolygonalGeometry(feature.geometry)) errors.push(`${code}: invalid ADM1 geometry ${properties.id}`);
  }
  let assignedCount = 0;
  for (const feature of shard.features) {
    const properties = feature.properties || {};
    actualRegionIds.push(properties.id);
    if (properties.countryCode !== code) errors.push(`${code}: feature ${properties.id} countryCode mismatch`);
    if (!properties.id?.startsWith(`${code}:ADM${properties.adminLevel}:`)) errors.push(`${code}: unstable/malformed region id ${properties.id}`);
    if (!validPolygonalGeometry(feature.geometry)) errors.push(`${code}: invalid or empty geometry ${properties.id}`);
    if (properties.parentId) {
      assignedCount += 1;
      if (!admin1Ids.has(properties.parentId)) errors.push(`${code}: missing ADM1 parent ${properties.parentId}`);
    }
  }
  if (assignedCount !== (country.parentAssignedCount || 0)) errors.push(`${code}: parent assignment count mismatch`);
}

const expected = [...catalog.regionIds].sort();
const actual = [...actualRegionIds].sort();
if (new Set(actual).size !== actual.length) errors.push("Duplicate region IDs detected");
if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push("catalog.regionIds does not match shard contents");
if (errors.length) throw new Error(`Atlas validation failed:\n${errors.join("\n")}`);
console.log(`Atlas valid: ${world.features.length} countries, ${actual.length} regions, ${Object.values(catalog.countries).filter((country) => country.file).length} lazy shards.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function validPolygonalGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.length > 0 && polygons.every((polygon) => {
    return Array.isArray(polygon)
      && polygon.length > 0
      && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every((position) => {
        return Array.isArray(position) && position.length >= 2 && position.every(Number.isFinite);
      }));
  });
}
