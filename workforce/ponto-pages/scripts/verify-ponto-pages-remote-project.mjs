import { readFile } from 'node:fs/promises'

function fail(code) {
  throw new Error(`PONTO_PAGES_REMOTE_${code}`)
}

export function verifyPontoPagesRemoteProject(response, expectedProject) {
  const project = response?.result
  const expectedSubdomain = `${expectedProject}.pages.dev`

  if (response?.success !== true || !project) fail('PROJECT_UNREADABLE')
  if (project.name !== expectedProject) fail('PROJECT_NAME_MISMATCH')
  if (project.production_branch !== 'main') fail('PROJECT_BRANCH_MISMATCH')
  if (project.subdomain !== expectedSubdomain) fail('PROJECT_SUBDOMAIN_MISMATCH')
  if (!Array.isArray(project.domains) || project.domains.some((domain) => domain !== expectedSubdomain)) {
    fail('CUSTOM_DOMAIN_PRESENT')
  }

  const source = project.source
  const sourceConfig = source?.config
  const directUploadOnly = source === null
  const disabledGitPublication = sourceConfig
    && sourceConfig.deployments_enabled === false
    && sourceConfig.production_deployments_enabled === false
    && sourceConfig.preview_deployment_setting === 'none'
  if (!directUploadOnly && !disabledGitPublication) fail('GIT_PUBLICATION_NOT_DISABLED')
}

async function main() {
  const [file, expectedProject] = process.argv.slice(2)
  if (!file || !expectedProject) fail('PROJECT_INPUT_MISSING')
  const response = JSON.parse(await readFile(file, 'utf8'))
  verifyPontoPagesRemoteProject(response, expectedProject)
}

if (process.argv[1] && process.argv[1].endsWith('verify-ponto-pages-remote-project.mjs')) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n')
    process.exitCode = 1
  })
}
