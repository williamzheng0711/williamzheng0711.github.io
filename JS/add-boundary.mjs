import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.join("=")];
  })
);

const required = ["label"];
const missing = required.filter((key) => !args[key]);

if (missing.length) {
  console.error(`Missing required arguments: ${missing.join(", ")}`);
  printUsage();
  process.exit(1);
}

if (!args.name && !args.names) {
  console.error("Missing required argument: name or names");
  printUsage();
  process.exit(1);
}

const dataPath = new URL("./visited-places.js", import.meta.url);
const source = fs.readFileSync(dataPath, "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "visited-places.js" });

const { PROVINCE_CODES = {}, VISITED_PLACES = [] } = context.window.TRAVEL_MAP_DATA || {};
const boundaryStyles = new Set(["municipality", "sar"]);

if (VISITED_PLACES.some((place) => place.type === "boundary" && place.label === args.label)) {
  console.error(`Boundary label already exists: ${args.label}`);
  process.exit(1);
}

if (!args.province && !args.style) {
  console.error("Boundary entries need either --province or --style.");
  printUsage();
  process.exit(1);
}

if (args.province && !PROVINCE_CODES[args.province]) {
  console.error(`Unknown province: ${args.province}`);
  console.error("Add it to PROVINCE_CODES in JS/visited-places.js first if needed.");
  process.exit(1);
}

if (args.style && !boundaryStyles.has(args.style)) {
  console.error(`Unknown boundary style: ${args.style}`);
  console.error(`Allowed styles: ${[...boundaryStyles].join(", ")}`);
  process.exit(1);
}

const names = splitList(args.names || args.name);

const fields = [
  'type: "boundary"',
  `label: "${escapeJs(args.label)}"`,
  `names: [${names.map((name) => `"${escapeJs(name)}"`).join(", ")}]`,
];

if (args.province) fields.push(`province: "${escapeJs(args.province)}"`);
if (args.style) fields.push(`style: "${escapeJs(args.style)}"`);

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
  console.error("Validation failed after adding boundary. Please inspect JS/visited-places.js.");
  console.error("The file was restored to its previous state.");
  process.exit(validation.status || 1);
}

console.log(`Added boundary: ${args.label}`);

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
  console.error("  node JS/add-boundary.mjs --label=蘇州市 --name=苏州市 --province=江蘇省");
  console.error("  node JS/add-boundary.mjs --label=蘇州市 --names='苏州市|蘇州市' --province=江蘇省");
  console.error("  node JS/add-boundary.mjs --label=天津市 --name=天津市 --style=municipality");
  console.error("  node JS/add-boundary.mjs --label=澳門 --name=澳门特别行政区 --style=sar");
}
