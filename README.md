myPage

## Travel map data

Visited places are maintained in `JS/visited-places.js`.

- Add mainland China or SAR administrative regions as `type: "boundary"`.
- Add Taiwan, Korea, Japan, or other city-level places as `type: "boundary"` with `source: "local"` and a bundled polygon in `data/visited-boundaries.geojson`.
- Copy examples from `PLACE_TEMPLATES` in `JS/visited-places.js` when adding a new entry.
- List boundary presets with `node JS/add-boundary.mjs --list-presets`.
- Add a preset boundary with `node JS/add-boundary.mjs --preset=蘇州市`.
- For a new Taiwan, Korea, or Japan city, add its polygon to `data/visited-boundaries.geojson`, then add a `source: "local"` boundary entry.
- Add a boundary from the command line with `node JS/add-boundary.mjs --label=蘇州市 --name=苏州市 --province=江蘇省`.
- Add alternate boundary names with `node JS/add-boundary.mjs --label=蘇州市 --names='苏州市|蘇州市' --province=江蘇省`.
- Run `node JS/validate-visited-places.mjs` after editing the list.
- Run `node JS/verify-map-runtime.mjs` to check that the map logic highlights configured boundary regions without point markers.
