#!/usr/bin/env python3
"""Simplify and clip geoBoundaries shards to a physical-land mask.

This is an optional build-time accelerator. It requires Shapely 2.x and writes
source-compatible GeoJSON for `build-atlas.mjs --preclipped-dir`.
"""

import argparse
import json
from pathlib import Path

from shapely import make_valid
from shapely.geometry import MultiPolygon, box, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep


def polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon" and len(geometry.exterior.coords) >= 4:
        return [geometry]
    return [polygon for part in getattr(geometry, "geoms", []) for polygon in polygon_parts(part)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--land", required=True, type=Path, help="Natural Earth 10m land GeoJSON")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--tolerance", type=float, default=0.002, help="Douglas-Peucker tolerance in degrees")
    args = parser.parse_args()

    land_data = json.loads(args.land.read_text())
    land_parts = []
    for feature in land_data["features"]:
        land_parts.extend(polygon_parts(make_valid(shape(feature["geometry"]))))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    source_files = sorted(args.input_dir.glob("*.geojson"))
    for source_path in source_files:
        data = json.loads(source_path.read_text())
        geometries = [make_valid(shape(feature["geometry"])) for feature in data["features"]]
        if not geometries:
            continue
        envelope = unary_union([box(*geometry.bounds) for geometry in geometries]).envelope
        mask = unary_union([part.intersection(envelope) for part in land_parts if part.intersects(envelope)])
        prepared_mask = prep(mask)
        output_features = []
        for feature, geometry in zip(data["features"], geometries):
            simplified = geometry.simplify(args.tolerance, preserve_topology=True)
            clipped = simplified if prepared_mask.covers(simplified) else simplified.intersection(mask)
            parts = polygon_parts(clipped)
            if not parts:
                continue
            feature["geometry"] = mapping(parts[0] if len(parts) == 1 else MultiPolygon(parts))
            output_features.append(feature)
        data["features"] = output_features
        output_path = args.output_dir / source_path.name
        output_path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
        print(f"{source_path.name}: {len(output_features)} features")


if __name__ == "__main__":
    main()
