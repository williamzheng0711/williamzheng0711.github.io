#!/usr/bin/env python3
"""Create a lightweight country context layer while retaining tiny countries."""

import argparse
import json
from pathlib import Path

from shapely import make_valid
from shapely.geometry import mapping, shape


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tolerance", type=float, default=0.02)
    parser.add_argument("--tiny-area", type=float, default=0.05, help="Keep full detail below this area in square degrees")
    args = parser.parse_args()

    data = json.loads(args.input.read_text())
    for feature in data["features"]:
        geometry = make_valid(shape(feature["geometry"]))
        if geometry.area >= args.tiny_area:
            simplified = geometry.simplify(args.tolerance, preserve_topology=True)
            if not simplified.is_empty:
                geometry = simplified
        feature["geometry"] = mapping(geometry)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"Simplified {len(data['features'])} world context features -> {args.output}")


if __name__ == "__main__":
    main()
