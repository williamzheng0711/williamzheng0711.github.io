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

### Detailed basemap layers

The travel map keeps all geometry local and does not use remote map tiles.

- `data/refined-context-boundaries.geojson` contains the China 10m coastline, all 22 Taiwan county/city boundaries, and the five Great Lakes.
- North American state/province boundaries in `data/context-city-boundaries.geojson` use the lake-aware Natural Earth 10m source, so the United States–Canada boundary and Great Lakes remain legible when zooming.
- `data/visited-boundaries.geojson` includes the high-resolution Taiwan polygons for the visited locations, including 桃園市.
- The renderer keeps the current world plus adjacent off-screen copies ready during horizontal dragging; the viewport-aware minimum zoom keeps one world at least 1.2× wider than the map, so a location cannot be visible twice. Dateline-split countries such as Russia shift their polygon parts together. The complete bundle stays visible while dragging and is swapped atomically after `moveend`, so the map never exposes an unloaded edge. Vertical dragging is clamped to the Web Mercator poles.

To regenerate these data files, download Natural Earth's `ne_10m_admin_0_countries_lakes.geojson`, `ne_10m_lakes.geojson`, and `ne_10m_admin_1_states_provinces_lakes.geojson`, plus GADM's `gadm41_TWN_2.json.zip`, into one directory; then run:

```sh
node JS/build-refined-map-data.mjs --source-dir=/absolute/path/to/downloaded-map-sources
```
