# JourneySphere

JourneySphere 是一個可重用的 Leaflet 地圖元件，用來顯示使用者去過哪些國家與行政區。

它會把已造訪的區域填色，點擊即可切換狀態；地圖形狀預先編譯，資料按國家延遲載入，適合旅行地圖、個人網站或小型旅遊工具。

![JourneySphere 40 個已造訪行政區示意圖](docs/journeysphere-demo.svg)

上圖由 repo 內的 GeoJSON 產生：加拿大 12 個、美國 18 個、墨西哥 10 個已選行政區，共 40 個。未選區域保留線框，選取區域才填入國家色，呈現元件的實際效果。

## 快速使用

目前尚未發佈到 npm，可直接使用 source 或先打包。需要 Leaflet 1.9.4。

```js
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createCompiledJourneySphere } from './src/compiled.js';
import './src/style.css';

const journey = await createCompiledJourneySphere('#map', {
  leaflet: L,
  dataUrl: '/journeysphere-data/',
  visited: [], // 使用 data/catalog.json 裡的 region ID
  onChange: ({ visited, codeword }) => console.log(visited, codeword),
});
```

地圖容器需要指定高度，例如 `#map { height: 580px; }`。把 `data/` 複製到網站的 `/journeysphere-data/`，或直接參考 [範例](examples/index.html)。

推薦使用預先編譯版本。它會同時下載世界底圖與已造訪國家的形狀，直接在 Canvas 畫布套用 0／1 造訪狀態。座標投影、跨日期線處理和行政區索引都在建置時完成，瀏覽器不必重新計算，也不必先下載完整的區域目錄。沒去過的國家保持留白；已造訪區域上色，並保留原有的行政區邊界顯示規則。

- 套件使用者可從 `@williamzheng0711/journey-sphere/compiled` 匯入 `createCompiledJourneySphere`。
- 原本的 region ID 和 `js1_` codeword 可直接沿用，`codeword` 優先於 `visited`。
- 若需要目錄來建立搜尋器或選單，使用 `await journey.loadCatalog()`；新版不提供同步的 `journey.catalog`。
- 支援原有的狀態、配色、標籤、縮放及回呼選項；需要 Canvas `Path2D` 和 Leaflet 預設的 `CRS.EPSG3857`。`signal` 可取消載入並銷毀地圖。
- 將 `data/compiled/` 與程式中的 `data/compiled/manifest.js` 一起更新。自訂 atlas 要先執行 `npm run build:compiled`，並透過 `manifest` 選項傳入對應的 manifest。不要混用不同版本。

原有 `createJourneySphere` 仍從 `src/index.js`（套件根路徑）匯出，保留完整的 `catalog` 和 `atlas` API。它也會重疊下載已造訪國家的資料並延後建立標籤，但仍使用 GeoJSON 渲染。既有使用者需將匯入及建立函式改為上面的編譯版本，才能使用新的繪圖方式。若保留原版並自行載入 atlas，可呼叫 `loadAtlas(dataUrl, { visited, codeword, signal })` 提早開始國家資料請求。

效能對照的重現方式與測量範圍請看 [效能測試](docs/performance.md)。

## 主要功能

- 已造訪區域以國家顏色填滿，未造訪區域保持簡潔。
- 只顯示已造訪區域的名稱，點擊可開關造訪狀態。
- `getVisited()` / `setVisited()` 管理穩定的 region ID。
- `getCodeword()` / `setCodeword()` 將選擇保存成與 atlas 版本綁定的短字串。
- `reset()` 還原狀態，`destroy()` 清理地圖與監聽器。

## 資料與開發

目前 atlas 包含 259 個地理實體與 248 個國家／地區資料分片。資料來源、覆蓋範圍與授權請看 [data/README.md](data/README.md)；地理資料的授權條件與軟體 MIT 授權分開計算。

```sh
npm test
npm run check
npm run validate:data
npm run build:compiled
npm run pack:check
```

## Progressive startup and static deployments

JourneySphere is the source of truth for rendering, progressive loading, geometry
preparation and map behavior tests. Consumer websites own their HTML/CSS, visit
records, integration adapters and page benchmarks. Do not patch a deployed copy
of the renderer in a website.

`initialCountries` accepts a map of country codes to partial compiled payloads
containing the selected regions. Geometry, region indices and atlas fingerprints
are preserved. The initial map can render these regions before full country
shards arrive. `journey.detailsReady` resolves when initial-country details finish
loading, or rejects on download failure; the initial map remains usable. Handle
that promise or use `onError` when the application needs to report detail errors.
Without `initialCountries`, the existing full-country startup is retained.

Build a consumer deployment from this project:

```sh
node scripts/export-static.mjs --record /path/to/visits.json --out /path/to/site/packages/journey-sphere
```

The record contains `atlasVersion`, `visited` region IDs, and optional `labels`.
By default the export includes all compiled country shards. To copy only visited
countries and use a compatible pinned release for other countries, add
`--fallback-data-url https://your-host/pinned-release/data/`. The caller owns this
hosting choice. Export fetches the fallback manifest and rejects a release that
does not match the source atlas; runtime payload validation also rejects mismatches.
The exporter validates selections and writes canonical source files, data,
`data/startup.json`, licensing and source/output SHA-256 hashes. A source Git
commit is recorded when available, but hashes also capture uncommitted changes.
Use a dedicated output directory; rerunning overwrites generated files without
requiring manual map patches. Unreferenced files from earlier exports are left
in place and are not loaded by the generated manifest.

The consumer reads `data/startup.json` and passes its `visited`, `labels`, and
`countries` (as `initialCountries`) to `createCompiledJourneySphere`. Keep runtime,
manifest and data together when deploying. A website can check deployed file
hashes against `export-manifest.json` to detect accidental edits.

Run map regression checks here:

```sh
npm run check
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/test-map-progressive.mjs
```

The browser check needs an existing Playwright installation and Google Chrome.
Its sample visits come from this project's atlas, not a consumer website.
