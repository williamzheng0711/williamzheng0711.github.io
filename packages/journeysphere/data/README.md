# JourneySphere atlas data

The atlas separates a small global context layer from lazy country shards:

- `world.geojson` contains land country polygons with `countryCode` and `iso3` as ISO 3166-1 alpha-3 codes.
- `countries/<ISO3>.geojson` contains regions with stable `id`, `name`, `countryCode`, `adminLevel`, and `sourceCode` properties.
- `catalog.json` is the machine-readable coverage and provenance manifest. `coverage: "country-only"` means that an ADM2 shard has not been bundled; it is not a claim of global ADM2 completeness.
- `palette.json` assigns every global country a culturally linked color and preserves the renderer's default `0.44` opacity. The current site's key colors are curated and locked; the remaining country colors are chosen with neighbor contrast in mind.

Region IDs have the form `<ISO3>:ADM<n>:<source-code>`. The atlas pins source versions and records output checksums, so codewords can use the sorted `catalog.regionIds` list without depending on feature order inside GeoJSON files. Changing display units requires a new atlas version because it changes the selectable region catalog.

## Administrative coverage

The global bundle contains 248 lazy country/territory shards. ADM2 is used where the source's administrative semantics match the requested second-order display unit; audited exceptions include official Canadian census divisions and German/Italian district/province layers exposed as display ADM2. Taiwan deliberately uses geoBoundaries ADM1 because its ADM2 layer contains 368 districts/townships, which is finer than the requested prefecture-equivalent display unit. Korea keeps ordinary provincial cities/counties, while Seoul, Busan, Incheon, Gwangju, Daejeon, Daegu, and Ulsan are each represented by one first-level city region rather than their gu/district children. Small countries and territories use a single detailed ADM0 shape. Eleven disputed or special-purpose map units remain explicitly `country-only`; `catalog.json` names each one rather than presenting the bundle as universally complete.

All detailed coastal geometries are intersected with Natural Earth's 10m physical-land layer. This removes marine administrative extents such as those formerly visible around Busan and Jeju while preserving polygon holes, including inland water holes present in the source geometry.

Empty or degenerate source features are excluded from codeword order because they cannot be rendered or clicked. Affected country entries use `coverage: "partial"` and record both `droppedAfterLandClip` and `droppedRegionIds`, keeping those omissions visible and auditable.

## Sources and licenses

- **Natural Earth** country boundaries and 10m land: public domain. <https://www.naturalearthdata.com/about/terms-of-use/>
- **geoBoundaries gbOpen 6.0.0**: every boundary is open, but the exact license varies by shard (including public domain, CC BY, ODbL, and national open-government licenses). `catalog.json` records `sourceName`, `sourceLicense`, and `sourceLicenseUrl` per country. Attribution: Runfola et al. (2020), *geoBoundaries: A global database of political administrative boundaries*. <https://www.geoboundaries.org/>
- **zhChuXiao/ChinaGeoJson** prefecture geometry: the repository declares an MIT license and documents DataV.GeoAtlas as its upstream source. DataV's upstream data terms are not independently stated in that repository, so this is a recorded redistribution caveat rather than a claim that the upstream geometry is unconditionally relicensed. <https://github.com/zhChuXiao/ChinaGeoJson>

The package intentionally excludes GADM because its redistribution terms are unsuitable for an unrestricted reusable package.

## Rebuild

Install package dependencies, prepare a source directory with:

```text
ne_10m_admin_0_countries.geojson
ne_10m_land.geojson
geoboundaries/<ISO3>_ADM<n>.geojson
china-prefectures/province/*.json
```

Then run:

```sh
node scripts/build-atlas.mjs --source-dir /absolute/path/to/atlas-sources
node scripts/validate-atlas.mjs
```

For a global build, Shapely 2.x can perform the expensive land intersection first:

```sh
python scripts/preclip-atlas.py \
  --land /absolute/path/to/ne_10m_land.geojson \
  --input-dir /absolute/path/to/geoboundaries \
  --output-dir /absolute/path/to/preclipped
node scripts/build-atlas.mjs \
  --source-dir /absolute/path/to/atlas-sources \
  --geoboundaries-dir /absolute/path/to/geoboundaries \
  --preclipped-dir /absolute/path/to/preclipped
```

The same build environment can reduce the global context payload while retaining full detail for tiny countries:

```sh
python scripts/simplify-world.py \
  --input ne_10m_admin_0_countries.geojson \
  --output atlas-sources/ne_10m_admin_0_countries.geojson
```

The build is deterministic when `JOURNEY_SPHERE_GENERATED_AT` is omitted. Source acquisition is kept outside the build so releases can pin and archive exact inputs rather than silently downloading mutable `current` URLs.
