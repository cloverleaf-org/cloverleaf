import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { compareVisual } from '../lib/visual-diff.js';

function makePng(width: number, height: number, fill: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i]     = fill[0];
    png.data[i + 1] = fill[1];
    png.data[i + 2] = fill[2];
    png.data[i + 3] = fill[3];
  }
  return PNG.sync.write(png);
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'clv-visual-diff-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('compareVisual', () => {
  it('reports status "new-baseline" when baseline is missing, and writes the candidate as baseline', () => {
    const baselinePath = join(workDir, 'baseline.png');
    const candidateBuf = makePng(20, 20, [255, 0, 0, 255]);
    const result = compareVisual({
      baselinePath,
      candidateBuf,
      diffPath: join(workDir, 'diff.png'),
      candidateOutPath: join(workDir, 'candidate.png'),
      threshold: 0.1,
      maxDiffRatio: 0.01,
    });
    expect(result.status).toBe('new-baseline');
    expect(existsSync(baselinePath)).toBe(true);
    expect(existsSync(join(workDir, 'diff.png'))).toBe(false);
  });

  it('reports status "match" when candidate equals baseline within threshold', () => {
    const baselineBuf = makePng(10, 10, [0, 128, 0, 255]);
    const baselinePath = join(workDir, 'baseline.png');
    writeFileSync(baselinePath, baselineBuf);
    const result = compareVisual({
      baselinePath,
      candidateBuf: baselineBuf,
      diffPath: join(workDir, 'diff.png'),
      candidateOutPath: join(workDir, 'candidate.png'),
      threshold: 0.1,
      maxDiffRatio: 0.01,
    });
    expect(result.status).toBe('match');
    expect(result.diffPixels).toBe(0);
    expect(existsSync(join(workDir, 'diff.png'))).toBe(false);
  });

  it('reports status "diff" when pixel ratio exceeds maxDiffRatio; writes candidate + diff', () => {
    const baselineBuf = makePng(10, 10, [0, 0, 0, 255]);
    const candidateBuf = makePng(10, 10, [255, 255, 255, 255]);
    const baselinePath = join(workDir, 'baseline.png');
    writeFileSync(baselinePath, baselineBuf);
    const result = compareVisual({
      baselinePath,
      candidateBuf,
      diffPath: join(workDir, 'diff.png'),
      candidateOutPath: join(workDir, 'candidate.png'),
      threshold: 0.1,
      maxDiffRatio: 0.01,
    });
    expect(result.status).toBe('diff');
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffRatio).toBeGreaterThan(0.01);
    expect(existsSync(join(workDir, 'diff.png'))).toBe(true);
    expect(existsSync(join(workDir, 'candidate.png'))).toBe(true);
  });

  it('reports status "dimension-mismatch" when baseline has different size; regenerates baseline', () => {
    const baselineBuf = makePng(10, 10, [0, 0, 0, 255]);
    const candidateBuf = makePng(20, 20, [255, 255, 255, 255]);
    const baselinePath = join(workDir, 'baseline.png');
    writeFileSync(baselinePath, baselineBuf);
    const result = compareVisual({
      baselinePath,
      candidateBuf,
      diffPath: join(workDir, 'diff.png'),
      candidateOutPath: join(workDir, 'candidate.png'),
      threshold: 0.1,
      maxDiffRatio: 0.01,
    });
    expect(result.status).toBe('dimension-mismatch');
    const rewritten = PNG.sync.read(readFileSync(baselinePath));
    expect(rewritten.width).toBe(20);
    expect(rewritten.height).toBe(20);
  });

  it('always overwrites baseline with candidate on match/diff runs', () => {
    const baselineBuf = makePng(10, 10, [0, 0, 0, 255]);
    const candidateBuf = makePng(10, 10, [0, 0, 0, 255]);
    const baselinePath = join(workDir, 'baseline.png');
    writeFileSync(baselinePath, baselineBuf);
    compareVisual({
      baselinePath,
      candidateBuf,
      diffPath: join(workDir, 'diff.png'),
      candidateOutPath: join(workDir, 'candidate.png'),
      threshold: 0.1,
      maxDiffRatio: 0.01,
    });
    expect(existsSync(baselinePath)).toBe(true);
  });
});
