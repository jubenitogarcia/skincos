module.exports = async function resolveAfterAutomergePr({ github, context, core, options = {} }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const baseRef = String(options.baseRef || 'main');
  const headPrefix = String(options.headPrefix || 'codex/');
  const requiredAuthor = String(options.requiredAuthor || '').trim();

  const prNumber = (() => {
    const fromEvent = context.payload?.pull_request?.number;
    if (fromEvent) return Number(fromEvent);
    const fromInput = context.payload?.inputs?.pr_number;
    const parsed = Number(String(fromInput || '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  })();

  if (!prNumber) {
    core.warning('Invalid or missing pr_number input.');
    core.setOutput('eligible', 'false');
    core.setOutput('reason', 'missing_pr_number');
    return;
  }

  const { data: pr } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const sameRepo = pr.head?.repo?.full_name === `${owner}/${repo}`;
  const validHeadPrefix = String(pr.head?.ref || '').startsWith(headPrefix);
  const authorOk = !requiredAuthor || pr.user?.login === requiredAuthor;

  const eligible =
    pr.merged === true &&
    pr.base?.ref === baseRef &&
    sameRepo &&
    validHeadPrefix &&
    authorOk;

  core.info(
    `PR #${prNumber} merged=${pr.merged} base=${pr.base?.ref} head=${pr.head?.ref} sameRepo=${sameRepo} author=${pr.user?.login} eligible=${eligible}`,
  );

  core.setOutput('pr_number', String(prNumber));
  core.setOutput('merge_commit_sha', pr.merge_commit_sha || '');
  core.setOutput('eligible', eligible ? 'true' : 'false');

  if (!eligible) {
    const reasonParts = [];
    if (!pr.merged) reasonParts.push('not_merged');
    if (pr.base?.ref !== baseRef) reasonParts.push(`base_not_${baseRef}`);
    if (!sameRepo) reasonParts.push('fork_or_external_repo');
    if (!validHeadPrefix) reasonParts.push(`head_not_${headPrefix}`);
    if (!authorOk) reasonParts.push('author_not_allowed');
    core.setOutput('reason', reasonParts.join('|') || 'unknown');
  }
};
