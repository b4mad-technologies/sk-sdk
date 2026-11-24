# Self-hosted MapLibre glyph PBFs

`Noto Sans Regular/{range}.pbf` — OFL-licensed Noto Sans ranges vendored from
the VersaTiles glyph set for offline MapLibre label rendering. No external
font CDN is used at runtime (`GET /w/<slug>/fonts/{fontstack}/{range}.pbf`).

Only a few ranges are vendored; the style's labels carry emoji whose ranges are
not, and MapLibre draws those locally. A missing range answers an empty `200`
PBF (zero-length body) only when the range is well-formed
(`<start>-<end>.pbf`, `start` a multiple of 256, `end` = `start + 255`,
`start` ≤ 65280) and the font-stack directory exists here. An unknown font
stack or a malformed range stays `404` (`packages/spellkave-mcp/src/tiles.ts`).
The empty answer carries `cache-control: public, max-age=300`; a vendored
range carries `max-age=86400`. A read failure other than a missing file
answers `500` with `no-store`, never an empty range.
