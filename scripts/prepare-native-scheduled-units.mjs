#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyNativeScheduledRelease } from "./verify-native-scheduled-release.mjs";

export function nativeScheduledUnits(sha, operatorHome = "/home/admin") {
  if (!/^[0-9a-f]{40}$/.test(sha) || operatorHome !== "/home/admin") throw new Error("scheduled unit identity is invalid");
  const base = `${operatorHome}/.local/share/skincos-native-gates`;
  const source = `${base}/releases/${sha}`;
  return Object.fromEntries(["architecture", "security"].flatMap((gate) => {
    const unit = `skincos-native-${gate}-audit`;
    const service = `[Unit]\nDescription=SKINCOS native ${gate} audit (trusted ${sha})\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nUser=admin\nGroup=admin\nWorkingDirectory=${source}\nUMask=0077\nEnvironment=HOME=${operatorHome}\nEnvironment=PATH=/usr/local/bin:/usr/bin:/bin\nExecStart=/usr/bin/flock --nonblock ${base}/${gate}.lock /usr/bin/node ${source}/scripts/run-native-scheduled-gate.mjs ${gate} run\nTimeoutStartSec=4h\nKillMode=control-group\nProtectSystem=strict\nProtectHome=tmpfs\nBindPaths=${base}\nBindPaths=${operatorHome}/.local/state/skincos-native-architecture-receipts\nBindPaths=${operatorHome}/.local/state/skincos-native-security-audit\nBindReadOnlyPaths=${operatorHome}/.local/share/skincos-native-security-tools\nReadWritePaths=/var/tmp\nInaccessiblePaths=/mnt/c /mnt/wslg /etc/skincos /var/lib/skincos-runtime /opt/skincos /run/credentials\nProtectKernelTunables=yes\nProtectControlGroups=yes\nProtectKernelModules=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\n\n[Install]\nWantedBy=multi-user.target\n`;
    const calendar = gate === "architecture" ? "*-*-* 03:17:00 UTC" : "Mon *-*-* 03:17:00 UTC";
    const timer = `[Unit]\nDescription=SKINCOS native ${gate} schedule\n\n[Timer]\nOnCalendar=${calendar}\nPersistent=true\nAccuracySec=1min\nUnit=${unit}.service\n\n[Install]\nWantedBy=timers.target\n`;
    return [[`${unit}.service`, service], [`${unit}.timer`, timer]];
  }));
}

function prepare(sha) {
  if (process.platform !== "linux" || process.getuid() === 0) throw new Error("prepare scheduled units as the Ubuntu operator");
  verifyNativeScheduledRelease(sha);
  const directory = path.join(os.homedir(), ".local/share/skincos-native-gates/units", sha);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error("scheduled unit checkpoint custody is invalid");
  for (const folder of ["skincos-native-architecture-receipts", "skincos-native-security-audit"]) {
    const target = path.join(os.homedir(), ".local/state", folder);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const entry = fs.lstatSync(target);
    if (entry.isSymbolicLink() || entry.uid !== process.getuid() || (entry.mode & 0o777) !== 0o700) throw new Error("scheduled receipt custody is invalid");
  }
  const units = nativeScheduledUnits(sha, os.homedir());
  for (const [name, content] of Object.entries(units)) fs.writeFileSync(path.join(directory, name), content, { mode: 0o600, flag: "wx" });
  return { sourceSha: sha, unitDirectory: directory, units: Object.keys(units), installed: false, activated: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--sha") throw new Error("usage: prepare-native-scheduled-units --sha <40-char SHA>");
    process.stdout.write(`${JSON.stringify(prepare(process.argv[3]), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
