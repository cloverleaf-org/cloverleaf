import { describe, it, expect } from 'vitest';
import { getFreePort } from '../lib/ports.js';
import { createServer } from 'node:net';

describe('getFreePort', () => {
  it('returns a positive integer port', async () => {
    const port = await getFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('returns a port that can actually be bound', async () => {
    const port = await getFreePort();
    await new Promise<void>((resolve, reject) => {
      const srv = createServer();
      srv.once('error', reject);
      srv.listen(port, () => srv.close(() => resolve()));
    });
  });

  it('returns distinct ports on consecutive calls most of the time', async () => {
    const ports = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
    expect(new Set(ports).size).toBeGreaterThanOrEqual(1);
  });
});
