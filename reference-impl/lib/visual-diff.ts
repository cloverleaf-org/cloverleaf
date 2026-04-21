import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export type VisualDiffStatus = 'new-baseline' | 'match' | 'diff' | 'dimension-mismatch';

export interface VisualDiffResult {
  status: VisualDiffStatus;
  diffPixels: number;
  diffRatio: number;
  width: number;
  height: number;
}

export interface CompareVisualArgs {
  baselinePath: string;
  candidateBuf: Buffer;
  diffPath: string;
  candidateOutPath: string;
  threshold: number;
  maxDiffRatio: number;
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function writeBaseline(baselinePath: string, buf: Buffer): void {
  ensureDir(baselinePath);
  writeFileSync(baselinePath, buf);
}

export function compareVisual(args: CompareVisualArgs): VisualDiffResult {
  const candidatePng = PNG.sync.read(args.candidateBuf);

  if (!existsSync(args.baselinePath)) {
    writeBaseline(args.baselinePath, args.candidateBuf);
    return {
      status: 'new-baseline',
      diffPixels: 0,
      diffRatio: 0,
      width: candidatePng.width,
      height: candidatePng.height,
    };
  }

  const baselineBuf = readFileSync(args.baselinePath);
  const baselinePng = PNG.sync.read(baselineBuf);

  if (baselinePng.width !== candidatePng.width || baselinePng.height !== candidatePng.height) {
    writeBaseline(args.baselinePath, args.candidateBuf);
    return {
      status: 'dimension-mismatch',
      diffPixels: 0,
      diffRatio: 0,
      width: candidatePng.width,
      height: candidatePng.height,
    };
  }

  const diffPng = new PNG({ width: candidatePng.width, height: candidatePng.height });
  const diffPixels = pixelmatch(
    baselinePng.data,
    candidatePng.data,
    diffPng.data,
    candidatePng.width,
    candidatePng.height,
    { threshold: args.threshold },
  );
  const totalPixels = candidatePng.width * candidatePng.height;
  const diffRatio = diffPixels / totalPixels;

  if (diffRatio > args.maxDiffRatio) {
    ensureDir(args.diffPath);
    writeFileSync(args.diffPath, PNG.sync.write(diffPng));
    ensureDir(args.candidateOutPath);
    writeFileSync(args.candidateOutPath, args.candidateBuf);
    writeBaseline(args.baselinePath, args.candidateBuf);
    return {
      status: 'diff',
      diffPixels,
      diffRatio,
      width: candidatePng.width,
      height: candidatePng.height,
    };
  }

  writeBaseline(args.baselinePath, args.candidateBuf);
  return {
    status: 'match',
    diffPixels,
    diffRatio,
    width: candidatePng.width,
    height: candidatePng.height,
  };
}
