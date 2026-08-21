import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const documentationFiles = [
  "messaging/channels/whatsapp/engine/.env.example",
  "messaging/channels/whatsapp/engine/GUIA-RAPIDO.md",
  "messaging/channels/whatsapp/engine/MIGRATION.md",
  "messaging/channels/whatsapp/engine/SUCESSO-INSTALACAO.md",
];

const credentialContext = /(AUTHENTICATION_API_KEY|API_AUDIO_CONVERTER_KEY|apikey|authorization)\b/i;
const hexCredential = /\b[0-9a-f]{32,}\b/gi;

test("WhatsApp documentation contains no long hexadecimal credential in auth context", () => {
  const offenders = [];

  for (const relativeFile of documentationFiles) {
    const absoluteFile = path.join(repositoryRoot, relativeFile);
    if (!existsSync(absoluteFile)) continue;

    const lines = readFileSync(absoluteFile, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!credentialContext.test(line)) return;
      if (hexCredential.test(line)) {
        offenders.push({ file: relativeFile, line: index + 1 });
      }
      hexCredential.lastIndex = 0;
    });
  }

  assert.deepEqual(offenders, []);
});
