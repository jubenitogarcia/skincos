import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
const devPagesPath = path.join(repositoryRoot, 'crm', 'console', 'scripts', 'dev_pages.sh');
const browserLauncherPath = path.join(repositoryRoot, 'scripts', 'open-crm-local-browser.ps1');
const whatsappAdapterPath = path.join(repositoryRoot, 'scripts', 'run-local-whatsapp-orchestrator.sh');

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

  assert.match(devPages, /--strictPort/);
  assert.match(whatsappAdapter, /export HARMONIA_WORKER_ENABLED=false/);
  assert.match(whatsappAdapter, /sha256sum .*package-lock\.json/);
  assert.match(whatsappAdapter, /package_lock_hash.*recorded_package_lock_hash/);
  assert.match(whatsappAdapter, /package_lock_state_tmp=.*\$\$/);
  assert.match(whatsappAdapter, /mv -f "\$package_lock_state_tmp" "\$package_lock_state"/);
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
