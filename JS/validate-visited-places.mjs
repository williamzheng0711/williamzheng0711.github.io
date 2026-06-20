import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const localBoundaries = JSON.parse(fs.readFileSync(new URL("../data/visited-boundaries.geojson", import.meta.url), "utf8"));
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "visited-places.js" });

const {
  BOUNDARY_PRESETS = {},
  PROVINCE_CODES = {},
  PLACE_TEMPLATES = {},
  VISITED_PLACES = [],
  SUMMARY_GROUPS = [],
} = context.window.TRAVEL_MAP_DATA || {};

const forbiddenNames = ["東莞", "东莞", "江門", "江门", "三明", "龍岩", "龙岩"];
const requiredBoundaries = [
  "上海市",
  "香港",
  "澳門",
  "廣州市",
  "深圳市",
  "珠海市",
  "清遠市",
  "重慶市",
  "北京市",
  "福州市",
  "寧德市",
  "廈門市",
  "泉州市",
  "棗莊市",
  "濟寧市",
  "新鄉市",
  "贛州市",
  "花蓮縣",
  "台北市",
  "新北市",
  "南投縣",
  "釜山廣域市",
  "首爾特別市",
  "濟州道",
  "京都市",
  "大津市",
  "名古屋市",
  "大阪市",
];

const errors = [];
const labels = new Set();
const groups = new Set(SUMMARY_GROUPS.map((group) => group.key));
const boundaryStyles = new Set(["municipality", "sar"]);
const serialized = JSON.stringify(VISITED_PLACES);
const boundaryPresetByLabel = new Map();
const localBoundaryNames = new Set((localBoundaries.features || []).map((feature) => feature.properties?.name).filter(Boolean));

Object.entries(BOUNDARY_PRESETS).forEach(([name, preset]) => {
  const id = `BOUNDARY_PRESETS.${name}`;
  validateBoundaryShape(preset, id);
  if (preset.label && !boundaryPresetByLabel.has(preset.label)) boundaryPresetByLabel.set(preset.label, preset);
});

VISITED_PLACES.forEach((place, index) => {
  const id = place.label || `VISITED_PLACES[${index}]`;
  const labelKey = `${place.type}:${place.label}`;

  if (!place.label) errors.push(`${id}: missing label`);
  if (labels.has(labelKey)) errors.push(`${id}: duplicate label for ${place.type}`);
  labels.add(labelKey);

  if (place.type === "boundary") {
    validateBoundaryShape(place, id);
    const matchingPreset = boundaryPresetByLabel.get(place.label);
    if (matchingPreset) {
      if (!sameList(place.names, matchingPreset.names)) {
        errors.push(`${id}: names differ from BOUNDARY_PRESETS.${place.label}`);
      }
      if ((place.province || matchingPreset.province) && place.province !== matchingPreset.province) {
        errors.push(`${id}: province differs from BOUNDARY_PRESETS.${place.label}`);
      }
      if ((place.style || matchingPreset.style) && place.style !== matchingPreset.style) {
        errors.push(`${id}: style differs from BOUNDARY_PRESETS.${place.label}`);
      }
      if ((place.source || matchingPreset.source) && place.source !== matchingPreset.source) {
        errors.push(`${id}: source differs from BOUNDARY_PRESETS.${place.label}`);
      }
      if ((place.group || matchingPreset.group) && place.group !== matchingPreset.group) {
        errors.push(`${id}: group differs from BOUNDARY_PRESETS.${place.label}`);
      }
    }
  } else if (place.type === "marker") {
    errors.push(`${id}: marker entries are no longer rendered; use type "boundary" with a polygon source`);
  } else {
    errors.push(`${id}: unknown type "${place.type}"`);
  }
});

requiredBoundaries.forEach((label) => {
  if (!VISITED_PLACES.some((place) => place.type === "boundary" && place.label === label)) {
    errors.push(`missing required boundary "${label}"`);
  }
});

forbiddenNames.forEach((name) => {
  if (serialized.includes(name)) errors.push(`forbidden place appears in data: ${name}`);
});

if (errors.length) {
  console.error(`Visited place validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}

const groupCounts = SUMMARY_GROUPS.map((group) => {
  const count = VISITED_PLACES.filter((place) =>
    group.key === "boundary" ? place.type === "boundary" && !place.group : place.group === group.key
  ).length;
  return `${group.title}: ${count}`;
});

console.log(`Visited place validation passed: ${VISITED_PLACES.length} places, ${SUMMARY_GROUPS.length} groups.`);
console.log(`Group counts: ${groupCounts.join("; ")}`);
console.log(`Available templates: ${Object.keys(PLACE_TEMPLATES).join(", ")}`);
console.log(`Available boundary presets: ${Object.keys(BOUNDARY_PRESETS).length}`);

function validateBoundaryShape(place, id) {
  if (!place.label) errors.push(`${id}: missing label`);
  if (!Array.isArray(place.names) || place.names.length === 0) {
    errors.push(`${id}: boundary entry needs a non-empty names array`);
  }
  if (place.province && !PROVINCE_CODES[place.province]) {
    errors.push(`${id}: unknown province "${place.province}"`);
  }
  if (place.style && !boundaryStyles.has(place.style)) {
    errors.push(`${id}: unknown boundary style "${place.style}"`);
  }
  if (place.source && place.source !== "local") {
    errors.push(`${id}: unknown boundary source "${place.source}"`);
  }
  if (place.source === "local") {
    if (!place.group || !groups.has(place.group)) errors.push(`${id}: local boundary needs a summary group`);
    (place.names || []).forEach((name) => {
      if (!localBoundaryNames.has(name)) {
        errors.push(`${id}: local boundary "${name}" is missing from data/visited-boundaries.geojson`);
      }
    });
  } else if (!place.province && !place.style) {
    errors.push(`${id}: boundary entry needs either province, style, or source "local"`);
  }
}

function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}
