import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const devPagesPath = path.join(repositoryRoot, 'crm', 'console', 'scripts', 'dev_pages.sh');
const browserLauncherPath = path.join(repositoryRoot, 'scripts', 'open-crm-local-browser.ps1');
const whatsappAdapterPath = path.join(repositoryRoot, 'scripts', 'run-local-whatsapp-orchestrator.sh');
const crmRunnerPath = path.join(repositoryRoot, 'scripts', 'run-local-crm.sh');

async function makeIsolatedFixture() {
  const fixtureParent = await mkdtemp(path.join(os.tmpdir(), 'crm-local-isolation-'));
  const consoleRoot = path.join(fixtureParent, 'console');
  const persistRoot = path.join(fixtureParent, 'private-runtime');
  const artifactRoot = path.join(fixtureParent, 'immutable-dist');
  const fakeBin = path.join(fixtureParent, 'bin');
  const capturePath = path.join(fixtureParent, 'wrangler-args.txt');

  await mkdir(path.join(consoleRoot, 'scripts'), { recursive: true });
  await mkdir(path.join(consoleRoot, 'dist'), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(path.join(consoleRoot, 'public'), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await cp(devPagesPath, path.join(consoleRoot, 'scripts', 'dev_pages.sh'));
  await writeFile(path.join(consoleRoot, 'dist', 'index.html'), 'built\n');
  await writeFile(path.join(consoleRoot, 'dist', '_routes.json'), 'dist-sentinel\n');
  await writeFile(path.join(artifactRoot, 'index.html'), 'immutable-build\n');
  await writeFile(path.join(artifactRoot, '_routes.json'), 'immutable-routes\n');
  await writeFile(path.join(consoleRoot, 'public', '_routes.json'), 'public-sentinel\n');
  await writeFile(path.join(consoleRoot, '.dev.vars'), 'dev-vars-sentinel\n');
  await writeFile(path.join(fakeBin, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
  await writeFile(
    path.join(fakeBin, 'npx'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n',
  );
  await chmod(path.join(fakeBin, 'npm'), 0o755);
  await chmod(path.join(fakeBin, 'npx'), 0o755);

  return { fixtureParent, consoleRoot, persistRoot, artifactRoot, fakeBin, capturePath };
}

test('isolated Pages mode keeps shared files immutable and binds the full local identity', async (t) => {
  const fixture = await makeIsolatedFixture();
  t.after(() => rm(fixture.fixtureParent, { recursive: true, force: true }));

  const result = spawnSync('bash', [path.join(fixture.consoleRoot, 'scripts', 'dev_pages.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
      CAPTURE_FILE: fixture.capturePath,
      CRM_LOCAL_ISOLATED: '1',
      R2_PERSIST_DIR: fixture.persistRoot,
      CRM_DIST_DIR: fixture.artifactRoot,
      LOCAL_AUTH_BYPASS: 'true',
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_TEST_USER_ADMIN: 'false',
      LOCAL_AUTH_USERNAME: 'isolated-user',
      LOCAL_AUTH_EMAIL: 'isolated@example.test',
      LOCAL_AUTH_NAME: 'Isolated User',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
      LOCAL_AUTH_ALLOWED_UNITS: 'unit-a',
      AUTH_API_TARGET: 'http://127.0.0.1:8110',
      CRM_API_TARGET: 'http://127.0.0.1:8112',
      TRACKING_API_TARGET: 'http://127.0.0.1:8113',
      UNIT_MONITOR_API_TARGET: 'http://127.0.0.1:8114',
      LOCAL_INSUMOS_API_TARGET: 'http://127.0.0.1:8101',
      LOCAL_WA_ORCHESTRATOR_API_TARGET: 'http://127.0.0.1:8111',
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(await readFile(path.join(fixture.consoleRoot, '.dev.vars'), 'utf8'), 'dev-vars-sentinel\n');
  assert.equal(
    await readFile(path.join(fixture.consoleRoot, 'dist', '_routes.json'), 'utf8'),
    'dist-sentinel\n',
  );
  assert.equal(
    await readFile(path.join(fixture.artifactRoot, '_routes.json'), 'utf8'),
    'immutable-routes\n',
  );

  const wranglerArguments = (await readFile(fixture.capturePath, 'utf8')).trim().split('\n');
  assert.ok(wranglerArguments.includes('/dev/null'));
  assert.ok(wranglerArguments.includes(fixture.persistRoot));
  assert.ok(wranglerArguments.includes(fixture.artifactRoot));
  for (const binding of [
    'LOCAL_AUTH_BYPASS=true',
    'LOCAL_AUTH_ROLE=CONSULTOR',
    'LOCAL_AUTH_TEST_USER_ADMIN=false',
    'LOCAL_AUTH_USERNAME=isolated-user',
    'LOCAL_AUTH_EMAIL=isolated@example.test',
    'LOCAL_AUTH_NAME=Isolated User',
    'LOCAL_AUTH_ALLOWED_MODULES=atendimento,ponto',
    'LOCAL_AUTH_ALLOWED_UNITS=unit-a',
    'AUTH_API_TARGET=http://127.0.0.1:8110',
    'AUTH_PATH_PREFIX=/insumos/auth',
    'CRM_API_TARGET=http://127.0.0.1:8112',
    'TRACKING_API_TARGET=http://127.0.0.1:8113',
    'UNIT_MONITOR_API_TARGET=http://127.0.0.1:8114',
    'ESCALA_API_TARGET=https://escala-api.skincos.com.br',
    'LOCAL_ESCALA_MOCK=false',
    'LOCAL_ESCALA_SHADOW_WRITES=true',
    'INSUMOS_API_TARGET=http://127.0.0.1:8101',
    'WA_ORCHESTRATOR_API_TARGET=http://127.0.0.1:8111',
    'ATENDIMENTO_API_TARGET=http://127.0.0.1:8111',
  ]) {
    assert.ok(wranglerArguments.includes(binding), `missing binding: ${binding}`);
  }
});

test('isolated Pages mode refuses implicit or source-tree persistence', async (t) => {
  const fixture = await makeIsolatedFixture();
  t.after(() => rm(fixture.fixtureParent, { recursive: true, force: true }));
  const baseEnvironment = {
    ...process.env,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    CAPTURE_FILE: fixture.capturePath,
    CRM_LOCAL_ISOLATED: '1',
  };

  const implicitResult = spawnSync(
    'bash',
    [path.join(fixture.consoleRoot, 'scripts', 'dev_pages.sh')],
    { encoding: 'utf8', env: baseEnvironment },
  );
  assert.equal(implicitResult.status, 2);
  assert.match(implicitResult.stderr, /R2_PERSIST_DIR absoluto e explícito/);

  const sourceTreeResult = spawnSync(
    'bash',
    [path.join(fixture.consoleRoot, 'scripts', 'dev_pages.sh')],
    {
      encoding: 'utf8',
      env: { ...baseEnvironment, R2_PERSIST_DIR: path.join(fixture.consoleRoot, 'runtime') },
    },
  );
  assert.equal(sourceTreeResult.status, 2);
  assert.match(sourceTreeResult.stderr, /fora da árvore fonte/);
});

test('Vite uses strictPort and the local adapter refreshes dependencies by lockfile hash', async () => {
  const devPages = await readFile(devPagesPath, 'utf8');
  const whatsappAdapter = await readFile(whatsappAdapterPath, 'utf8');
  const crmRunner = await readFile(crmRunnerPath, 'utf8');

  assert.match(devPages, /--strictPort/);
  assert.match(whatsappAdapter, /export HARMONIA_WORKER_ENABLED=false/);
  assert.match(whatsappAdapter, /sha256sum .*package-lock\.json/);
  assert.match(whatsappAdapter, /package_lock_hash.*recorded_package_lock_hash/);
  assert.match(whatsappAdapter, /package_lock_state_tmp=.*\$\$/);
  assert.match(whatsappAdapter, /mv -f "\$package_lock_state_tmp" "\$package_lock_state"/);
  assert.match(whatsappAdapter, /ROLE_POLICY_FILE="\$\{CRM_ROLE_POLICY_FILE:-\$ROOT_DIR\/crm\/console\/modules\/localRolePolicy\.json\}"/);
  assert.match(whatsappAdapter, /CRM_ROLE_POLICY_FILE="\$ROLE_POLICY_FILE"/);
  assert.match(whatsappAdapter, /crm_local_wa_runtime_database_name/);
  assert.match(whatsappAdapter, /postgres-create\.lock/);
  assert.match(whatsappAdapter, /--template template0/);
  assert.match(whatsappAdapter, /CRM_LOCAL_WA_PG_DUMP_BIN/);
  assert.match(whatsappAdapter, /skincos_crm_local_runtime/);
  assert.match(whatsappAdapter, /alter database \$temporary_database rename to \$target_database/);
  assert.doesNotMatch(
    whatsappAdapter,
    /DEFAULT_DATABASE_URL="postgresql:\/\/\$\{RUN_AS_USER\}@\/skincos_crm_local/,
  );
  assert.match(crmRunner, /export WRANGLER_REGISTRY_PATH="\$CRM_WRANGLER_REGISTRY_PATH"/);
  assert.match(crmRunner, /--ip 127\.0\.0\.1\s+\\\s+--port "\$CRM_INSUMOS_PORT"/);
  assert.match(crmRunner, /readlink -f "\$FRONTEND_DIR\/node_modules"/);
  assert.match(
    crmRunner,
    /\/mnt\/c\/CodexRuntime\/operator\/admin\/skincos\/source\/crm-local-gestor-main/,
  );
  assert.match(crmRunner, /migration_root="\$CRM_RUNTIME_ROOT\/state\/legacy-dependencies"/);
  assert.match(crmRunner, /mv -- "\$FRONTEND_DIR\/node_modules" "\$migration_target"/);
  assert.match(crmRunner, /existing_dependency_relative.*\^\[a-f0-9\]\{64\}\/node_modules\$/);
  assert.match(crmRunner, /rm -- "\$FRONTEND_DIR\/node_modules"/);
  assert.match(crmRunner, /CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION.*0/);
  assert.match(
    await readFile(path.join(repositoryRoot, 'scripts', 'run-shared-codex-shortcut.ps1'), 'utf8'),
    /CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION=1/,
  );
  assert.doesNotMatch(crmRunner, /PORT="\$CRM_INSUMOS_PORT".*insumos\.sh dev/);
  assert.match(crmRunner, /powershell\.exe .*>>"\$browser_log" 2>&1; then/s);
  assert.doesNotMatch(
    crmRunner,
    /-ProfilePath "\$browser_profile_windows" >\/dev\/null 2>&1 &/,
  );
  assert.match(whatsappAdapter, /crm_local_wa_validate_privileged_inputs/);
  assert.match(whatsappAdapter, /LOCAL_WA_ADAPTER_RUN_AS_USER" != "admin"/);
  assert.match(
    whatsappAdapter,
    /runtime\/crm-local\/instances\/\$\{BASH_REMATCH\[2\]\}\/\$\{BASH_REMATCH\[1\]\}\/state\/whatsapp/,
  );
  assert.match(
    whatsappAdapter,
    /source\/crm-local\/immutable/,
  );
  assert.match(
    whatsappAdapter,
    /home\/admin\/\.cache\/skincos\/crm-local\/\$LOCAL_WA_ADAPTER_RUNTIME_ID\/whatsapp/,
  );
});

test('privileged WhatsApp stage rejects caller-controlled paths before any mutation', () => {
  const adapter = whatsappAdapterPath.replaceAll('\\', '/');
  const result = spawnSync('bash', ['-lc', `
set -euo pipefail
export CRM_LOCAL_WA_LIBRARY_ONLY=1
source '${adapter}'
LOCAL_WA_ADAPTER_ROOT=/tmp/untrusted-source
LOCAL_WA_ADAPTER_ENV_FILE=/etc/skincos/crm-whatsapp.env
LOCAL_WA_ADAPTER_PORT=24024
LOCAL_WA_ADAPTER_RUNTIME_HOME=/etc
LOCAL_WA_ADAPTER_SOURCE_HOME=/etc/skincos-adapter
LOCAL_WA_ADAPTER_RUN_AS_USER=admin
LOCAL_WA_ADAPTER_RUNTIME_ID=crm-local--atendimento--gestor
LOCAL_WA_ADAPTER_ROLE_POLICY_FILE=/tmp/untrusted-source/crm/console/modules/localRolePolicy.json
LOCAL_WA_ADAPTER_EMAIL=gestor.atendimento@local.test
LOCAL_WA_ADAPTER_ROLE=GESTOR
crm_local_wa_validate_privileged_inputs
`], { encoding: 'utf8' });

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /caminhos.*absolutos|fonte.*autorizada/i);
});

function spawnBash(scriptPath, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath], { encoding: 'utf8', env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test('PostgreSQL runtime identity is deterministic and distinct by CRM_RUNTIME_ID', () => {
  const adapter = whatsappAdapterPath.replaceAll('\\', '/');
  const result = spawnSync('bash', ['-lc', `
set -euo pipefail
CRM_LOCAL_WA_LIBRARY_ONLY=1 source '${adapter}'
first="$(crm_local_wa_runtime_database_name crm-local--atendimento--gestor)"
repeat="$(crm_local_wa_runtime_database_name crm-local--atendimento--gestor)"
second="$(crm_local_wa_runtime_database_name crm-local--atendimento--consultor)"
printf '%s\\n%s\\n%s\\n' "$first" "$repeat" "$second"
`], { encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const [first, repeat, second] = result.stdout.trim().split('\n');
  assert.match(first, /^skincos_crm_local_[a-f0-9]{20}$/);
  assert.equal(repeat, first);
  assert.notEqual(second, first);
});

test('PostgreSQL runtime database creation is serialized and atomically reused', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-local-postgres-isolation-'));
  const fakeBin = path.join(fixtureRoot, 'bin');
  const fakeDatabaseState = path.join(fixtureRoot, 'databases');
  const runtimeHome = path.join(fixtureRoot, 'runtime');
  const harnessPath = path.join(fixtureRoot, 'prepare.sh');
  const createdbLog = path.join(fixtureRoot, 'createdb.log');
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await mkdir(fakeBin, { recursive: true });
  await mkdir(fakeDatabaseState, { recursive: true });
  await mkdir(runtimeHome, { recursive: true });

  const fakePsql = `#!/usr/bin/env bash
set -euo pipefail
database_url=""
command_text=""
runtime_id=""
file_input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dbname) shift; database_url="$1" ;;
    --dbname=*) database_url="\${1#--dbname=}" ;;
    --command) shift; command_text="$1" ;;
    --command=*) command_text="\${1#--command=}" ;;
    --set) shift; [[ "$1" == runtime_id=* ]] && runtime_id="\${1#runtime_id=}" ;;
    --set=runtime_id=*) runtime_id="\${1#--set=runtime_id=}" ;;
    --file) shift; file_input="$1" ;;
  esac
  shift || true
done
database_name="$(printf '%s' "$database_url" | sed -E 's#^postgresql://[^@/]*@?/([^?]+).*$#\\1#')"
if [[ "$command_text" == *"select 1 from pg_database"* ]]; then
  requested="$(printf '%s' "$command_text" | sed -E "s/.*datname = '([^']+)'.*/\\1/")"
  [[ -d "$FAKE_DB_STATE/$requested" ]] && printf '1\\n'
elif [[ "$command_text" == *"current_database()"* ]]; then
  printf '%s|off\\n' "$database_name"
elif [[ "$command_text" == *"select runtime_id from public.skincos_crm_local_runtime"* ]]; then
  [[ -f "$FAKE_DB_STATE/$database_name/runtime-id" ]] && cat "$FAKE_DB_STATE/$database_name/runtime-id"
elif [[ "$command_text" == alter\\ database*rename\\ to* ]]; then
  source_name="$(printf '%s' "$command_text" | awk '{print $3}')"
  target_name="$(printf '%s' "$command_text" | awk '{print $6}')"
  [[ ! -e "$FAKE_DB_STATE/$target_name" ]]
  mv "$FAKE_DB_STATE/$source_name" "$FAKE_DB_STATE/$target_name"
elif [[ "$file_input" == "-" ]]; then
  cat >/dev/null
  printf '%s\\n' "$runtime_id" > "$FAKE_DB_STATE/$database_name/runtime-id"
else
  cat > "$FAKE_DB_STATE/$database_name/dump.sql"
fi
`;
  const fakeCreatedb = `#!/usr/bin/env bash
set -euo pipefail
database_name="\${!#}"
mkdir "$FAKE_DB_STATE/$database_name"
printf '%s\\n' "$database_name" >> "$FAKE_CREATEDB_LOG"
sleep 0.2
`;
  const fakeDropdb = `#!/usr/bin/env bash
set -euo pipefail
database_name="\${!#}"
rm -rf "$FAKE_DB_STATE/$database_name"
`;
  const fakePgDump = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' 'fixture dump'
`;

  for (const [name, content] of [
    ['psql', fakePsql],
    ['createdb', fakeCreatedb],
    ['dropdb', fakeDropdb],
    ['pg_dump', fakePgDump],
  ]) {
    const target = path.join(fakeBin, name);
    await writeFile(target, content);
    await chmod(target, 0o755);
  }

  const adapter = whatsappAdapterPath.replaceAll('\\', '/');
  await writeFile(harnessPath, `#!/usr/bin/env bash
set -euo pipefail
export CRM_LOCAL_WA_LIBRARY_ONLY=1
export CRM_LOCAL_WA_PSQL_BIN="$FAKE_BIN/psql"
export CRM_LOCAL_WA_CREATEDB_BIN="$FAKE_BIN/createdb"
export CRM_LOCAL_WA_DROPDB_BIN="$FAKE_BIN/dropdb"
export CRM_LOCAL_WA_PG_DUMP_BIN="$FAKE_BIN/pg_dump"
source '${adapter}'
crm_local_wa_run_as() {
  shift
  "$@"
}
RUNTIME_HOME="$FAKE_RUNTIME_HOME"
RUN_AS_USER=admin
database_name="$(crm_local_wa_runtime_database_name "$TEST_RUNTIME_ID")"
crm_local_wa_prepare_runtime_database "$database_name" "$TEST_RUNTIME_ID"
`);
  await chmod(harnessPath, 0o755);

  const runtimeId = 'crm-local--atendimento--gestor';
  const testEnv = {
    ...process.env,
    FAKE_BIN: fakeBin,
    FAKE_DB_STATE: fakeDatabaseState,
    FAKE_CREATEDB_LOG: createdbLog,
    FAKE_RUNTIME_HOME: runtimeHome,
    TEST_RUNTIME_ID: runtimeId,
  };
  const [first, second] = await Promise.all([
    spawnBash(harnessPath, testEnv),
    spawnBash(harnessPath, testEnv),
  ]);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);

  const databaseNameResult = spawnSync('bash', ['-lc', `
CRM_LOCAL_WA_LIBRARY_ONLY=1 source '${adapter}'
crm_local_wa_runtime_database_name '${runtimeId}'
`], { encoding: 'utf8' });
  assert.equal(databaseNameResult.status, 0, databaseNameResult.stderr);
  const databaseName = databaseNameResult.stdout.trim();
  assert.equal(
    (await readFile(createdbLog, 'utf8')).trim().split('\n').length,
    1,
    'the shared runtime lock must publish the database only once',
  );
  assert.equal(
    await readFile(path.join(fakeDatabaseState, databaseName, 'runtime-id'), 'utf8'),
    `${runtimeId}\n`,
  );
  assert.equal(
    (await readFile(path.join(fakeDatabaseState, databaseName, 'dump.sql'), 'utf8')).trim(),
    'fixture dump',
  );
  const entries = await readFile(createdbLog, 'utf8');
  assert.doesNotMatch(entries, /_tmp_.*\n.*_tmp_/);
});

function toWindowsPath(sourcePath) {
  if (process.platform === 'win32') {
    return sourcePath;
  }
  const result = spawnSync('wslpath', ['-w', sourcePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('browser launcher accepts only loopback URLs and profiles inside the private runtime', () => {
  const scriptPath = toWindowsPath(browserLauncherPath);
  const validProfile =
    'C:\\CodexRuntime\\operator\\admin\\skincos\\runtime\\crm-local\\instances\\test\\browser-profile';
  const validResult = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Url',
      'http://127.0.0.1:8791/?module=atendimento',
      '-ProfilePath',
      validProfile,
      '-DryRun',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(validResult.status, 0, `${validResult.stdout}\n${validResult.stderr}`);
  assert.match(validResult.stdout, /msedge\.exe|chrome\.exe/i);

  const remoteResult = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Url',
      'https://crm.skincos.com.br/',
      '-ProfilePath',
      validProfile,
      '-DryRun',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(remoteResult.status, 0);
  assert.match(remoteResult.stderr, /host loopback/);

  const outsideProfileResult = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Url',
      'http://localhost:8791/',
      '-ProfilePath',
      'C:\\Temp\\crm-browser-profile',
      '-DryRun',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(outsideProfileResult.status, 0);
  assert.match(outsideProfileResult.stderr, /runtime privado/);
});
