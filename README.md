myPage

## Travel map data

Visited places are maintained in `JS/visited-places.js`.

The visible list is `VISITED_PLACES`. The map is polygon-only: every entry must match a feature in `data/visited-boundaries.geojson` through `properties.name`.

- Greater China entries use `#000095` automatically. Mainland city example: `{ type: "boundary", label: "蘇州市", names: ["苏州市"], province: "江蘇省" }`
- Municipalities use `style: "municipality"` and SARs use `style: "sar"`; they still render with the Greater China color.
- Taiwan entries use `source: "local", group: "taiwan"`, e.g. `{ type: "boundary", label: "台中市", names: ["臺中市"], source: "local", group: "taiwan" }`
- Korea entries use `source: "local", group: "korea"` and render as `#C60C30`.
- Japan entries use `source: "local", group: "japan"` and render as `#D66A35`.
- United States entries use `source: "local", group: "usa"` and render as `#00205B`.
- Singapore entries use `source: "local", group: "singapore"` and render as `#EF3340`.
- If the city is not already in `data/visited-boundaries.geojson`, add a GeoJSON Feature first. Its `properties.name` must exactly match one of the strings in `names`.
- List known presets with `node JS/add-boundary.mjs --list-presets`.
- Add a bundled preset with `node JS/add-boundary.mjs --preset=城市名`; the script refuses entries whose polygon is not yet bundled.
- Add a boundary manually with `node JS/add-boundary.mjs --label=蘇州市 --name=苏州市 --province=江蘇省`.
- Run `node JS/validate-visited-places.mjs` after editing the list.
- Run `node JS/verify-map-runtime.mjs` to check that all configured places render as boundary fills without point markers or remote map tiles.
