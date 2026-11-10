# Generated JourneySphere embed runtime

This directory is generated from the JourneySphere project. Keep map changes in that project and rerun scripts/export-embed.mjs. Do not patch the copied runtime by hand.

Load the local embed.js script from this directory and set each <journey-sphere> element's data-base-url to:

https://raw.githubusercontent.com/williamzheng0711/journey-sphere/5079212a661d9bd2b73dfcb7d1e2ca3adfb60633/data/embed/

The runtime is served by the consuming website. Geometry and place indexes are fetched from this pinned GitHub commit, so no large geometry corpus or jsDelivr package request is needed. Keep this data URL with the generated runtime when deploying.

export-manifest.json records the source base commit, exact source hashes (including local changes), output hashes and dataBaseUrl. The source base commit alone does not identify uncommitted changes. Software and geographic-data attribution are in LICENSE and data/README.md; vendor licenses are retained under vendor/.
