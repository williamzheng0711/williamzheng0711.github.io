# JourneySphere extraction plan

Preserve the existing Leaflet flat-map appearance, translucent country fills, hover labels, click toggles, reset and continuous horizontal panning. Baseline before edits: existing runtime and visited-place validators both pass (50 places).

1. Separate versioned atlas geometry from user-selected stable IDs.
2. Reuse dateline helpers; retain Leaflet as an injected peer, avoiding a second renderer dependency.
3. Keep cached world copies and update styles only on visit changes; no layer rebuild on ordinary pan.
4. Generate land-clipped country shards with source and coverage metadata; show administrative boundaries only for visited countries.
5. Migrate the homepage via a thin adapter. Test state, geometry, data integrity, packaging and actual browser interactions.

Package and data tests belong inside the package. Personal travel records and website navigation stay outside. Data coverage and licensing gaps must be explicit.
