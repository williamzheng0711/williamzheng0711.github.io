#!/usr/bin/env python3
"""Split territory regions from a parent shard using a country outline."""

import argparse
import json
from pathlib import Path

from shapely.geometry import shape


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--parent-output", required=True, type=Path)
    parser.add_argument("--territory-output", required=True, type=Path)
    parser.add_argument("--territory", required=True)
    args = parser.parse_args()

    world = json.loads(args.world.read_text())
    territory_feature = next(
        feature for feature in world["features"]
        if (feature.get("properties", {}).get("ISO_A3") or feature.get("properties", {}).get("countryCode")) == args.territory
    )
    territory_geometry = shape(territory_feature["geometry"])
    source = json.loads(args.source.read_text())
    territory = []
    parent = []
    for feature in source["features"]:
        geometry = shape(feature["geometry"])
        if territory_geometry.covers(geometry.representative_point()):
            feature["properties"]["shapeGroup"] = args.territory
            territory.append(feature)
        else:
            parent.append(feature)
    for path, features in [(args.parent_output, parent), (args.territory_output, territory)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"Split {len(parent)} parent and {len(territory)} {args.territory} features")


if __name__ == "__main__":
    main()
