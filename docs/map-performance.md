# First-visit map loading

Baseline website commit: `b295e453926de6664f0e3eab9f045307c5729f87`.
Atlas release: `3b7fcbbded7a35b2574c6b74e8628f4ca330131e`.

## Cause and changes

The old page awaited the world and all nine visited-country shards before it
created a map. Those shards include many regions outside the 55 visited regions:
9,588,006 uncompressed bytes (4,028,634 bytes with gzip). A 5.7 MB portrait also
competed for bandwidth despite displaying at 168 by 168 CSS pixels. Map scripts,
styles and data depended on jsDelivr.

The new page serves the map runtime, world and frequently used country data from
the same origin. The first frame uses the world plus exact visited-region paths:
1,076,668 uncompressed bytes (490,278 with gzip), an 87.8% reduction in compressed
initial geometry. The original region IDs, atlas fingerprint, coordinate paths,
labels and codewords are preserved. Full country details download after first
paint. Selection updates operate on available bootstrap records immediately and
background completion never replaces the current selection. New selections
outside the bootstrap wait for their full country shard.

The portrait now uses a 640-pixel derivative of approximately 68 KB. The original
photo is retained.

## Validation

`node JS/verify-map-runtime.mjs` verifies the travel record, exact bootstrap
geometry, manifest identity and local startup resource paths.

`JS/benchmark-map.mjs` uses Google Chrome, empty browser contexts, gzip, 1.6 Mbps
bandwidth and 150 ms latency. It compares the previous HTML/adapter's full-data
startup with the new progressive startup using the same local server/runtime.
External fonts are blocked for both variants to keep that variable identical.
One warmup per variant precedes three alternating samples. The endpoint is two
animation frames after map creation, with all 55 visited regions available;
background completion is deliberately not part of this metric. This is a
controlled slow-network test, not a claim about every visitor's network or the
production CDN. It also verifies rendering, selection, codeword preservation,
zoom and reset.

Run the progressive-loading browser regressions from the JourneySphere project:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/test-map-progressive.mjs
```

## Measured result

Three cold samples per variant, after warmup:

| | Previous startup | Progressive startup |
| --- | ---: | ---: |
| Median map display | 27.793 s | 3.525 s |
| Completed resource bytes at display | 4,095,722 | 622,961 |

Map display was 87.3% faster in this controlled test. Raw samples are saved in
`docs/map-benchmark-results.json`. Rendering, selection, codeword preservation,
zoom and reset checks passed.

Progressive-loading regressions also passed with all nine country requests held:
bootstrap rendering and real region clicks remain usable, codewords round-trip,
and late full data preserves the user's selection. Simulated HTTP failures keep
the bootstrap usable; destruction cancels pending loads; mismatched bootstrap
fingerprints are rejected without unhandled background errors.

## Source ownership after integration cleanup

The performance figures above were measured before the source-ownership cleanup.
Map implementation and progressive regression tests now live in JourneySphere.
The website runs `node JS/sync-map.mjs` to generate `packages/journey-sphere/`,
including `data/startup.json`, from canonical map code and the personal travel
record. There are no website-only patches to the renderer. Homepage benchmarking,
portrait optimization and integration checks remain in this website project.

### Verification after ownership cleanup (2026-09-27)

A fresh run under the same controlled conditions measured 27.693 s baseline and
3.612 s current median map display (87.0% faster), with all 55 visited regions
available. Rendering, selection, codeword preservation, zoom and reset passed.
Raw samples: `docs/map-ownership-benchmark-results.json`.

JourneySphere's `npm run check` passed 61 tests. Its independent browser suite
passed with two country requests held, including codeword round-trips, late-data
selection preservation, detail failures, reset, destruction and invalid atlas
identity. The website's generated-asset and travel-record verification passed.
