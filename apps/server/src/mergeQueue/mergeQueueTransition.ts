import type { MergeQueueItemId, MergeQueueItemStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

/** Update an item only while it still has one of `from`, so a racing writer cannot be overwritten. */
export const makeItemTransition =
  (sql: SqlClient.SqlClient) =>
  (
    itemId: MergeQueueItemId,
    from: ReadonlyArray<MergeQueueItemStatus>,
    fields: Record<string, string | null>,
    at: string,
  ) =>
    sql<{ readonly item_id: string }>`
      UPDATE merge_queue_items SET ${sql.update({ ...fields, updated_at: at })}
      WHERE item_id = ${itemId} AND status IN ${sql.in(from)}
      RETURNING item_id
    `.pipe(Effect.map((rows) => rows.length > 0));
