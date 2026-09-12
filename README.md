# William Zheng's personal website

The travel map is now a consumer of **JourneySphere**, a standalone public package maintained in the [`journey-sphere` repository](https://github.com/williamzheng0711/journey-sphere). The visual design remains a flat, pannable Leaflet map. Internal city/county boundaries are shown only inside visited first-level divisions (provinces, states, and prefectures); unvisited divisions retain only a faint outline and no hover label.

## Maintain the map

- **Your visits:** `data/journeysphere-visits.json` contains the atlas version, selected stable region IDs and optional display labels.
- **Available regions:** The public [`catalog.json`](https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@main/data/catalog.json) lists region IDs and per-country coverage.
- **Colors:** The public [`palette.json`](https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@main/data/palette.json) records country colors and their inspiration. The package also accepts a `colors` override.
- **Website integration:** `JS/site.js` loads the public package and your local record. Reset restores the original record; clicking modifies only the current browser session.

Serve the repository over HTTP, then open `index.html`. No website compilation is needed. Leaflet 1.9.4 is loaded from the existing CDN; JourneySphere code and geographic data are loaded from its public `main` branch through jsDelivr.

Run `node JS/verify-map-runtime.mjs` to validate the homepage's selected IDs against the public atlas and confirm that the remote package files are reachable. Package regression tests and atlas validation now live in the `journey-sphere` repository.

## Update the map

The homepage follows the public `main` branch of `journey-sphere`. After changing the map package, push the changes to that repository and wait for jsDelivr to refresh; the homepage will then load the new map code or data. Keep `data/journeysphere-visits.json` here because it contains this website owner's personal visits. If region identities change, update its `atlasVersion` and migrate the IDs as described in the JourneySphere README.

The package can later be published to npm for users who prefer `npm install`; the GitHub Pages/CDN path already lets browser-only sites use it without a build step.

## Historical sources

`JS/visited-places.js`, the old `data/*boundaries.geojson`, `JS/add-boundary.mjs`, `JS/validate-visited-places.mjs` and `JS/build-refined-map-data.mjs` preserve the original travel records and source workflow for migration audit. They are no longer the live map configuration. In particular, legacy GADM geometries are not bundled into the new package. Do not use the old add-boundary script to update JourneySphere visits.
