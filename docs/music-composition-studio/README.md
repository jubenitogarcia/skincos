# Music Composition Studio

`music-composition-studio` is an isolated, mock-first music-production domain
for Orb. It transforms a structured briefing into a locked Music Constitution,
candidate compositions, an animatic, stems, arrangement, mix/master fixtures,
QA, and a portable package. It never publishes, distributes, schedules, or
activates anything.

From `orb/engine` in Ubuntu-24.04 run:

```bash
npm run workflow:music:build
npm run workflow:music:validate
npm run workflow:music:test
npm run workflow:music:dry-run
```

The generated n8n import package contains one inactive, control-plane-only
workflow: `Music Composition Studio (Unified)`. The former MSC-00…MSC-99
exports are archived snapshots, not operational workflows. Audio uses URIs; the
deterministic WAV service is only local dry-run evidence.
