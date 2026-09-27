# William Zheng's personal website

The homepage owns its layout, portrait and personal travel list.
JourneySphere owns map rendering, place-name lookup, styles and all geography.

## Edit visited places

Edit `data/travel-places.json`: a list of place names. No build or data sync is
needed. Push the page and the list as normal.

The page includes one pinned remote `JourneySphere/embed.js` module and a
`<journey-sphere>` element. `JS/site.js` gives the element the personal list and
connects the page's Reset button. All map dependencies and data load from the
JourneySphere release, never from this repository.

For ambiguous names, qualify with the region and ISO3 country, for example
`Middlesex County, Massachusetts, USA`. Unknown or ambiguous places show an error
rather than silently selecting another location.

## Verification

`node JS/verify-map-runtime.mjs` checks the consumer contract and the remote
release entry. Map tests, data generation and performance benchmarks belong in
the JourneySphere project. There is no local map package, boundary data, Leaflet
copy or synchronization command to maintain here.
