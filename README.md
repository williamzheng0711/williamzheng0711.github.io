# William Zheng's personal website

The homepage owns its layout, portrait and personal travel list.
JourneySphere owns map rendering, place-name lookup, styles and all geography.

## Edit visited places

Edit `data/travel-places.json`: a list of place names. No build or data sync is
needed. Push the page and the list as normal.

The page includes a generated `packages/journey-sphere/embed.js` module and a
`<journey-sphere>` element. `JS/site.js` gives the element the personal list and
connects the page's Reset button. The small map runtime is served with this site.
Geographic data loads directly from a full commit SHA of the JourneySphere
repository through `data-base-url`. This avoids jsDelivr's 50 MB package limit,
which can return 403 for this atlas even when some files remain cached.

To update the runtime, run this command from the JourneySphere project:

```sh
node scripts/export-embed.mjs --out ../williamzheng0711.github.io/packages/journey-sphere --data-base-url https://raw.githubusercontent.com/williamzheng0711/journey-sphere/5079212a661d9bd2b73dfcb7d1e2ca3adfb60633/data/embed/
```

Use the intended full data commit in the command, the element's
`data-base-url`, and the world-data preload in the page head. The exporter checks atlas and alias compatibility and records generated
file hashes. Make map changes in JourneySphere and regenerate this directory.
Editing the personal place list still needs no build.

The page preloads the initial map modules, styles, Leaflet engine and world
overview. It also connects to the data host early. Font styles load in the
background, so a slow font request does not delay map startup.

For ambiguous names, qualify with the region and ISO3 country, for example
`Middlesex County, Massachusetts, USA`. Unknown or ambiguous places show an error
rather than silently selecting another location.

## Verification

`node JS/verify-map-runtime.mjs` checks the consumer contract, fixed data revision
and generated runtime hashes. Map tests, data generation and performance
benchmarks belong in the JourneySphere project. This site contains no boundary
data or manually maintained map implementation.
