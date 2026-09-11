const featureLongitudeAnchors = new WeakMap();
const featureLongitudeRanges = new WeakMap();
const mergedDatelineGeometries = new WeakMap();

function featuresNearLongitude(features, mapLongitude) {
  return features.map((feature) => {
    // A polar cap spans a complete world; merging its seam as an ordinary
    // dateline island can create a polygon wider than 360 degrees.
    if (isPolarCap(feature.geometry)) return shiftFeatureLongitude(feature, Math.round(mapLongitude / 360) * 360);
    if (featureCrossesDateline(feature)) {
      return shiftFeaturePartsNearLongitude(feature, mapLongitude);
    }

    const anchor = featureLongitudeAnchor(feature);
    const offset = Math.round((mapLongitude - anchor) / 360) * 360;
    return offset ? shiftFeatureLongitude(feature, offset) : feature;
  });
}

export function featuresNearLongitudeCopies(features, mapLongitude) {
  // Keep one neighboring copy ready so Canvas always has geometry available
  // when the pane is dragged across the date line without tripling redraw cost.
  return featuresNearLongitude(features, mapLongitude).flatMap((feature) => [
    markWorldCopy(feature, 0),
    markWorldCopy(feature, -360),
    markWorldCopy(feature, 360),
  ]);
}

function markWorldCopy(feature, offset) {
  return {
    ...feature,
    properties: { ...feature.properties, __worldCopyOffset: offset },
    geometry: offset ? shiftGeometryLongitude(feature.geometry, offset) : feature.geometry,
  };
}

function featureCrossesDateline(feature) {
  const { min, max } = featureLongitudeRange(feature);
  return max - min > 180;
}

function featureLongitudeRange(feature) {
  if (featureLongitudeRanges.has(feature)) return featureLongitudeRanges.get(feature);
  let min = Infinity;
  let max = -Infinity;

  visitCoordinateLongitudes(feature.geometry?.coordinates, (longitude) => {
    min = Math.min(min, longitude);
    max = Math.max(max, longitude);
  });

  const range = min === Infinity ? { min: 0, max: 0 } : { min, max };
  featureLongitudeRanges.set(feature, range);
  return range;
}

function featureLongitudeAnchor(feature) {
  if (featureLongitudeAnchors.has(feature)) return featureLongitudeAnchors.get(feature);
  let total = 0;
  let count = 0;

  visitCoordinateLongitudes(feature.geometry?.coordinates, (longitude) => {
    total += longitude;
    count += 1;
  });

  const anchor = count ? total / count : 0;
  featureLongitudeAnchors.set(feature, anchor);
  return anchor;
}

function visitCoordinateLongitudes(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number") {
    visit(coordinates[0]);
    return;
  }
  coordinates.forEach((child) => visitCoordinateLongitudes(child, visit));
}

function shiftFeatureLongitude(feature, offset) {
  return {
    ...feature,
    properties: { ...feature.properties },
    geometry: shiftGeometryLongitude(feature.geometry, offset),
  };
}

function shiftFeaturePartsNearLongitude(feature, mapLongitude) {
  const geometry = mergedDatelineGeometry(feature.geometry);
  return {
    ...feature,
    properties: { ...feature.properties },
    geometry: shiftGeometryPartsNearLongitude(geometry, mapLongitude),
  };
}

function mergedDatelineGeometry(geometry) {
  if (!geometry || geometry.type !== "MultiPolygon") return geometry;
  if (mergedDatelineGeometries.has(geometry)) return mergedDatelineGeometries.get(geometry);

  const polygons = geometry.coordinates || [];
  const mergedPolygons = [];
  const consumed = new Set();

  polygons.forEach((polygon, index) => {
    if (consumed.has(index)) return;
    const edge = datelineEdge(polygon?.[0]);
    if (!edge) {
      mergedPolygons.push(polygon);
      return;
    }

    const partnerIndex = polygons.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === index || consumed.has(candidateIndex)) return false;
      const candidateEdge = datelineEdge(candidate?.[0]);
      return candidateEdge && edge.sign !== candidateEdge.sign && matchingDatelineSpan(edge, candidateEdge);
    });

    if (partnerIndex === -1) {
      mergedPolygons.push(polygon);
      return;
    }

    const partner = polygons[partnerIndex];
    const merged = mergeDatelinePolygons(polygon, edge, partner, datelineEdge(partner[0]));
    if (!merged) {
      mergedPolygons.push(polygon);
      return;
    }

    consumed.add(index);
    consumed.add(partnerIndex);
    mergedPolygons.push(merged);
  });

  const result = { ...geometry, coordinates: mergedPolygons };
  mergedDatelineGeometries.set(geometry, result);
  return result;
}

function datelineEdge(ring) {
  if (!Array.isArray(ring)) return null;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (
      isDatelineLongitude(start?.[0]) &&
      isDatelineLongitude(end?.[0]) &&
      Math.abs(start[0] - end[0]) < 1e-6 &&
      Math.abs(start[1] - end[1]) > 1e-6
    ) {
      return { index, start, end, sign: start[0] > 0 ? 1 : -1 };
    }
  }
  return null;
}

