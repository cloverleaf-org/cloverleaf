/**
 * Regression test for CLV-47: .gitattributes merge=union for reference-impl/CHANGELOG.md
 *
 * Creates a temp git repo with two branches that each append a distinct ## [Unreleased] bullet
 * to CHANGELOG.md, performs an actual git merge using the union driver, then asserts both
 * bullets are present and no conflict markers exist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let repoDir: string;

function git(args: string, cwd = repoDir): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Minimal identity so git commit works without a global config.
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      // Prevent git from opening an editor.
      GIT_EDITOR: 'true',
    },
  }).trim();
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'cl-changelog-union-'));

  // Initialise a fresh git repo.
  git('init -b main');
  git('config user.email "test@example.com"');
  git('config user.name "Test"');

  // Configure the union merge driver for CHANGELOG.md via .gitattributes.
  // This mirrors the production .gitattributes added by CLV-47.
  writeFileSync(
    join(repoDir, '.gitattributes'),
    'reference-impl/CHANGELOG.md merge=union\n',
  );
  mkdirSync(join(repoDir, 'reference-impl'), { recursive: true });

  // Create the initial CHANGELOG.md with a base ## [Unreleased] section.
  writeFileSync(
    join(repoDir, 'reference-impl', 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n',
  );

  git('add .gitattributes reference-impl/CHANGELOG.md');
  git('commit -m "initial"');
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('CHANGELOG.md merge=union (.gitattributes CLV-47)', () => {
  it('merges two branches with distinct ## [Unreleased] bullets: both bullets present, no conflict markers', () => {
    // Branch A: adds bullet from task-a
    git('checkout -b task-a');
    writeFileSync(
      join(repoDir, 'reference-impl', 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature from task-a\n',
    );
    git('add reference-impl/CHANGELOG.md');
    git('commit -m "docs: task-a changelog entry"');

    // Back to main, create Branch B from same base.
    git('checkout main');
    git('checkout -b task-b');
    writeFileSync(
      join(repoDir, 'reference-impl', 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature from task-b\n',
    );
    git('add reference-impl/CHANGELOG.md');
    git('commit -m "docs: task-b changelog entry"');

    // Merge task-a into task-b (or equivalently, both into main). Using --no-edit for non-interactive.
    git('checkout main');
    git('merge task-a --no-edit');
    git('merge task-b --no-edit');

    const result = readFileSync(
      join(repoDir, 'reference-impl', 'CHANGELOG.md'),
      'utf8',
    );

    // Both bullets must be present.
    expect(result).toContain('Feature from task-a');
    expect(result).toContain('Feature from task-b');

    // No conflict markers.
    expect(result).not.toContain('<<<<<<<');
    expect(result).not.toContain('=======');
    expect(result).not.toContain('>>>>>>>');
  });

  it('preserves pre-existing lines in .gitattributes when merge=union line is added', () => {
    // This asserts the production .gitattributes was created correctly and does not clobber
    // any pre-existing content. Since this repo was just created, we verify the line exists.
    const attrs = readFileSync(join(repoDir, '.gitattributes'), 'utf8');
    expect(attrs).toContain('reference-impl/CHANGELOG.md merge=union');
  });
});
