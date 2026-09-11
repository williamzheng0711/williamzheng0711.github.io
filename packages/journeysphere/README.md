# JourneySphere

A framework-independent Leaflet map for showing visited administrative regions. The homepage in this repository uses this package directly.

- Translucent country colors with a documented cultural source.
- Only land is highlighted; oceans are clipped during atlas generation.
- Within visited countries, state/province/prefecture outlines remain visible; internal regional outlines appear only inside first-level divisions with a selected region.
- Hover labels appear only for visited regions; unvisited regions remain unlabeled until selected.
- Persistent Canvas layers, inertial dragging, three cached world copies and lazy country loading.
- Stable region IDs, optional version-bound bitset codewords, multiple instances and explicit teardown.

## Use

JourneySphere is prepared as an npm package but has **not been published**. Until publication, install its packed tarball or use the source directly. It requires Leaflet 1.9.4 and its stylesheet; it adds no other runtime dependency.

```js
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createJourneySphere } from 'journeysphere';
import 'journeysphere/style.css';

const journey = await createJourneySphere('#map', {
  leaflet: L,
  dataUrl: '/journeysphere-data/',
  visited: [], // IDs from data/catalog.json
  onChange: ({ visited, codeword }) => console.log(visited, codeword),
});
```

Give the container a height (for example `height: 580px`). Copy the package's `data/` folder into your static hosting directory as `/journeysphere-data/`. This explicit `dataUrl` is recommended for bundlers because JSON/GeoJSON assets are fetched rather than imported. Direct ESM use defaults to `../data/` relative to the package source and needs no build. The [example](examples/index.html) runs when this directory is served over HTTP.

The input IDs determine visits; the component never changes or saves a site's source files. Persist changes through `onChange` if desired. The default homepage keeps click changes only until reload or reset.

## API

`createJourneySphere(elementOrSelector, options)` returns a promise for a controller:

| Member | Purpose |
| --- | --- |
| `getVisited()` | A copy of selected stable IDs |
| `setVisited(ids)` | Validate IDs, load needed countries, then update the map |
| `getCodeword()` | Encode current selection against this atlas |
| `setCodeword(word)` | Validate and restore encoded selection |
| `reset()` | Restore initial selection and view |
| `destroy()` | Remove map, listeners and resize observer |
| `map` | Underlying Leaflet map |
| `catalog` | Atlas version, ordered IDs, country availability and provenance |

Options include `leaflet`, `dataUrl`, a custom `atlas`, `visited` or `codeword`, `center`, `zoom`, `maxZoom`, `fillOpacity` (default `0.44`), `colors` (ISO3 → CSS color), `labels` (region ID → text), `interactive`, `onChange`, `onError` and `mapOptions`. Keep default wrapping/canvas options unless deliberately changing map behavior. Labels are inserted as text, never interpreted as HTML, and are bound only to visited regions.

`loadAtlas(dataUrl)` loads global land, catalog and palette; country boundaries load on demand. A custom atlas has `{world, catalog, palette, loadCountry(code, { signal })}`. Honor the supplied abort signal in custom loaders so `destroy()` can cancel pending requests. Its country features must have `{id, name, countryCode, adminLevel, parentId}`. Supply first-level outlines in each shard’s `admin1` FeatureCollection with `{id, name, countryCode}` properties. A region without `parentId` reveals only itself when selected, rather than revealing its entire country; world features require `countryCode`. Use ISO3 codes and IDs prefixed by `${countryCode}:`. Custom geometry must already be land-clipped. The renderer does not perform expensive GIS clipping in the browser.

## Travel state

```js
import { encodeVisited, decodeVisited, validateVisited } from 'journeysphere/state';
const catalog = { version: 'my-atlas-v1', regionIds: ['SGP:ADM0:SGP'] };
validateVisited(['SGP:ADM0:SGP'], catalog); // true, or throws
const word = encodeVisited(['SGP:ADM0:SGP'], catalog);
const ids = decodeVisited(word, catalog);
```

Stable ID arrays are the preferred editable record. Codewords are compact bitsets bound to the **version and ordered ID catalog**, and reject mismatched datasets. The fingerprint detects accidental incompatibility; it is not a cryptographic signature. Do not reuse a version after changing region identities. When upgrading an atlas, migrate ID arrays explicitly and encode again; never reinterpret old bitmap positions.

## Geographic policy and attribution

The bundled atlas covers 259 geographic entities with 248 country/territory shards and a versioned selectable-region catalog. Eleven disputed or special-purpose map units remain context-only. Read the generated atlas catalog and data documentation for actual per-country coverage, administrative-level exceptions, source revisions, licenses and coastline resolution. A nominal `ADM2` can describe different real-world levels in different sources. China uses the requested prefecture concept; Korea's special and metropolitan cities use one first-level city region each; tiny countries use one country region. Missing subdivisions must be recorded as unavailable rather than silently advertising country polygons as ADM2.

Country borders follow the chosen source's geographic representation and are configurable data, not a political assertion. Cultural palette notes describe design inspiration. The default China blue follows the site owner's requested Blue Sky with a White Sun reference, and Japan uses chrysanthemum gold. Neighbor contrast is a preference, not a guarantee for every boundary.

Software: MIT. Geographic data: its separately documented source terms. Legacy website GADM files are excluded. Before public distribution, resolve the documented DataV upstream licensing uncertainty for the Chinese prefecture source; the repository declaring MIT does not by itself settle upstream data rights. See [alternatives and research](docs/alternatives.md).

## Maintain and extract

```
packages/journeysphere/
  src/          renderer, geometry helpers, state codec, styles
  data/         versioned global atlas, country shards, palette and sources
  scripts/      reproducible atlas generation and validation
  test/         package-owned regression tests
  examples/     standalone consumer
  docs/         implementation decisions and research
  package.json
```

Run `npm test`, `npm run check` and `npm pack --dry-run` here. No compilation is required. Move this entire directory to a separate repository when ready. Keep the homepage's `JS/site.js` and personal `data/journeysphere-visits.json` in the website repository; replace its relative import with the installed package and host that package's versioned data. Publish only after verifying the name again and reviewing generated data attribution. Nothing is automatically published by this workflow.
