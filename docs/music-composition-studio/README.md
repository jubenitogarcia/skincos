# Music Composition Studio

`music-composition-studio` is an isolated, mock-first Orb domain. It turns a
structured request into a locked Music Constitution, bounded candidate/DNA
selection, song animatics, stems, vocals when authorized, arrangements,
mix/master manifests, multilevel QA and a portable `MUSIC_PACKAGE`.

The generated n8n package contains one workflow only:
`Music Composition Studio (Unified)`. MSC-10 through MSC-90 run inline and
errors route to inline MSC-99. There are no Execute Workflow nodes. The 11
former MSC module identities are inactive archive descriptors outside the
operational package.

From [the independent Orb repository](https://github.com/jubenitogarcia/orb) in Ubuntu-24.04:

```bash
npm run workflow:music:build
npm run workflow:music:validate
npm run workflow:music:test
npm run workflow:music:dry-run
npm run lint
npm run workflow:music:migration-test
npm run workflow:music:n8n-import-test
# complete gate:
npm run workflow:music:verify
```

The default is deliberately inactive and mock-only. It never publishes,
distributes, schedules or activates content. Audio traverses n8n as URI and
metadata only.
