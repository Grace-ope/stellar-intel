import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { getAnchorById } from '@/lib/stellar/anchors';
// Adjust this import to the module that exports queryQuotes (Q38012).
import { queryQuotes } from '@/lib/sep38/quote-store';

export const runtime = 'nodejs';

const MAX_POINTS = 500;
const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

export interface PriceHistoryPoint {
  observedAt: string;
  price: string;
  totalPrice: string;
  source: string;
}

/**
 * Keep at most `max` evenly spaced samples; always keep first and last.
 */
export function downsamplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  if (max <= 1) return points.length ? [points[points.length - 1]!] : [];
  if (max === 2) return [points[0]!, points[points.length - 1]!];

  const result: T[] = [];
  const lastIndex = points.length - 1;
  for (let i = 0; i < max; i++) {
    const idx = i === max - 1 ? lastIndex : Math.round((i * lastIndex) / (max - 1));
    const point = points[idx]!;
    if (result.length === 0 || result[result.length - 1] !== point) {
      result.push(point);
    }
  }
  // Guarantee first/last
  if (result[0] !== points[0]) result[0] = points[0]!;
  if (result[result.length - 1] !== points[lastIndex]) {
    result[result.length - 1] = points[lastIndex]!;
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.anchor.price-history', maxRequests: 60 }, async (ctx) => {
    const { id } = await params;
    if (!id?.trim()) {
      return ctx.error('VALIDATION_ERROR', 'Invalid anchor ID', 400);
    }

    let anchor;
    try {
      anchor = getAnchorById(id);
    } catch {
      return ctx.error('NOT_FOUND', `Unknown anchor: "${id}"`, 404);
    }

    const url = new URL(request.url);
    const corridorParam = url.searchParams.get('corridor') ?? undefined;
    const daysRaw = url.searchParams.get('days');
    let days = DEFAULT_DAYS;
    if (daysRaw != null && daysRaw !== '') {
      const n = Number.parseInt(daysRaw, 10);
      if (!Number.isFinite(n) || n < MIN_DAYS || n > MAX_DAYS) {
        return ctx.error(
          'VALIDATION_ERROR',
          `days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`,
          400
        );
      }
      days = n;
    }

    const corridors = anchor.corridors ?? [];
    let corridor = corridorParam;
    if (corridor != null && corridor !== '') {
      if (!corridors.includes(corridor)) {
        return ctx.error(
          'VALIDATION_ERROR',
          `Corridor "\( {corridor}" is not served by anchor " \){id}"`,
          400
        );
      }
    } else {
      corridor = corridors[0];
      if (!corridor) {
        return ctx.error('VALIDATION_ERROR', `Anchor "${id}" has no corridors`, 400);
      }
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let rows: Array<{
      observedAt: string;
      price: string;
      totalPrice: string;
      source: string;
    }>;
    try {
      // Signature may vary — map fields if your queryQuotes returns differently.
      rows = await queryQuotes({
        anchorId: id,
        corridor,
        since,
      });
    } catch {
      return ctx.error('STORE_UNAVAILABLE', 'Quote store unavailable', 503);
    }

    if (!Array.isArray(rows)) {
      return ctx.error('STORE_UNAVAILABLE', 'Quote store unavailable', 503);
    }

    const sorted = [...rows].sort((a, b) =>
      a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0
    );
    const points = downsamplePoints(sorted, MAX_POINTS);

    return {
      status: 200,
      body: {
        anchorId: id,
        corridor,
        points,
      },
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    };
  });
}
