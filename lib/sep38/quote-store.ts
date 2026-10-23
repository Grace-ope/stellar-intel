/**
 * SEP-38 quote history store used by GET /api/v1/anchors/[id]/price-history (#1510).
 */

export interface QuoteHistoryRow {
  anchorId: string;
  corridor: string;
  observedAt: string;
  price: string;
  totalPrice: string;
  source: string;
}

export interface QueryQuotesFilter {
  anchorId?: string;
  corridor?: string;
  since?: string;
}

const rows: QuoteHistoryRow[] = [];

export function __resetQuoteStoreForTests(): void {
  rows.length = 0;
}

export function recordQuote(row: QuoteHistoryRow): void {
  if (!row.anchorId?.trim() || !row.corridor?.trim() || !row.observedAt) {
    throw new Error('recordQuote: anchorId, corridor, and observedAt are required');
  }
  rows.push({ ...row });
}

/** Oldest first. Throws when the store is marked unavailable (maps to 503). */
export async function queryQuotes(
  filter: QueryQuotesFilter = {}
): Promise<QuoteHistoryRow[]> {
  if ((globalThis as { __QUOTE_STORE_DOWN?: boolean }).__QUOTE_STORE_DOWN) {
    throw new Error('quote store unavailable');
  }

  const sinceMs = filter.since ? Date.parse(filter.since) : NaN;

  const matched = rows.filter((r) => {
    if (filter.anchorId && r.anchorId !== filter.anchorId) return false;
    if (filter.corridor && r.corridor !== filter.corridor) return false;
    if (Number.isFinite(sinceMs)) {
      const t = Date.parse(r.observedAt);
      if (!Number.isFinite(t) || t < sinceMs) return false;
    }
    return true;
  });

  return matched.sort((a, b) =>
    a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0
  );
}
