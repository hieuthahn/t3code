import { TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function pinnedAccountBannerItem(input: {
  readonly id: string;
  readonly accountLabel: string;
  readonly windowLabel: string;
  readonly usedPercent: number;
  readonly thresholdPercent: number;
  readonly targetLabel: string | null;
  readonly onSwitch: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  return {
    id: input.id,
    variant: "warning",
    priority: "notice",
    icon: <TriangleAlertIcon />,
    title: "Pinned account near its limit",
    description: `${input.accountLabel} has used ${Math.round(input.usedPercent)}% of its ${input.windowLabel.toLowerCase()} limit, past the ${input.thresholdPercent}% threshold. This thread stays on it because you picked it.`,
    dismissLabel: "Keep this account",
    onDismiss: input.onDismiss,
    actions:
      input.targetLabel === null ? null : (
        <Button size="sm" variant="outline" onClick={input.onSwitch}>
          Switch to {input.targetLabel}
        </Button>
      ),
  };
}
