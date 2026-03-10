module.exports = async function detectPrFileChanges({ github, context, core, options = {} }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const prNumber = Number(options.prNumber || 0);
  const outputName = String(options.outputName || 'changed');
  const prefixes = Array.isArray(options.prefixes) ? options.prefixes.map(String) : [];
  const exact = new Set(Array.isArray(options.exact) ? options.exact.map(String) : []);

  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    core.warning(`Invalid PR number for change detection: ${options.prNumber}`);
    core.setOutput(outputName, 'false');
    return;
  }

  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const changedFiles = files.map((f) => String(f.filename || ''));
  const matched = changedFiles.some((name) => {
    if (exact.has(name)) return true;
    return prefixes.some((prefix) => name.startsWith(prefix));
  });

  core.info(`PR #${prNumber} changed files=${changedFiles.length}, ${outputName}=${matched}`);
  core.setOutput(outputName, matched ? 'true' : 'false');
};
