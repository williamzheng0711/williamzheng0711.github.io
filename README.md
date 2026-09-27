# William Zheng's personal website

歡迎來到我的主頁 :)

## Ownership

This project owns the homepage, portrait, personal travel record, map adapter and
website integration/performance checks. JourneySphere owns map rendering,
progressive loading, atlas processing, deployment generation and map regression tests.

`packages/journey-sphere/` is generated deployment output, not a second map source
tree. Never edit it directly. Its `export-manifest.json` records exact source and
output hashes. The website serves these files locally for fast first visits.
`packages/leaflet/` is the unchanged Leaflet 1.9.4 distribution used by the page.

## Update the travel map

After editing `data/journeysphere-visits.json` or changing JourneySphere:

```sh
node JS/sync-map.mjs
node JS/verify-map-runtime.mjs
```

The sync command calls the exporter in the sibling `../journey-sphere` checkout.
Set `JOURNEY_SPHERE_SOURCE=/path/to/journey-sphere` for another location. It copies
canonical runtime files, generates exact visited-region startup geometry, and
copies the required country shards automatically. Other countries use the pinned
compatible atlas URL configured in `JS/sync-map.mjs`; update it with atlas releases.
Sync checks the remote manifest against the source atlas before writing output,
and requires network access when this fallback is configured.
The deployed site does not need the source checkout or Node.js.

Map behavior tests run in JourneySphere. Homepage cold-cache measurements and
render/selection/zoom/reset integration checks remain here:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node JS/benchmark-map.mjs
```

See [the performance report](docs/map-performance.md) for measurement conditions.
The optimized portrait and original photo are both retained.
