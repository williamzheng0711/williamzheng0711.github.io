# William Zheng's personal website

The travel map is now a consumer of **JourneySphere**, a standalone package under [`packages/journeysphere`](packages/journeysphere/README.md). The visual design remains a flat, pannable Leaflet map. Internal city/county boundaries are shown only inside visited first-level divisions (provinces, states, and prefectures); unvisited divisions retain only a faint outline and no hover label.

## Maintain the map

- **Your visits:** `data/journeysphere-visits.json` contains the atlas version, selected stable region IDs and optional display labels.
- **Available regions:** `packages/journeysphere/data/catalog.json` lists region IDs and per-country coverage; each `countries/<ISO3>.geojson` associates IDs with names and geometry.
- **Colors:** `packages/journeysphere/data/palette.json` records country colors and their inspiration. The package also accepts a `colors` override.
- **Website integration:** `JS/site.js` loads the package and your record. Reset restores the original record; clicking modifies only the current browser session.

Serve the repository over HTTP, then open `index.html`. No website compilation is needed. Leaflet 1.9.4 and its stylesheet are loaded from the existing CDN; all geographic data is hosted locally.

Run `node JS/verify-map-runtime.mjs` to validate atlas integrity, the homepage's selected IDs, state serialization, and package regression tests. The package's `examples/index.html` is an independent consumer and can be served from an extracted package directory.

## Extract JourneySphere later

Move the entire `packages/journeysphere` directory to its own repository. It contains its source, data, attribution, tests, example and package metadata; runtime paths do not refer back to this personal website. Pack it with `npm pack`, install the tarball in another project, and host its `data` directory. The homepage keeps only its personal travel record and adapter. See the package README for bundler usage and the full API.

The package has not been published to npm and the live website has not been deployed by this change.

## Historical sources

`JS/visited-places.js`, the old `data/*boundaries.geojson`, `JS/add-boundary.mjs`, `JS/validate-visited-places.mjs` and `JS/build-refined-map-data.mjs` preserve the original travel records and source workflow for migration audit. They are no longer the live map configuration. In particular, legacy GADM geometries are not bundled into the new package. Do not use the old add-boundary script to update JourneySphere visits.
