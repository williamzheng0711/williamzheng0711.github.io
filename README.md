myPage

## Travel map data

Visited places are maintained in `JS/visited-places.js`.

- Add mainland China or SAR administrative regions as `type: "boundary"`.
- Add Taiwan, Korea, Japan, or other city-level places as `type: "marker"` with `[longitude, latitude]`.
- Copy examples from `PLACE_TEMPLATES` in `JS/visited-places.js` when adding a new entry.
- Add a boundary from the command line with `node JS/add-boundary.mjs --label=蘇州市 --name=苏州市 --province=江蘇省`.
- Add alternate boundary names with `node JS/add-boundary.mjs --label=蘇州市 --names='苏州市|蘇州市' --province=江蘇省`.
- Add a marker from the command line with `node JS/add-marker.mjs --label=東京 --lng=139.6917 --lat=35.6895 --group=japan`.
- Move a crowded marker label with `--offset-x` and `--offset-y`, for example `node JS/add-marker.mjs --label=奈良 --lng=135.8048 --lat=34.6851 --group=japan --offset-x=8 --offset-y=10`.
- Run `node JS/validate-visited-places.mjs` after editing the list.
- Run `node JS/verify-map-runtime.mjs` to check that the map logic highlights the configured boundaries and markers.
