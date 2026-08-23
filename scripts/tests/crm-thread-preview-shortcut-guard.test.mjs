import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const launcher = read('scripts/run-shared-codex-shortcut.ps1');
const environment = read('.codex/environments/environment.toml');
const workspaceDocs = read('docs/codex-shared-workspace.md');

test('thread preview shortcuts are recognized but fail closed in the shared clone', () => {
  assert.match(launcher, /"CrmThreadPreview",/);
  assert.match(launcher, /"CrmUsersThreadPreview",/);
  assert.match(
    launcher,
    /\$SelectedAction -like 'Crm\*' -and \$SelectedAction -notin @\('CrmThreadPreview', 'CrmUsersThreadPreview'\)/,
  );
  assert.match(launcher, /"CrmUsersThreadPreview"\s*\{\s*Invoke-CrmThreadPreviewGuard/);
  assert.match(launcher, /clone compartilhado .* somente contexto/);
  assert.match(launcher, /Nenhum fallback será usado/);
});

test('Codex App points thread previews at the workspace-local launcher', () => {
  const usersAction = environment.match(
    /name = "CRM – Prévia Usuários Equipe Thread"\r?\nicon = "[^"]+"\r?\ncommand = "([^"]+)"/,
  );
  assert.ok(usersAction);
  assert.equal(
    usersAction[1],
    'powershell.exe -ExecutionPolicy Bypass -File ./scripts/run-shared-codex-shortcut.ps1 -Action CrmUsersThreadPreview',
  );
  assert.doesNotMatch(usersAction[1], /CodexShared[\\/]Worktrees/);
});

test('workspace documentation identifies the validated Users worktree and SHA', () => {
  assert.match(workspaceDocs, /users-production-flag-20260810/);
  assert.match(workspaceDocs, /ca1e1dab/);
  assert.match(workspaceDocs, /worktree/i);
});
