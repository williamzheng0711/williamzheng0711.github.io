import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import polygonClipping from "polygon-clipping";

const inputPath = resolve(argumentValue("--input"));
const outputPath = resolve(argumentValue("--output"));
const countryCode = argumentValue("--country").toUpperCase();
const name = argumentValue("--name");
const source = JSON.parse(await readFile(inputPath, "utf8"));
const polygons = source.features.flatMap((feature) => {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates;
  return [];
});
const united = polygonClipping.union(...polygons.map((polygon) => [polygon]));
const geometry = united.length === 1
  ? { type: "Polygon", coordinates: united[0] }
  : { type: "MultiPolygon", coordinates: united };
const output = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { shapeName: name, shapeID: countryCode, shapeGroup: countryCode, shapeType: "ADM0" },
    geometry,
  }],
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`);
console.log(`Dissolved ${source.features.length} features into ${countryCode} ADM0.`);

function argumentValue(flag) {
  const direct = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
