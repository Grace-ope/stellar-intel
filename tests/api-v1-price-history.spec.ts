import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryQuotes = vi.fn();
const getAnchorById = vi.fn();

vi.mock('@/lib/sep38/quote-store', () => ({ queryQuotes }));
vi.mock('@/lib/stellar/anchors', () => ({ getAnchorById }));

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

import { GET, downsamplePoints } from '@/app/api/v1/anchors/[id]/price-history/route';

function req(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-request-id': 'test-req-1' },
  });
}

describe('downsamplePoints', () => {
  it('keeps all points when under the cap', () => {
    expect(downsamplePoints([1, 2, 3], 500)).toEqual([1, 2, 3]);
  });

  it('keeps first and last when over the cap', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsamplePoints(pts, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe('GET /api/v1/anchors/[id]/price-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAnchorById.mockReturnValue({
      id: 'cowrie',
      corridors: ['usdc-ngn', 'usdc-kes'],
    });
    queryQuotes.mockResolvedValue([
      {
        observedAt: '2026-01-01T00:00:00.000Z',
        price: '1500',
        totalPrice: '1500',
        source: 'sep38',
      },
      {
        observedAt: '2026-01-02T00:00:00.000Z',
        price: '1510',
        totalPrice: '1510',
        source: 'sep38',
      },
    ]);
  });

  it('returns points for a known anchor', async () => {
    const res = await GET(req('/api/v1/anchors/cowrie/price-history?days=7') as never, {
      params: Promise.resolve({ id: 'cowrie' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchorId).toBe('cowrie');
    expect(body.corridor).toBe('usdc-ngn');
    expect(body.points.length).toBe(2);
  });

  it('rejects a corridor the anchor does not serve with 400', async () => {
    const res = await GET(req('/api/v1/anchors/cowrie/price-history?corridor=usdc-xxx') as never, {
      params: Promise.resolve({ id: 'cowrie' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown anchor', async () => {
    getAnchorById.mockImplementation(() => {
      throw new Error('not found');
    });
    const res = await GET(req('/api/v1/anchors/nope/price-history') as never, {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 503 when store is unavailable', async () => {
    queryQuotes.mockRejectedValue(new Error('db down'));
    const res = await GET(req('/api/v1/anchors/cowrie/price-history') as never, {
      params: Promise.resolve({ id: 'cowrie' }),
    });
    expect(res.status).toBe(503);
  });

  it('downsamples to at most 500 points', async () => {
    queryQuotes.mockResolvedValue(
      Array.from({ length: 800 }, (_, i) => ({
        observedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
        price: String(1000 + i),
        totalPrice: String(1000 + i),
        source: 'sep38',
      }))
    );
    const res = await GET(req('/api/v1/anchors/cowrie/price-history') as never, {
      params: Promise.resolve({ id: 'cowrie' }),
    });
    const body = await res.json();
    expect(body.points[0]!.observedAt).toBe(many[0]!.observedAt);
expect(body.points[body.points.length - 1]!.observedAt).toBe(
  many[many.length - 1]!.observedAt
);
  });
});
