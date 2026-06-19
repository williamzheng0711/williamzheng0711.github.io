import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./visited-places.js", import.meta.url), "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "visited-places.js" });

const {
  BOUNDARY_PRESETS = {},
  MARKER_PRESETS = {},
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
];
const requiredMarkers = {
  sar: ["上海", "香港", "澳門"],
  taiwan: ["花蓮", "台北", "新北", "南投"],
  korea: ["釜山", "首爾", "濟州"],
  japan: ["京都", "大津", "名古屋", "大阪"],
};

const errors = [];
const labels = new Set();
const groups = new Set(SUMMARY_GROUPS.map((group) => group.key));
const boundaryStyles = new Set(["municipality", "sar"]);
const serialized = JSON.stringify(VISITED_PLACES);
const boundaryPresetByLabel = new Map();
const markerPresetByLabel = new Map();

Object.entries(BOUNDARY_PRESETS).forEach(([name, preset]) => {
  const id = `BOUNDARY_PRESETS.${name}`;
  validateBoundaryShape(preset, id);
  if (preset.label && !boundaryPresetByLabel.has(preset.label)) boundaryPresetByLabel.set(preset.label, preset);
});

Object.entries(MARKER_PRESETS).forEach(([name, preset]) => {
  const id = `MARKER_PRESETS.${name}`;
  if (!preset.label) errors.push(`${id}: missing label`);
  if (!Array.isArray(preset.coordinates) || preset.coordinates.length !== 2) {
    errors.push(`${id}: needs coordinates [longitude, latitude]`);
  } else {
    const [lng, lat] = preset.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      errors.push(`${id}: coordinates must be finite numbers`);
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      errors.push(`${id}: coordinates are out of longitude/latitude range`);
    }
  }
  if (!preset.group) {
    errors.push(`${id}: missing group`);
  } else if (!groups.has(preset.group) && preset.group !== "sar") {
    errors.push(`${id}: group "${preset.group}" has no summary group`);
  }
  if (preset.labelOffset) validateOffset(preset.labelOffset, `${id}.labelOffset`);

  if (preset.label && !markerPresetByLabel.has(preset.label)) markerPresetByLabel.set(preset.label, preset);
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
    }
  } else if (place.type === "marker") {
    if (!Array.isArray(place.coordinates) || place.coordinates.length !== 2) {
      errors.push(`${id}: marker entry needs coordinates [longitude, latitude]`);
    } else {
      const [lng, lat] = place.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        errors.push(`${id}: marker coordinates must be finite numbers`);
      }
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        errors.push(`${id}: marker coordinates are out of longitude/latitude range`);
      }
    }
    if (!place.group) {
      errors.push(`${id}: marker entry needs group`);
    } else if (!groups.has(place.group) && place.group !== "sar") {
      errors.push(`${id}: marker group "${place.group}" has no summary group`);
    }
    if (place.labelOffset) {
      validateOffset(place.labelOffset, `${id}: labelOffset`);
    }
    const matchingPreset = markerPresetByLabel.get(place.label);
    if (matchingPreset) {
      if (!samePair(place.coordinates, matchingPreset.coordinates)) {
        errors.push(`${id}: coordinates differ from MARKER_PRESETS.${place.label}`);
      }
      if (place.group !== matchingPreset.group) {
        errors.push(`${id}: group differs from MARKER_PRESETS.${place.label}`);
      }
      if ((place.labelOffset || matchingPreset.labelOffset) && !samePair(place.labelOffset, matchingPreset.labelOffset)) {
        errors.push(`${id}: labelOffset differs from MARKER_PRESETS.${place.label}`);
      }
    }
  } else {
    errors.push(`${id}: unknown type "${place.type}"`);
  }
});

requiredBoundaries.forEach((label) => {
  if (!VISITED_PLACES.some((place) => place.type === "boundary" && place.label === label)) {
    errors.push(`missing required boundary "${label}"`);
  }
});

Object.entries(requiredMarkers).forEach(([group, labels]) => {
  labels.forEach((label) => {
    if (!VISITED_PLACES.some((place) => place.type === "marker" && place.group === group && place.label === label)) {
      errors.push(`missing required ${group} marker "${label}"`);
    }
  });
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
    group.key === "boundary" ? place.type === "boundary" : place.group === group.key
  ).length;
  return `${group.title}: ${count}`;
});

console.log(`Visited place validation passed: ${VISITED_PLACES.length} places, ${SUMMARY_GROUPS.length} groups.`);
console.log(`Group counts: ${groupCounts.join("; ")}`);
console.log(`Available templates: ${Object.keys(PLACE_TEMPLATES).join(", ")}`);
console.log(`Available boundary presets: ${Object.keys(BOUNDARY_PRESETS).length}`);
console.log(`Available marker presets: ${Object.keys(MARKER_PRESETS).length}`);

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
  if (!place.province && !place.style) {
    errors.push(`${id}: boundary entry needs either province or style`);
  }
}

function validateOffset(offset, id) {
  if (!Array.isArray(offset) || offset.length !== 2) {
    errors.push(`${id} must be [x, y]`);
    return;
  }
  const [x, y] = offset;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errors.push(`${id} values must be finite numbers`);
  }
}

function samePair(a, b) {
  if (!a && !b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return false;
  return a[0] === b[0] && a[1] === b[1];
}

function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}
