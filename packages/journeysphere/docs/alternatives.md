# Related projects and data sources

Checked 2026-09-12. JourneySphere preserves this site's Leaflet flat map; a globe or React migration is not necessary.

| Project | Useful capabilities | What JourneySphere adds |
| --- | --- | --- |
| [Leaflet](https://leafletjs.com/reference.html#geojson) | Framework-independent GeoJSON, canvas, pan/zoom; MIT | A ready atlas, visit state, country styles, land-only preprocessing and selective subdivisions |
| [jsVectorMap](https://github.com/themustafaomar/jsvectormap) | Vector maps, region styling, tooltips | Versioned global administrative IDs and regional source policy |
| [React Simple Maps](https://www.react-simple-maps.io/docs/geographies/) | React SVG maps with GeoJSON/TopoJSON | A framework-independent package with an opinionated travel data model |
| [visited-countries-map](https://github.com/tomi5/visited-countries-map) | An existing visited-country application | Reusable administrative-region package rather than a country-level application |

No matching maintained package was found in this bounded search; this is not a claim that none exists. The npm registry returned 404 for `journeysphere` on this date. Availability must be checked again when publishing; the name has not been reserved or registered.

[geoBoundaries gbOpen](https://www.geoboundaries.org/api.html) provides administrative boundaries with attribution. [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) provides public-domain land geometry. Source release, coverage, and individual attribution belong in the atlas manifest. [GADM](https://gadm.org/license.html) restricts redistribution/commercial use, so the site's legacy GADM files must not silently become public package defaults.
