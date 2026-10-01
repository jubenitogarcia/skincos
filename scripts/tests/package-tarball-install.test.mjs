import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageDirectories = [
  'packages/skincos-contracts',
  'packages/skincos-edge-adapters',
  'packages/skincos-delivery-contract',
];

function run(command, arguments_, { cwd }) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${arguments_.join(' ')} exited with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function packageManifest(packageDirectory) {
  return JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
}

function declaredEntrypoints(manifest) {
  assert.ok(manifest.exports && typeof manifest.exports === 'object', `${manifest.name} must declare exports`);
  const entrypoints = Object.entries(manifest.exports);
  assert.ok(entrypoints.length > 0, `${manifest.name} must declare at least one export`);

  return entrypoints.map(([entrypoint, target]) => {
    assert.ok(entrypoint === '.' || entrypoint.startsWith('./'), `${manifest.name} has an invalid export key: ${entrypoint}`);
    assert.equal(typeof target, 'string', `${manifest.name} export ${entrypoint} must resolve to one file`);
    assert.ok(target.startsWith('./'), `${manifest.name} export ${entrypoint} must stay inside the package`);
    return { entrypoint, packedPath: target.slice(2) };
  });
}

function writeConsumerProof(consumerDirectory) {
  const source = `
import assert from 'node:assert/strict';

const [packageName, encodedEntrypoints] = process.argv.slice(2);
const entrypoints = JSON.parse(encodedEntrypoints);

for (const entrypoint of entrypoints) {
  const specifier = entrypoint === '.'
    ? packageName
    : \`${'${packageName}'}/${'${entrypoint.slice(2)}'}\`;
  const namespace = entrypoint === './package.json'
    ? await import(specifier, { with: { type: 'json' } })
    : await import(specifier);

  if (entrypoint === './package.json') {
    assert.equal(namespace.default.name, packageName, \`${'${specifier}'} must resolve to its installed manifest\`);
  } else {
    assert.ok(Object.keys(namespace).length > 0, \`${'${specifier}'} must expose a public API\`);
  }
}
`;
  fs.writeFileSync(path.join(consumerDirectory, 'verify-imports.mjs'), source);
}

function verifyPackagedEntrypoints(packageDirectory) {
  const manifest = packageManifest(packageDirectory);
  const entrypoints = declaredEntrypoints(manifest);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-package-proof-'));

  try {
    const packDirectory = path.join(temporaryRoot, 'pack');
    const consumerDirectory = path.join(temporaryRoot, 'consumer');
    const cacheDirectory = path.join(temporaryRoot, 'empty-npm-cache');
    fs.mkdirSync(packDirectory);
    fs.mkdirSync(consumerDirectory);
    fs.mkdirSync(cacheDirectory);

    const packed = JSON.parse(run(npmCommand, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      packDirectory,
    ], { cwd: packageDirectory }));
    assert.equal(packed.length, 1, `${manifest.name} must pack exactly one tarball`);
    assert.equal(packed[0].name, manifest.name, 'packed name must match package metadata');
    assert.equal(packed[0].version, manifest.version, 'packed version must match package metadata');

    const packedFiles = new Set((packed[0].files || []).map((file) => file.path));
    for (const { entrypoint, packedPath } of entrypoints) {
      assert.ok(packedFiles.has(packedPath), `${manifest.name} tarball omits ${entrypoint}`);
    }

    const tarball = path.join(packDirectory, packed[0].filename);
    assert.ok(fs.existsSync(tarball), `${manifest.name} tarball was not written to the temporary pack directory`);

    fs.writeFileSync(path.join(consumerDirectory, 'package.json'), JSON.stringify({
      name: 'skincos-package-tarball-proof',
      private: true,
      version: '0.0.0',
      type: 'module',
    }, null, 2));
    writeConsumerProof(consumerDirectory);

    run(npmCommand, [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      '--cache',
      cacheDirectory,
      tarball,
    ], { cwd: consumerDirectory });

    const installedPackage = path.join(consumerDirectory, 'node_modules', ...manifest.name.split('/'));
    assert.ok(fs.existsSync(installedPackage), `${manifest.name} must install from its tarball`);
    run(process.execPath, [
      path.join(consumerDirectory, 'verify-imports.mjs'),
      manifest.name,
      JSON.stringify(entrypoints.map(({ entrypoint }) => entrypoint)),
    ], { cwd: consumerDirectory });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

for (const relativePackageDirectory of packageDirectories) {
  test(`${relativePackageDirectory} packs, installs offline, and resolves every public export`, () => {
    verifyPackagedEntrypoints(path.join(root, relativePackageDirectory));
  });
}
