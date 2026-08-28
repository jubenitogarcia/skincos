import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_DEFAULT_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function required(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

/**
 * Cross-repository promotion is permitted only from the source repository's
 * protected default branch. Callers may attest a commit and tree, but they may
 * not select a feature branch as the promotion authority.
 */
export function assertCanonicalPromotionSourceRef({ sourceRef, defaultBranch, branchProtected }) {
  const normalizedRef = required(sourceRef, 'source_ref');
  const normalizedDefaultBranch = required(defaultBranch, 'producer default branch');
  if (!SAFE_DEFAULT_BRANCH.test(normalizedDefaultBranch)) {
    throw new Error('producer default branch has an unsupported name');
  }
  const canonicalRef = `refs/heads/${normalizedDefaultBranch}`;
  if (normalizedRef !== canonicalRef) {
    throw new Error(`cross-repository source_ref must equal the producer protected default branch ${canonicalRef}`);
  }
  if (branchProtected !== true) {
    throw new Error(`producer default branch ${normalizedDefaultBranch} is not protected`);
  }
  return Object.freeze({ sourceRef: normalizedRef, defaultBranch: normalizedDefaultBranch, canonicalRef });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceRef, defaultBranch, protectedValue] = process.argv.slice(2);
  assertCanonicalPromotionSourceRef({
    sourceRef,
    defaultBranch,
    branchProtected: protectedValue === 'true',
  });
  process.stdout.write(`Canonical protected promotion source: ${sourceRef}\n`);
}
