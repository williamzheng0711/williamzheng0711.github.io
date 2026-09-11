import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import polygonClipping from "polygon-clipping";

const inputDirectory = resolve(argumentValue("--input-dir"));
const outputPath = resolve(argumentValue("--output"));
const excluded = new Set(["台湾省.json", "香港特别行政区.json", "澳门特别行政区.json"]);
const municipalities = new Set(["北京市.json", "上海市.json", "天津市.json", "重庆市.json"]);
const output = [];

for (const filename of (await readdir(inputDirectory)).filter((name) => name.endsWith(".json") && !excluded.has(name)).sort()) {
  const source = JSON.parse(await readFile(resolve(inputDirectory, filename), "utf8"));
  if (municipalities.has(filename)) {
    const polygons = source.features.flatMap((feature) => multiPolygonCoordinates(feature.geometry));
    const geometry = fromMultiPolygon(polygonClipping.union(...polygons.map((polygon) => [polygon])));
    const code = String(source.features[0]?.properties?.parent?.adcode || source.features[0]?.properties?.acroutes?.[1]);
    output.push(makeFeature(code, filename.replace(/\.json$/, ""), geometry));
    continue;
  }
  for (const feature of source.features) {
    const code = String(feature.properties.adcode);
    output.push(makeFeature(code, String(feature.properties.name), feature.geometry));
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ type: "FeatureCollection", features: output })}\n`);
console.log(`Prepared ${output.length} China prefecture-level features in ${outputPath}.`);

function makeFeature(code, name, geometry) {
  return {
    type: "Feature",
    properties: { shapeName: name, shapeID: code, shapeGroup: "CHN", shapeType: "ADM2" },
    geometry,
  };
}

function multiPolygonCoordinates(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function fromMultiPolygon(coordinates) {
  return coordinates.length === 1
    ? { type: "Polygon", coordinates: coordinates[0] }
    : { type: "MultiPolygon", coordinates };
}

function argumentValue(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name} is required`);
  return value;
}
