import { getDb } from "./connection";

export interface PendingOperation {
  id: string;
  account_id: string;
  operation_type: string;
  resource_id: string;
  params: string;
  status: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: number | null;
  created_at: number;
  error_message: string | null;
}

export async function enqueuePendingOperation(
  accountId: string,
  operationType: string,
  resourceId: string,
  params: Record<string, unknown>,
  maxRetries?: number,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  if (maxRetries !== undefined) {
    await db.execute(
      `INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, accountId, operationType, resourceId, JSON.stringify(params), maxRetries],
    );
    return id;
  }
  await db.execute(
    `INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, accountId, operationType, resourceId, JSON.stringify(params)],
  );
  return id;
}

export async function getPendingOperations(
  accountId?: string,
  limit = 50,
): Promise<PendingOperation[]> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  // F-4 REQ-4.5: `reconcile` ops are read-repairs and must not head-of-line
  // block user writes — within a batch, user ops come first.
  if (accountId) {
    return db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE account_id = $1 AND status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= $2)
       ORDER BY (operation_type = 'reconcile') ASC, created_at ASC LIMIT $3`,
      [accountId, now, limit],
    );
  }
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= $1)
     ORDER BY (operation_type = 'reconcile') ASC, created_at ASC LIMIT $2`,
    [now, limit],
  );
}

export async function updateOperationStatus(
  id: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_operations SET status = $1, error_message = $2 WHERE id = $3`,
    [status, errorMessage ?? null, id],
  );
}

export async function deleteOperation(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM pending_operations WHERE id = $1`, [id]);
}

const BACKOFF_SCHEDULE = [60, 300, 900, 3600];

export async function incrementRetry(id: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ retry_count: number; max_retries: number }[]>(
    `SELECT retry_count, max_retries FROM pending_operations WHERE id = $1`,
    [id],
  );
  const op = rows[0];
  if (!op) return;

  const newCount = op.retry_count + 1;
  if (newCount >= op.max_retries) {
    await db.execute(
      `UPDATE pending_operations SET status = 'failed', retry_count = $1 WHERE id = $2`,
      [newCount, id],
    );
    return;
  }

  const backoffIdx = Math.min(newCount - 1, BACKOFF_SCHEDULE.length - 1);
  const delaySec = BACKOFF_SCHEDULE[backoffIdx]!;
  const nextRetryAt = Math.floor(Date.now() / 1000) + delaySec;

  await db.execute(
    `UPDATE pending_operations SET retry_count = $1, next_retry_at = $2 WHERE id = $3`,
    [newCount, nextRetryAt, id],
  );
}

export async function getPendingOpsCount(accountId?: string): Promise<number> {
  const db = await getDb();
  if (accountId) {
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM pending_operations WHERE account_id = $1 AND status = 'pending'`,
      [accountId],
    );
    return rows[0]?.count ?? 0;
  }
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM pending_operations WHERE status = 'pending'`,
  );
  return rows[0]?.count ?? 0;
}

export async function getFailedOpsCount(accountId?: string): Promise<number> {
  const db = await getDb();
  if (accountId) {
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM pending_operations WHERE account_id = $1 AND status = 'failed'`,
      [accountId],
    );
    return rows[0]?.count ?? 0;
  }
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM pending_operations WHERE status = 'failed'`,
  );
  return rows[0]?.count ?? 0;
}

