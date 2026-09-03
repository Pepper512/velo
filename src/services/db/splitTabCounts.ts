/**
 * SPEC-SIT REQ-2.4, 3.1 — per-tab counts for the split inbox: how many
 * threads a tab would list (what "empty" means) and how many of them are
 * unread (the pill). Three grouped queries at most, however many tabs.
 */
import { getDb } from "./connection";

export interface SplitTabCount {
  total: number;
  unread: number;
}

export interface SplitTabCountRequest {
  /** Category names to count; `Primary` includes uncategorised threads. */
  categories: string[];
  /** Label ids to count (INBOX ∩ label). */
  labelIds: string[];
  /** Whether the Reminders tab is configured. */
  reminders: boolean;
}

/** Keyed by tab id: the category name, `label:<labelId>`, or `reminders`. */
export async function getSplitTabCounts(
  accountId: string,
  request: SplitTabCountRequest,
): Promise<Map<string, SplitTabCount>> {
  const db = await getDb();
  const out = new Map<string, SplitTabCount>();

  if (request.categories.length > 0) {
    const rows = await db.select<{ category: string | null; total: number; unread: number }[]>(
      `SELECT tc.category, COUNT(*) as total,
              SUM(CASE WHEN t.is_read = 0 THEN 1 ELSE 0 END) as unread
       FROM threads t
       INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
       LEFT JOIN thread_categories tc ON tc.account_id = t.account_id AND tc.thread_id = t.id
       WHERE t.account_id = $1 AND tl.label_id = 'INBOX'
       GROUP BY tc.category`,
      [accountId],
    );
    for (const name of request.categories) out.set(name, { total: 0, unread: 0 });
    for (const row of rows) {
      const name = row.category ?? "Primary";
      const current = out.get(name);
      if (!current) continue; // a category that is not a tab
      current.total += Number(row.total);
      current.unread += Number(row.unread);
    }
  }

  if (request.labelIds.length > 0) {
    const placeholders = request.labelIds.map((_, i) => `$${i + 2}`).join(",");
    const rows = await db.select<{ label_id: string; total: number; unread: number }[]>(
      `SELECT tl2.label_id, COUNT(*) as total,
              SUM(CASE WHEN t.is_read = 0 THEN 1 ELSE 0 END) as unread
       FROM threads t
       INNER JOIN thread_labels inbox ON inbox.account_id = t.account_id AND inbox.thread_id = t.id AND inbox.label_id = 'INBOX'
       INNER JOIN thread_labels tl2 ON tl2.account_id = t.account_id AND tl2.thread_id = t.id
       WHERE t.account_id = $1 AND tl2.label_id IN (${placeholders})
       GROUP BY tl2.label_id`,
      [accountId, ...request.labelIds],
    );
    for (const labelId of request.labelIds) out.set(`label:${labelId}`, { total: 0, unread: 0 });
    for (const row of rows) {
      out.set(`label:${row.label_id}`, { total: Number(row.total), unread: Number(row.unread) });
    }
  }

  if (request.reminders) {
    const rows = await db.select<{ total: number; unread: number | null }[]>(
      `SELECT COUNT(DISTINCT t.id) as total,
              COUNT(DISTINCT CASE WHEN t.is_read = 0 THEN t.id END) as unread
       FROM threads t
       INNER JOIN follow_up_reminders f ON f.account_id = t.account_id AND f.thread_id = t.id AND f.status = 'pending'
       WHERE t.account_id = $1`,
      [accountId],
    );
    const row = rows[0];
    out.set("reminders", { total: Number(row?.total ?? 0), unread: Number(row?.unread ?? 0) });
  }

  return out;
}
