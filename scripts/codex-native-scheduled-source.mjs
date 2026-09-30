import { spawnSync } from "node:child_process";

export const SKINCOS_PUBLIC_REMOTE = "https://github.com/jubenitogarcia/skincos.git";

export function publicGitEnvironment() {
  // This read-only repository is public. Scheduled source reads do not use
  // interactive operator auth, inherited checkout bindings, or credential helpers.
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "",
  };
}

export function publicMainSha() {
  const result = spawnSync("git", ["ls-remote", "--exit-code", SKINCOS_PUBLIC_REMOTE, "refs/heads/main"], {
    env: publicGitEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024, timeout: 60_000,
  });
  const match = String(result.stdout || "").trim().match(/^([0-9a-f]{40})\s+refs\/heads\/main$/);
  if (result.error || result.status !== 0 || !match) throw new Error("canonical public main SHA is unavailable");
  return match[1];
}
