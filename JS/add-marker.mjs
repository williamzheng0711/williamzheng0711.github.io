import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.join("=")];
  })
);

const dataPath = new URL("./visited-places.js", import.meta.url);
const source = fs.readFileSync(dataPath, "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "visited-places.js" });

const { MARKER_PRESETS = {}, SUMMARY_GROUPS = [], VISITED_PLACES = [] } = context.window.TRAVEL_MAP_DATA || {};
const groups = new Set([...SUMMARY_GROUPS.map((group) => group.key), "sar"]);
const preset = args.preset ? MARKER_PRESETS[args.preset] : null;

if (args["list-presets"] !== undefined) {
  printPresets(MARKER_PRESETS);
  process.exit(0);
}

if (args.preset && !preset) {
  console.error(`Unknown marker preset: ${args.preset}`);
  console.error("Run `node JS/add-marker.mjs --list-presets` to see available presets.");
  process.exit(1);
}

const label = args.label || preset?.label || args.preset;
const coordinates = args.lng !== undefined || args.lat !== undefined ? [Number(args.lng), Number(args.lat)] : preset?.coordinates;
const group = args.group || preset?.group;
const required = [];
if (!label) required.push("label or preset");
if (!coordinates) required.push("lng/lat or preset");
if (!group) required.push("group or preset");

if (required.length) {
  console.error(`Missing required arguments: ${required.join(", ")}`);
  printUsage();
  process.exit(1);
}

const [lng, lat] = coordinates;

if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
  console.error("Invalid coordinates. Use --lng within [-180, 180] and --lat within [-90, 90].");
  process.exit(1);
}

if (VISITED_PLACES.some((place) => place.type === "marker" && place.label === label)) {
  console.error(`Marker label already exists: ${label}`);
  process.exit(1);
}

if (!groups.has(group)) {
  console.error(`Unknown marker group: ${group}`);
  console.error(`Allowed groups: ${[...groups].join(", ")}`);
  process.exit(1);
}

const fields = [
  'type: "marker"',
  `label: "${escapeJs(label)}"`,
  `coordinates: [${formatNumber(lng)}, ${formatNumber(lat)}]`,
  `group: "${escapeJs(group)}"`,
];

const labelOffset = parseOffset(args["offset-x"], args["offset-y"], preset?.labelOffset);
if (labelOffset) fields.push(`labelOffset: [${labelOffset.map(formatNumber).join(", ")}]`);

const entry = `  { ${fields.join(", ")} },`;
const markerAnchor = "];\n\nconst SUMMARY_GROUPS";
const updated = source.replace(markerAnchor, `${entry}\n${markerAnchor}`);

if (updated === source) {
  console.error("Could not find VISITED_PLACES insertion point.");
  process.exit(1);
}

fs.writeFileSync(dataPath, updated);

const validation = spawnSync(process.execPath, [new URL("./validate-visited-places.mjs", import.meta.url).pathname], {
  cwd: new URL("..", import.meta.url).pathname,
  encoding: "utf8",
});

if (validation.stdout) process.stdout.write(validation.stdout);
if (validation.stderr) process.stderr.write(validation.stderr);

if (validation.status !== 0) {
  fs.writeFileSync(dataPath, source);
  console.error("Validation failed after adding marker. Please inspect JS/visited-places.js.");
  console.error("The file was restored to its previous state.");
  process.exit(validation.status || 1);
}

console.log(`Added marker: ${label}`);

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function formatNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function parseOffset(x, y, fallback = null) {
  if (x === undefined && y === undefined) return fallback;
  const offsetX = Number(x);
  const offsetY = Number(y);
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    console.error("Invalid label offset. Use both --offset-x and --offset-y as numbers.");
    process.exit(1);
  }
  return [offsetX, offsetY];
}

function printUsage() {
  console.error("Examples:");
  console.error("  node JS/add-marker.mjs --preset=東京");
  console.error("  node JS/add-marker.mjs --preset=奈良");
  console.error("  node JS/add-marker.mjs --label=東京 --lng=139.6917 --lat=35.6895 --group=japan");
}

function printPresets(presets) {
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  console.log(`Available marker presets (${names.length}):`);
  names.forEach((name) => {
    const preset = presets[name];
    console.log(`- ${name}: ${preset.label} [${preset.coordinates.join(", ")}], ${preset.group}`);
  });
}
