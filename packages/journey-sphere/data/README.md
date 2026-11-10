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

## Precompiled rendering data

`npm run build:compiled` derives `compiled/` from the checked-in atlas without changing region IDs or codeword order. `compiled/manifest.js` and `manifest.json` describe the catalog fingerprint, country index ranges, colors, and shard paths. `compiled/world.json` and `compiled/countries/<ISO3>.json` contain reusable SVG path commands in projected Web Mercator coordinates. They are consumed as native Canvas `Path2D` objects by the compiled renderer.

Coordinates are rounded to an integer grid of extent `2^24`: each axis has at most half a grid unit of quantization error (0.03125 CSS pixels at zoom 12). Administrative region shards retain their existing geometry. The compiled world overview additionally simplifies contours with a projected tolerance of 3,000 grid units (about 0.73 CSS pixels at zoom 4), retaining closed rings and tiny islands. Polygon holes and existing seam normalization are retained; parent outlines omit internal holes as in the original renderer. The same source licenses and attribution apply.

## Detail on zoom

`outlines/<ISO3>.json` contains full country outlines, loaded only for the visible area at zoom 6 and above. A compact display tier in `outlines/overview/` refines the visible area from zoom 4, after the first map paint. Every atlas entry uses the same refinement path. For countries with administrative shards, the builder merges their actual selectable polygons on the same projected integer grid used by the renderer. This aligns the background coastline with subdivision fills, without changing the original shards. Geometry processing happens at build time.

US outlines additionally have five complete regional groups in `outlines/fragments/`, derived from their existing spatial-part bounds. For an already visible country, the loader requests only groups intersecting the viewport plus a two-tile margin, at both refinement tiers. The margin does not activate an otherwise offscreen country. Splitting rebases ring origins without changing any vertices, hole membership, strokes, or IDs. The original full files remain available. `fragments/provenance.json` records exact source hashes, polygon/ring membership, and output hashes; the compiled builder rejects stale or incomplete groups. The renderer replaces the whole-country overview only when all groups needed for the current viewport are cached. It never layers a partial fill over the same coarse country fill.

Natural Earth countries use the pinned 10m input recorded in `outlines/sources.json`. Disjoint offshore polygons from that input also supplement administrative coverage, provided they do not intersect any existing atlas country's geometry. This preserves contextual islands without drawing a second outline over separately represented territories. Missing source entries and every input hash are recorded in the provenance file. Administrative-derived outlines retain their country-specific source licenses and attribution; only the Natural Earth input is public domain.

Fills and hit testing retain complete paths, including holes. Exterior rings are always outlined. Dissolved interior rings are eligible for an outline when supported by an explicit hole in the source geometry; combining adjacent regions does not itself create new hole outlines. Optional `strokeWidths` records an effective width for eligible holes (zero for unsupported gaps), and holes narrower than half a CSS pixel at the current tile zoom are not stroked. This avoids turning gaps between source regions into dark marks. The fill geometry itself is unchanged, so faint source gaps can still be visible at maximum zoom.

Small groups of polygon bounds prevent distant islands or date-line geometry from triggering downloads across empty ocean. The browser gives the nearest country outline a head start of at most two seconds, then downloads the remaining files with at most three requests concurrently. It keeps a 32-entry recent cache plus all currently visible countries, and cancels obsolete viewport or tier requests. Cached compact detail remains visible while full detail downloads; cached full detail is reused when zooming out. Region IDs, codeword ordering and catalog fingerprints stay unchanged. Detail remains limited by the source geometry; this is not a street-level or survey map.

The compact tier preserves every ring, island and hole. Its build uses Shapely 2.x topology-preserving simplification with a projected error cap of 700 grid units and independently verifies omitted-point displacement and complete polygon validity. If restoring an exact tiny ring makes the simplified geometry invalid, the builder retries with smaller simplification tolerances before falling back to the original geometry. Countries with invalid source topology stay exact. The error cap is at most about 0.48 CSS pixels at zoom 5.5. No new vertices are interpolated. `outlines/overview/provenance.json` records source and output hashes, each attempt's tolerance and the fallback policy. If a compact record is identical to full detail, its manifest reuses the full URL at both zoom tiers to avoid duplicate downloads. The source licenses in `outlines/sources.json` apply to this derived tier too.

Outline records use lossless `relative-delta-v1` transport: `paths` stores integer coordinate deltas, with each ring's origin relative to the previous origin and its closing segment reconstructed by the loader. Decoding restores the original SVG path exactly; it does not simplify the boundary. The loader also accepts the original `d` representation. Decoding is part of the existing deferred loader and requires no additional browser request. Deploy the generated outlines and current runtime together; older runtimes do not understand the compact representation.

Acquire and archive the pinned input outside the build, then run:

```sh
npm run build:outlines -- --source-world /absolute/path/to/ne_10m_admin_0_countries.geojson \
  --source-version ca96624a56bd078437bca8184e78163e5039ad19 \
  --source-url https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_countries.geojson
npm run build:overview -- --python /path/to/python-with-shapely
npm run build:fragments
npm run build:compiled
```

The detail builders write separate directories so a normal `build:compiled` preserves those assets. The compiled builder rejects stale compact outlines and regional groups using their source hashes. `build:compiled` also regenerates embed name and selected-region chunks. The embed overview shortens only SVG syntax after its existing simplification; every resulting coordinate, ring, and closing edge stays identical. Deploy the compiled, outline and embed data together; static exports include both outline tiers, regional groups, their provenance and the loader.

A failed build leaves the previous complete compiled directory intact. Commit or deploy the manifest and generated shards together. The browser still downloads geometry on a first visit; production hosting should serve these static files with compression and versioned caching. The compiled files do not contain user visit history.
