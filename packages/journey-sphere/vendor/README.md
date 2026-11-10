# Browser dependency

`leaflet/` retains the unmodified Leaflet 1.9.4 ES-module distribution, CSS and
images from the installed Leaflet package. Its BSD-2-Clause license is retained
in `leaflet/LICENSE`.

JourneySphere's remote entry loads `leaflet/leaflet.esm.min.js`, generated from
the inspectable `leaflet/leaflet-src.esm.js` with pinned, build-only Terser 5.51.2.
The production file keeps the Leaflet copyright banner, every named export, and
all public and private property names. It uses no property mangling or unsafe
compression. See the [Terser API](https://terser.org/docs/api-reference/) for
the ES module and mangling options.

Run `npm ci` and `npm run build:engine` to rebuild, or `npm run check:engine` to
verify the committed files. `leaflet/engine-build.json` records the source and
license SHA-256 hashes, minifier version/options, and output SHA-256 hash. Builds
contain no timestamp or machine paths, so the output is reproducible. Source
or minifier changes require deliberately updating the pinned build inputs.

The browser downloads the engine from JourneySphere's own immutable release;
consumers do not install or copy Leaflet or the build tools.
