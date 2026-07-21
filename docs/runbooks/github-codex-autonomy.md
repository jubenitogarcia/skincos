# GitHub → Codex autonomy on the mini-PC

## Boundary

GitHub Actions observes workflow completions. A low-privilege local runner forwards only an HMAC-protected workflow-run identifier to a loopback broker. The broker independently reads GitHub through a dedicated GitHub App, persists state by `branch + SHA`, and uses `codex exec` or `codex exec resume` in an isolated worktree.

The runner never has the GitHub App key, a Codex login, the broker worktree, or access to `C:\CodexRuntime\n8n`. No workflow in this integration checks out PR code. A public-repository PR can at most run as the unprivileged runner account; it cannot reach the broker without the Action secret and it cannot read the broker's state or credentials.

The broker does not expose a network listener: it binds only to `127.0.0.1:48189`, enforces a 64 KiB body limit, HMAC, five-minute timestamp window, nonce replay prevention, one broker lock and one lock per branch/SHA.

## Tracked surface

- `ops/github-autonomy/gate-policy.json` is the allowlist of workflows, trusted branch prefixes, required checks and protected paths.
- `ops/github-autonomy/github-autonomy.ps1` is the operator interface.
- `ops/github-autonomy/broker.ps1` receives/reconciles events. `mediator.ps1` is the only component allowed to obtain an installation token and publish or merge a vetted local commit.
- The three `codex-github-autonomy-*.yml` workflows do not checkout the repository.

Private state is always below `C:\CodexRuntime\operator\admin\skincos\github-autonomy\` and is never committed.

## One-time installation

Run the following in an elevated PowerShell. Supply strong, distinct passwords interactively; never put them into the repository or command history.

```powershell
$runnerPassword = Read-Host 'Password for skincos-gh-runner' -AsSecureString
$brokerPassword = Read-Host 'Password for skincos-codex-broker' -AsSecureString
New-LocalUser -Name skincos-gh-runner -Password $runnerPassword -AccountNeverExpires
New-LocalUser -Name skincos-codex-broker -Password $brokerPassword -AccountNeverExpires
```

Do not add either account to `Administrators`. Grant only `skincos-codex-broker` modify access to the private autonomy root and only `skincos-gh-runner` access to the GitHub Actions runner directory. Deny both accounts access to the shared service runtime and do not reuse the `admin` profile.

As `admin`, prepare private state and generate the HMAC secret:

```powershell
npm run github:autonomy -- install
```

Create a GitHub App restricted to `jubenitogarcia/skincos`. Grant only Metadata read, Contents read/write, Pull requests read/write, Checks read and Actions read. Download its PKCS#1 RSA private key to the configured private path, set the App and installation IDs in `runtime.config.json`, and keep the file ACL exclusive to the broker account. Add the generated `ingress-hmac.txt` value to the repository secret `AUTONOMY_INGRESS_HMAC`; do not print it.

Register the GitHub Actions Windows runner manually from repository **Settings → Actions → Runners**, using account `skincos-gh-runner`, labels `self-hosted`, `windows`, and `skincos-gh-autonomy`. Do not configure a credential, `CODEX_HOME`, GitHub App key or repository worktree in that account.

Install the broker Windows service as the broker account:

```powershell
$credential = Get-Credential '.\skincos-codex-broker'
npm run github:autonomy -- install -InstallBrokerService -BrokerCredential $credential
```

Install the official independent Codex CLI while signed in as `skincos-codex-broker`; do not reuse the protected App binary or the `admin` profile. Then log in only in that broker profile and create its isolated mirror/worktree before enabling the system:

```powershell
$env:CODEX_HOME = 'C:\CodexRuntime\operator\admin\skincos\github-autonomy\broker\codex-home'
powershell -ExecutionPolicy Bypass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
& 'C:\Users\skincos-codex-broker\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe' login --device-auth
npm run github:autonomy -- enable
Start-Service SkincosCodexGitHubBroker
```

## Operation and recovery

```powershell
npm run github:autonomy -- status
npm run github:autonomy -- pause
npm run github:autonomy -- resume
npm run github:autonomy -- logs
npm run github:autonomy -- drain
npm run github:autonomy -- disable
npm run github:autonomy -- uninstall
```

`pause` retains the queue but refuses new work. `disable` is the immediate reversible stop: it makes the broker ignore events before any Codex process starts. `uninstall` stops the service but deliberately preserves private logs and credentials for audited recovery; remove the service account, runner registration and private root only after logs have been retained.

The reconciliation workflow runs every ten minutes only to recover completed workflow events missed by the direct relay. It uses the same idempotency state, so it never intentionally restarts a completed run.

## Validation sequence

1. Run `npm run github:autonomy:test` locally.
2. With the broker running but disabled, dispatch **Codex GitHub Autonomy Probe** and confirm its relay is ignored.
3. Enable the broker and dispatch the probe twice. Verify the first record creates a session ID and the second invokes `codex exec resume` for that exact ID.
4. Confirm that events where `head_repository` differs from `jubenitogarcia/skincos` produce only a rejected log entry.
5. Review the state and sanitized JSONL logs, then enable the production workflow allowlist.

Do not regard the integration as live until steps 2–4 are observed in GitHub Actions and the broker logs.