export async function getPendingOpsForResource(
  accountId: string,
  resourceId: string,
): Promise<PendingOperation[]> {
  const db = await getDb();
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE account_id = $1 AND resource_id = $2 AND status = 'pending'
     ORDER BY created_at ASC`,
    [accountId, resourceId],
  );
}

export async function compactQueue(accountId?: string): Promise<number> {
  const db = await getDb();

  // Get all pending ops grouped by resource.
  // Parameterised like its siblings above (audit P8): this was the only one of
  // 231 query calls in services/db that interpolated a value into SQL. Low
  // exploitability -- accountId is an internally generated UUID -- but it is the
  // one site a future caller could reach with something else.
  const ops = accountId
    ? await db.select<PendingOperation[]>(
        `SELECT * FROM pending_operations WHERE status = 'pending' AND account_id = $1 ORDER BY created_at ASC`,
        [accountId],
      )
    : await db.select<PendingOperation[]>(
        `SELECT * FROM pending_operations WHERE status = 'pending' ORDER BY created_at ASC`,
      );

  // Group by resource_id
  const byResource = new Map<string, PendingOperation[]>();
  for (const op of ops) {
    const key = `${op.account_id}:${op.resource_id}`;
    const list = byResource.get(key) ?? [];
    list.push(op);
    byResource.set(key, list);
  }

  const toDelete: string[] = [];

  for (const [, resourceOps] of byResource) {
    // Cancel out toggle pairs: star(true)+star(false), markRead(true)+markRead(false)
    for (const toggleType of ["star", "markRead"]) {
      const toggleOps = resourceOps.filter(
        (o) => o.operation_type === toggleType,
      );
      // If two ops with opposite values exist, remove both
      while (toggleOps.length >= 2) {
        const a = toggleOps.shift()!;
        const b = toggleOps.shift()!;
        const paramsA = JSON.parse(a.params);
        const paramsB = JSON.parse(b.params);
        if (
          (toggleType === "star" && paramsA.starred !== paramsB.starred) ||
          (toggleType === "markRead" && paramsA.read !== paramsB.read)
        ) {
          toDelete.push(a.id, b.id);
        }
      }
    }

    // Cancel addLabel+removeLabel for same label on same resource
    const addLabelOps = resourceOps.filter(
      (o) => o.operation_type === "addLabel",
    );
    const removeLabelOps = resourceOps.filter(
      (o) => o.operation_type === "removeLabel",
    );
    for (const addOp of addLabelOps) {
      const addParams = JSON.parse(addOp.params);
      const matchIdx = removeLabelOps.findIndex((r) => {
        const rParams = JSON.parse(r.params);
        return rParams.labelId === addParams.labelId;
      });
      if (matchIdx !== -1) {
        toDelete.push(addOp.id, removeLabelOps[matchIdx]!.id);
        removeLabelOps.splice(matchIdx, 1);
      }
    }

    // Collapse sequential moves: keep only the latest moveToFolder
    const moveOps = resourceOps.filter(
      (o) => o.operation_type === "moveToFolder",
    );
    if (moveOps.length > 1) {
      // Delete all but the last
      for (let i = 0; i < moveOps.length - 1; i++) {
        toDelete.push(moveOps[i]!.id);
      }
    }

    // F-4 REQ-4.2: reconcile ops for one folder collapse into the newest, with
    // the UID sets merged and the attempt count carried as the max — a
    // newest-wins-with-reset would be an infinite-retry loophole. Only pending
    // rows are read above, so an executing op is never touched.
    // A row whose params do not parse is left alone (the handler drops it);
    // a row from another UIDVALIDITY generation is left alone too (the
    // handler drops it once it sees the generation moved) — merging it would
    // carry its UIDs into a generation they never belonged to (Grok L9/H3
    // on #50).
    const reconcileOps = resourceOps
      .filter((o) => o.operation_type === "reconcile")
      .sort((a, b) => a.created_at - b.created_at);
    if (reconcileOps.length > 1) {
      const parsed = reconcileOps.map((op) => {
        try {
          const p = JSON.parse(op.params) as unknown;
          return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      });
      const newestIdx = parsed.map((p) => p !== null).lastIndexOf(true);
      if (newestIdx >= 0) {
        const newest = reconcileOps[newestIdx]!;
        const newestParams = parsed[newestIdx]!;
        const uids = new Set<number>();
        let attempts = 0;
        for (let i = 0; i < reconcileOps.length; i++) {
          const op = reconcileOps[i]!;
          const p = parsed[i];
          if (!p) continue;
          if (i !== newestIdx && p.uidvalidity !== newestParams.uidvalidity) continue;
          if (Array.isArray(p.uids)) for (const u of p.uids) if (Number.isInteger(u)) uids.add(u as number);
          attempts = Math.max(attempts, op.retry_count);
          if (op.id !== newest.id) toDelete.push(op.id);
        }
        const merged = { ...newestParams, uids: [...uids].sort((a, b) => a - b), kind: "repair" };
        await db.execute(
          "UPDATE pending_operations SET params = $1, retry_count = $2 WHERE id = $3",
          [JSON.stringify(merged), attempts, newest.id],
        );
      }
    }
  }

  // Delete compacted ops
  if (toDelete.length > 0) {
    const placeholders = toDelete.map((_, i) => `$${i + 1}`).join(",");
    await db.execute(
      `DELETE FROM pending_operations WHERE id IN (${placeholders})`,
      toDelete,
    );
  }

  return toDelete.length;
}

export async function clearFailedOperations(accountId?: string): Promise<void> {
  const db = await getDb();
  if (accountId) {
    await db.execute(
      `DELETE FROM pending_operations WHERE account_id = $1 AND status = 'failed'`,
      [accountId],
    );
  } else {
    await db.execute(`DELETE FROM pending_operations WHERE status = 'failed'`);
  }
}

export async function retryFailedOperations(accountId?: string): Promise<void> {
  const db = await getDb();
  if (accountId) {
    await db.execute(
      `UPDATE pending_operations SET status = 'pending', retry_count = 0, next_retry_at = NULL, error_message = NULL
       WHERE account_id = $1 AND status = 'failed'`,
      [accountId],
    );
  } else {
    await db.execute(
      `UPDATE pending_operations SET status = 'pending', retry_count = 0, next_retry_at = NULL, error_message = NULL
       WHERE status = 'failed'`,
    );
  }
}
