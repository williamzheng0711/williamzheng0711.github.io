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

const { BOUNDARY_PRESETS = {}, PROVINCE_CODES = {}, VISITED_PLACES = [] } = context.window.TRAVEL_MAP_DATA || {};
const boundaryStyles = new Set(["municipality", "sar"]);
const preset = args.preset ? BOUNDARY_PRESETS[args.preset] : null;

if (args["list-presets"] !== undefined) {
  printPresets(BOUNDARY_PRESETS);
  process.exit(0);
}

if (args.preset && !preset) {
  console.error(`Unknown boundary preset: ${args.preset}`);
  console.error("Run `node JS/add-boundary.mjs --list-presets` to see available presets.");
  process.exit(1);
}

const label = args.label || preset?.label || args.preset;
const names = args.names || args.name ? splitList(args.names || args.name) : preset?.names || [];
const province = args.province || preset?.province;
const style = args.style || preset?.style;
const sourceType = args.source || preset?.source;
const group = args.group || preset?.group;
const required = [];
if (!label) required.push("label or preset");
if (!names.length) required.push("name/names or preset");

if (required.length) {
  console.error(`Missing required arguments: ${required.join(", ")}`);
  printUsage();
  process.exit(1);
}

if (VISITED_PLACES.some((place) => place.type === "boundary" && place.label === label)) {
  console.error(`Boundary label already exists: ${label}`);
  process.exit(1);
}

if (!province && !style && sourceType !== "local") {
  console.error("Boundary entries need either --province, --style, or --source=local.");
  printUsage();
  process.exit(1);
}

if (province && !PROVINCE_CODES[province]) {
  console.error(`Unknown province: ${province}`);
  console.error("Add it to PROVINCE_CODES in JS/visited-places.js first if needed.");
  process.exit(1);
}

if (style && !boundaryStyles.has(style)) {
  console.error(`Unknown boundary style: ${style}`);
  console.error(`Allowed styles: ${[...boundaryStyles].join(", ")}`);
  process.exit(1);
}

if (sourceType && sourceType !== "local") {
  console.error(`Unknown boundary source: ${sourceType}`);
  console.error("Allowed source: local");
  process.exit(1);
}

if (sourceType === "local" && !group) {
  console.error("Local boundary entries need --group, e.g. taiwan, korea, or japan.");
  process.exit(1);
}

const fields = [
  'type: "boundary"',
  `label: "${escapeJs(label)}"`,
  `names: [${names.map((name) => `"${escapeJs(name)}"`).join(", ")}]`,
];

if (province) fields.push(`province: "${escapeJs(province)}"`);
if (style) fields.push(`style: "${escapeJs(style)}"`);
if (sourceType) fields.push(`source: "${escapeJs(sourceType)}"`);
if (group) fields.push(`group: "${escapeJs(group)}"`);

const entry = `  { ${fields.join(", ")} },`;
const insertionAnchor = "];\n\nconst SUMMARY_GROUPS";
const updated = source.replace(insertionAnchor, `${entry}\n${insertionAnchor}`);

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
  console.error("Validation failed after adding boundary. Please inspect JS/visited-places.js.");
  console.error("The file was restored to its previous state.");
  process.exit(validation.status || 1);
}

console.log(`Added boundary: ${label}`);

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function splitList(value) {
  return String(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printUsage() {
  console.error("Examples:");
  console.error("  node JS/add-boundary.mjs --preset=廣東省廣州市");
  console.error("  node JS/add-boundary.mjs --preset=蘇州市");
  console.error("  node JS/add-boundary.mjs --label=蘇州市 --name=苏州市 --province=江蘇省");
  console.error("  node JS/add-boundary.mjs --label=蘇州市 --names='苏州市|蘇州市' --province=江蘇省");
  console.error("  node JS/add-boundary.mjs --label=天津市 --name=天津市 --style=municipality");
  console.error("  node JS/add-boundary.mjs --label=澳門 --name=澳门特别行政区 --style=sar");
}

function printPresets(presets) {
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  console.log(`Available boundary presets (${names.length}):`);
  names.forEach((name) => {
    const preset = presets[name];
    const source = preset.province || preset.style || `${preset.source}:${preset.group}`;
    console.log(`- ${name}: ${preset.label} [${preset.names.join(", ")}], ${source}`);
  });
}
