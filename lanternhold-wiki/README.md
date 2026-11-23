# Lanternhold Wiki

The public player wiki at https://lanternhold.born2gamellc.com/wiki/.

It is generated from the game's own files on every publish, so it never drifts from the game:

- `core.js`: classes, skill trees, companions, banners, regions, monsters, gear, sets, enchants, camp jobs, relics, records, quests, lore
- `ui.js`: the in-game Delver's Guide (`GUIDE`), patch notes (`PATCH_NOTES`) and the Ember Ring tables (`RING_*`)
- `sprites.js` + `vector.js`: every picture, written out as SVG
- `index.html`: the icon set

The `johnmink1/lanternhold` deploy workflow runs `node lanternhold-wiki/build.js lanternhold site <url>` after copying the game,
which writes `site/wiki/**` and a full `site/sitemap.xml`. No dependencies.

Preview locally:

    node lanternhold-wiki/build.js lanternhold /tmp/site && cp -r lanternhold/. /tmp/site/ && python3 -m http.server -d /tmp/site 8000
    # then open http://localhost:8000/wiki/

When you add a new data table to the game, add a section for it in `build.js` (each page is one `ref({...})` call).
Region gear sets: any `SETS` entry with a `region` (biome index) and an optional `four` bonus shows on the Sets page automatically.
