#!/usr/bin/env python3
"""Attach ADM1 parents and land-only ADM1 outlines to built country shards.

The Natural Earth input is used to classify each packaged region.  Output ADM1
geometry is dissolved from the packaged child regions, so it inherits the
atlas's physical-land clipping and never reintroduces marine extents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from collections import defaultdict
from pathlib import Path

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree


COUNTRY_ALIASES = {"KOS": "XKX"}
CHINA_EXCLUDED = {"台湾省.json", "香港特别行政区.json", "澳门特别行政区.json"}
SOURCE = {
    "name": "Natural Earth",
    "dataset": "10m Admin 1 States and Provinces",
    "version": "5.1.2",
    "license": "Public domain",
    "url": "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/",
    "role": "ADM1 parent classification; packaged outlines are dissolved from land-clipped child regions",
}

# Seoul and Korea's metropolitan/special cities are first-level city
# governments. They are display units in their own right, so do not expose
# their gu/district children as separately selectable regions.
SINGLE_REGION_ADMIN1 = {
    "KOR": {
        "KOR:ADM1:KOR-2495",  # Incheon
        "KOR:ADM1:KOR-2497",  # Seoul
        "KOR:ADM1:KOR-2500",  # Gwangju
        "KOR:ADM1:KOR-2503",  # Daejeon
        "KOR:ADM1:KOR-2504",  # Daegu
        "KOR:ADM1:KOR-2507",  # Busan
        "KOR:ADM1:KOR-2508",  # Ulsan
    },
}

# The pinned Korean child source places Busan's Gijang-gun and Gangseo-gu
# under the neighboring South Gyeongsang ADM1 when matched to Natural Earth.
# Reassign those official Busan units before dissolving the display region.
FORCED_REGION_PARENTS = {
    "KOR": {
        "KOR:ADM2:91817680B54012703126739": "KOR:ADM1:KOR-2507",  # Gijang-gun
        "KOR:ADM2:91817680B91211823266814": "KOR:ADM1:KOR-2507",  # Gangseo-gu
    },
}


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin1", required=True, type=Path)
    parser.add_argument("--china-province-dir", type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent.parent / "data")
    return parser.parse_args()


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
        temporary_path = handle.name
    os.replace(temporary_path, path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def round_coordinates(value):
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item) for item in value]
    return round(float(value), 5)


def rounded_geometry(geometry):
    serialized = mapping(geometry)
    return {"type": serialized["type"], "coordinates": round_coordinates(serialized["coordinates"])}


def polygonal_geometry(geometry):
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    if isinstance(geometry, GeometryCollection):
        polygons = [part for part in geometry.geoms if part.geom_type in ("Polygon", "MultiPolygon")]
        return unary_union(polygons) if polygons else MultiPolygon([])
    return MultiPolygon([])


def natural_earth_parents(path: Path):
    grouped = defaultdict(list)
    for feature in load_json(path).get("features", []):
        properties = feature.get("properties") or {}
        raw_code = str(properties.get("adm0_a3") or "")
        country_code = COUNTRY_ALIASES.get(raw_code, raw_code)
        source_code = str(properties.get("adm1_code") or properties.get("iso_3166_2") or "")
        if not country_code or not source_code or not feature.get("geometry"):
            continue
        grouped[country_code].append({
            "id": f"{country_code}:ADM1:{source_code}",
            "name": str(properties.get("name_en") or properties.get("name") or source_code),
            "geometry": polygonal_geometry(shape(feature["geometry"])),
        })
    return grouped


def china_parent_names(directory: Path | None):
    names = {}
    if not directory or not directory.exists():
        return names
    for path in sorted(directory.glob("*.json")):
        if path.name in CHINA_EXCLUDED:
            continue
        source = load_json(path)
        first = next(iter(source.get("features", [])), None)
        if not first:
            continue
        properties = first.get("properties") or {}
        code = str(properties.get("parent", {}).get("adcode") or properties.get("acroutes", [None, None])[1] or "")
        if len(code) >= 2:
            names[code[:2]] = path.stem
    return names


def classify(feature_geometry, parents, tree):
    point = feature_geometry.representative_point()
    candidates = list(tree.query(point, predicate="intersects"))
    if candidates:
        return int(candidates[0])
    candidates = list(tree.query(feature_geometry, predicate="intersects"))
    if not candidates:
        return None
    return max((int(index) for index in candidates), key=lambda index: feature_geometry.intersection(parents[index]["geometry"]).area)


def usa_territory_parent(geometry):
    point = geometry.representative_point()
    longitude, latitude = point.x, point.y
    if -67.5 <= longitude <= -65.0 and 17.5 <= latitude <= 18.7:
        return {"id": "USA:ADM1:US-PR", "name": "Puerto Rico"}
    if -65.2 <= longitude <= -64.4 and 17.5 <= latitude <= 18.8:
        return {"id": "USA:ADM1:US-VI", "name": "United States Virgin Islands"}
    if -172.0 <= longitude <= -168.0 and -15.0 <= latitude <= -10.0:
        return {"id": "USA:ADM1:US-AS", "name": "American Samoa"}
    if 144.0 <= longitude <= 145.2 and 13.0 <= latitude <= 14.0:
        return {"id": "USA:ADM1:US-GU", "name": "Guam"}
    if 145.0 <= longitude <= 146.2 and 14.0 <= latitude <= 21.0:
        return {"id": "USA:ADM1:US-MP", "name": "Northern Mariana Islands"}
    return None


def attach_to_shard(country_code: str, shard, parents, china_names):
    features = shard.get("features", [])
    for feature in features:
        (feature.get("properties") or {}).pop("parentId", None)
    if not features:
        shard["admin1"] = {"type": "FeatureCollection", "features": []}
        return 0, 0

    child_geometries = []
    assigned = defaultdict(list)
    parent_metadata = {}

    if country_code == "CHN":
        for feature in features:
            source_code = str((feature.get("properties") or {}).get("sourceCode") or "")
            if len(source_code) < 2:
                continue
            prefix = source_code[:2]
            parent_id = f"CHN:ADM1:{prefix}"
            feature["properties"]["parentId"] = parent_id
            geometry = polygonal_geometry(shape(feature["geometry"]))
            assigned[parent_id].append(geometry)
            parent_metadata[parent_id] = china_names.get(prefix, prefix)
    elif int((features[0].get("properties") or {}).get("adminLevel", -1)) == 1:
        for feature in features:
            parent_id = feature["properties"]["id"]
            feature["properties"]["parentId"] = parent_id
            geometry = polygonal_geometry(shape(feature["geometry"]))
            assigned[parent_id].append(geometry)
            parent_metadata[parent_id] = feature["properties"]["name"]
    elif parents:
        geometries = [parent["geometry"] for parent in parents]
        tree = STRtree(geometries)
        parent_by_id = {parent["id"]: parent for parent in parents}
        for feature in features:
            geometry = polygonal_geometry(shape(feature["geometry"]))
            child_geometries.append(geometry)
            forced_parent_id = FORCED_REGION_PARENTS.get(country_code, {}).get(
                (feature.get("properties") or {}).get("id")
            )
            if forced_parent_id in parent_by_id:
                feature["properties"]["parentId"] = forced_parent_id
                assigned[forced_parent_id].append(geometry)
                parent_metadata[forced_parent_id] = parent_by_id[forced_parent_id]["name"]
                continue
            territory = usa_territory_parent(geometry) if country_code == "USA" else None
            if territory:
                feature["properties"]["parentId"] = territory["id"]
                assigned[territory["id"]].append(geometry)
                parent_metadata[territory["id"]] = territory["name"]
                continue
            index = classify(geometry, parents, tree)
            if index is None and country_code == "JPN":
                index = int(tree.nearest(geometry.representative_point()))
            if index is None:
                continue
            parent = parents[index]
            feature["properties"]["parentId"] = parent["id"]
            assigned[parent["id"]].append(geometry)
            parent_metadata[parent["id"]] = parent["name"]

    admin1_features = []
    for parent_id in sorted(assigned):
        geometry = polygonal_geometry(unary_union(assigned[parent_id]))
        if geometry.is_empty:
            continue
        admin1_features.append({
            "type": "Feature",
            "properties": {"id": parent_id, "name": parent_metadata[parent_id], "countryCode": country_code},
            "geometry": rounded_geometry(geometry),
        })
    shard["admin1"] = {"type": "FeatureCollection", "features": admin1_features}
    features = collapse_single_region_parents(country_code, features, assigned, parent_metadata)
    shard["features"] = features
    return sum("parentId" in (feature.get("properties") or {}) for feature in features), len(admin1_features)


def collapse_single_region_parents(country_code: str, features, assigned, parent_metadata):
    single_parents = SINGLE_REGION_ADMIN1.get(country_code, set())
    if not single_parents:
        return features

    retained = []
    collapsed_parents = set()
    for feature in features:
        parent_id = (feature.get("properties") or {}).get("parentId")
        if parent_id in single_parents:
            collapsed_parents.add(parent_id)
        else:
            retained.append(feature)

    for parent_id in sorted(collapsed_parents):
        geometry = polygonal_geometry(unary_union(assigned[parent_id]))
        if geometry.is_empty:
            continue
        source_code = parent_id.split(":ADM1:", 1)[-1]
        retained.append({
            "type": "Feature",
            "properties": {
                "id": parent_id,
                "name": parent_metadata[parent_id],
                "countryCode": country_code,
                "adminLevel": 1,
                "sourceCode": source_code,
                "parentId": parent_id,
            },
            "geometry": rounded_geometry(geometry),
        })

    return sorted(retained, key=lambda feature: feature["properties"]["id"])


def main() -> None:
    args = arguments()
    catalog_path = args.data_dir / "catalog.json"
    catalog = load_json(catalog_path)
    parents_by_country = natural_earth_parents(args.admin1)
    china_names = china_parent_names(args.china_province_dir)
    total_assigned = 0
    total_parents = 0
    all_region_ids = []

    for country_code, country in sorted(catalog["countries"].items()):
        relative_path = country.get("file")
        if not relative_path:
            continue
        shard_path = args.data_dir / relative_path
        shard = load_json(shard_path)
        assigned_count, parent_count = attach_to_shard(
            country_code, shard, parents_by_country.get(country_code, []), china_names
        )
        write_json(shard_path, shard)
        country["parentAssignedCount"] = assigned_count
        country["admin1FeatureCount"] = parent_count
        country["featureCount"] = len(shard.get("features", []))
        if country_code == "CHN":
            country["admin1ParentSource"] = "chinaPrefectures"
        elif country_code == "USA":
            country["admin1ParentSource"] = "naturalEarthAdmin1; packaged regions for US territory equivalents"
        elif shard.get("features") and int((shard["features"][0].get("properties") or {}).get("adminLevel", -1)) == 1:
            country["admin1ParentSource"] = "packagedRegions"
        else:
            country["admin1ParentSource"] = "naturalEarthAdmin1"
        country["admin1GeometrySource"] = "dissolved packaged land-clipped regions"
        country.pop("admin1Source", None)
        country["sha256"] = sha256(shard_path)
        all_region_ids.extend(feature["properties"]["id"] for feature in shard.get("features", []))
        total_assigned += assigned_count
        total_parents += parent_count

    catalog.setdefault("sources", {})["naturalEarthAdmin1"] = SOURCE
    catalog.setdefault("inputChecksums", {})["naturalEarthAdmin1"] = sha256(args.admin1)
    catalog["regionIds"] = sorted(all_region_ids)
    write_json(catalog_path, catalog)
    print(f"Attached {total_assigned} region parents and {total_parents} land-only ADM1 outlines.")


if __name__ == "__main__":
    main()
