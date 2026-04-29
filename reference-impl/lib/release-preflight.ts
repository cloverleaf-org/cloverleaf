import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type CheckLevel = 'blocking' | 'warning';
export type CheckStatus = 'pass' | 'fail';

export interface PreflightCheck {
  id: string;
  level: CheckLevel;
  status: CheckStatus;
  message: string;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  version: string;
  tag: string;
  notes: string;
}

function shell(cmd: string, cwd: string): { out: string; ok: boolean } {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { out: out.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const msg = (e.stderr ?? e.stdout ?? e.message ?? String(err)).trim();
    return { out: msg, ok: false };
  }
}

/**
 * Run all pre-flight checks for a release from the given repo root.
 * Never throws — all errors are captured into per-check `message` fields.
 */
export function runPreflightChecks(repoRoot: string): PreflightResult {
  const checks: PreflightCheck[] = [];

  // Helper to add a check result
  function addCheck(
    id: string,
    level: CheckLevel,
    pass: boolean,
    failMsg: string,
    passMsg = 'ok',
  ): void {
    checks.push({ id, level, status: pass ? 'pass' : 'fail', message: pass ? passMsg : failMsg });
  }

  // ── Blocking checks ────────────────────────────────────────────────────────

  // 1. on-main: current branch must be main
  const branch = shell('git rev-parse --abbrev-ref HEAD', repoRoot);
  const isOnMain = branch.ok && branch.out === 'main';
  addCheck('on-main', 'blocking', isOnMain, `not on main (current: ${branch.out})`);

  // 2. clean-tree: no uncommitted changes
  const status = shell('git status --porcelain', repoRoot);
  const isClean = status.ok && status.out === '';
  addCheck('clean-tree', 'blocking', isClean, `working tree is dirty: ${status.out || status.out}`);

  // 3. in-sync-with-origin: no commits behind origin/main
  // Fetch quietly first so we can compare
  shell('git fetch origin main --quiet', repoRoot);
  const behind = shell('git rev-list --count HEAD..origin/main', repoRoot);
  const isSynced = behind.ok && behind.out === '0';
  addCheck(
    'in-sync-with-origin',
    'blocking',
    isSynced,
    behind.ok ? `${behind.out} commit(s) behind origin/main` : `could not check sync: ${behind.out}`,
  );

  // 4. valid-version: reference-impl/package.json has a valid semver
  let version = '';
  try {
    const pkgPath = join(repoRoot, 'reference-impl', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    version = pkg.version ?? '';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    addCheck('valid-version', 'blocking', false, `could not read package.json: ${msg}`);
    version = '';
  }
  if (version !== '') {
    const semverRe = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
    const isValidSemver = semverRe.test(version);
    addCheck('valid-version', 'blocking', isValidSemver, `invalid semver: '${version}'`, `${version}`);
  }

  // 5. changelog-section: CHANGELOG.md has a section for this version
  const tag = version ? `reference-impl-v${version}` : 'reference-impl-v<unknown>';
  let changelogPass = false;
  let changelogMsg = 'no version resolved';
  if (version) {
    try {
      const changelogPath = join(repoRoot, 'reference-impl', 'CHANGELOG.md');
      const changelog = readFileSync(changelogPath, 'utf-8');
      // Look for a heading like "## 0.6.5" or "## [0.6.5]"
      const pattern = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}`, 'm');
      changelogPass = pattern.test(changelog);
      changelogMsg = changelogPass
        ? `section for ${version} found`
        : `no ## ${version} section found in CHANGELOG.md`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      changelogMsg = `could not read CHANGELOG.md: ${msg}`;
    }
  }
  addCheck('changelog-section', 'blocking', changelogPass, changelogMsg, changelogMsg);

  // 6. tag-absent: the release tag must not already exist
  let tagAbsent = false;
  let tagMsg = 'no version resolved';
  if (version) {
    const localTag = shell(`git tag -l "${tag}"`, repoRoot);
    const remoteTag = shell(`git ls-remote --tags origin "${tag}"`, repoRoot);
    const existsLocally = localTag.ok && localTag.out !== '';
    const existsRemotely = remoteTag.ok && remoteTag.out !== '';
    tagAbsent = !existsLocally && !existsRemotely;
    if (existsLocally && existsRemotely) {
      tagMsg = `tag ${tag} already exists locally and on origin`;
    } else if (existsLocally) {
      tagMsg = `tag ${tag} already exists locally`;
    } else if (existsRemotely) {
      tagMsg = `tag ${tag} already exists on origin`;
    } else {
      tagMsg = `tag ${tag} is absent (ok)`;
    }
  }
  addCheck('tag-absent', 'blocking', tagAbsent, tagMsg, tagMsg);

  // ── Warning checks ─────────────────────────────────────────────────────────

  // 7. npm-authenticated: `npm whoami` must exit 0
  const npmAuth = shell('npm whoami', repoRoot);
  addCheck(
    'npm-authenticated',
    'warning',
    npmAuth.ok,
    `npm not authenticated: ${npmAuth.out}`,
    `logged in as ${npmAuth.out}`,
  );

  // 8. gh-authenticated: `gh auth status` must exit 0
  const ghAuth = shell('gh auth status', repoRoot);
  addCheck(
    'gh-authenticated',
    'warning',
    ghAuth.ok,
    `gh not authenticated: ${ghAuth.out}`,
    'gh CLI authenticated',
  );

  // Derive release notes from CHANGELOG section
  let notes = '';
  if (version) {
    try {
      const changelogPath = join(repoRoot, 'reference-impl', 'CHANGELOG.md');
      const changelog = readFileSync(changelogPath, 'utf-8');
      const versionRegex = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}`, 'm');
      const sections = changelog.split(/\n(?=## )/);
      const match = sections.find((s) => versionRegex.test(s));
      notes = match ? match.replace(/^[^\n]*\n/, '').trim() : '';
    } catch {
      notes = '';
    }
  }

  return { checks, version, tag, notes };
}