function isDatelineLongitude(longitude) {
  return typeof longitude === "number" && Math.abs(Math.abs(longitude) - 180) < 1e-6;
}

function matchingDatelineSpan(first, second) {
  const firstLatitudes = [first.start[1], first.end[1]].sort((a, b) => a - b);
  const secondLatitudes = [second.start[1], second.end[1]].sort((a, b) => a - b);
  return firstLatitudes.every((latitude, index) => Math.abs(latitude - secondLatitudes[index]) < 1e-5);
}

function mergeDatelinePolygons(firstPolygon, firstEdge, secondPolygon, secondEdge) {
  let positivePolygon = firstPolygon;
  let positiveEdge = firstEdge;
  let negativePolygon = secondPolygon;
  let negativeEdge = secondEdge;
  if (positiveEdge.sign < 0) {
    positivePolygon = secondPolygon;
    positiveEdge = secondEdge;
    negativePolygon = firstPolygon;
    negativeEdge = firstEdge;
  }

  const shiftedNegativePolygon = shiftCoordinatesLongitude(negativePolygon, 360);
  const positivePath = pathWithoutDatelineEdge(positivePolygon[0], positiveEdge);
  const negativePath = pathWithoutDatelineEdge(shiftedNegativePolygon[0], negativeEdge);
  const outerRing = concatenateDatelinePaths(positivePath, negativePath);
  if (!outerRing) return null;

  return [
    outerRing,
    ...positivePolygon.slice(1),
    ...shiftedNegativePolygon.slice(1),
  ];
}

function pathWithoutDatelineEdge(ring, edge) {
  const ringLength = ring.length - 1;
  const path = [];
  for (let step = 0; step < ringLength; step += 1) {
    path.push(ring[(edge.index + 1 + step) % ringLength]);
  }
  return path;
}

function concatenateDatelinePaths(firstPath, secondPath) {
  let continuation = secondPath;
  if (!sameCoordinate(firstPath.at(-1), continuation[0])) {
    continuation = [...continuation].reverse();
  }
  if (!sameCoordinate(firstPath.at(-1), continuation[0])) return null;

  const ring = [...firstPath, ...continuation.slice(1)];
  if (!sameCoordinate(ring[0], ring.at(-1))) ring.push([...ring[0]]);
  return ring;
}

function sameCoordinate(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    Math.abs(first[0] - second[0]) < 1e-6 &&
    Math.abs(first[1] - second[1]) < 1e-6
  );
}

function shiftGeometryPartsNearLongitude(geometry, mapLongitude) {
  if (!geometry) return geometry;
  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((child) =>
        shiftGeometryPartsNearLongitude(child, mapLongitude)
      ),
    };
  }

  const multiGeometry = ["MultiPolygon", "MultiLineString", "MultiPoint"].includes(geometry.type);
  if (!multiGeometry) {
    const offset = longitudeOffset(coordinatePartLongitudeAnchor(geometry.coordinates), mapLongitude);
    return shiftGeometryLongitude(geometry, offset);
  }

  return {
    ...geometry,
    coordinates: geometry.coordinates.map((part) => {
      const offset = longitudeOffset(coordinatePartLongitudeAnchor(part), mapLongitude);
      return shiftCoordinatesLongitude(part, offset);
    }),
  };
}

function longitudeOffset(anchor, mapLongitude) {
  return Math.round((mapLongitude - anchor) / 360) * 360;
}

function coordinatePartLongitudeAnchor(coordinates) {
  const longitudes = [];
  visitCoordinateLongitudes(coordinates, (longitude) => longitudes.push(longitude));
  if (!longitudes.length) return 0;

  const reference = longitudes[0];
  let total = 0;
  longitudes.forEach((longitude) => {
    let unwrapped = longitude;
    while (unwrapped - reference > 180) unwrapped -= 360;
    while (unwrapped - reference < -180) unwrapped += 360;
    total += unwrapped;
  });
  return total / longitudes.length;
}

function shiftGeometryLongitude(geometry, offset) {
  return {
    ...geometry,
    coordinates: shiftCoordinatesLongitude(geometry.coordinates, offset),
  };
}

function shiftCoordinatesLongitude(coordinates, offset) {
  if (typeof coordinates?.[0] === "number") {
    const [longitude, latitude, ...rest] = coordinates;
    return [longitude + offset, latitude, ...rest];
  }
  return coordinates.map((child) => shiftCoordinatesLongitude(child, offset));
}


function isPolarCap(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([ring]) => {
    if (!Array.isArray(ring) || ring.length === 0) return false;
    if (!ring.some(([, latitude]) => Math.abs(latitude) >= 89.999)) return false;
    const bounds = ring.reduce(([min, max], [longitude]) => [Math.min(min, longitude), Math.max(max, longitude)], [Infinity, -Infinity]);
    return bounds[1] - bounds[0] >= 359.99;
  });
}
