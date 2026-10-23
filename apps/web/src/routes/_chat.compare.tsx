import { createFileRoute } from "@tanstack/react-router";

import { FanoutComparePage } from "../components/compare/FanoutComparePage";
import type { CompareSearch } from "../components/compare/fanoutCompare.logic";

export const Route = createFileRoute("/_chat/compare")({
  validateSearch: (raw: Record<string, unknown>): CompareSearch =>
    typeof raw.threads === "string" && raw.threads ? { threads: raw.threads.slice(0, 2000) } : {},
  component: FanoutComparePage,
});
