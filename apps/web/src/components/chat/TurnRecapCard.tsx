import type { OrchestrationV2TurnRecap } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export function TurnRecapCard(props: {
  readonly recap: OrchestrationV2TurnRecap;
  readonly onReply: (text: string) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const reply = async (text: string) => {
    setSending(true);
    try {
      await props.onReply(text);
    } catch (error) {
      setSending(false);
      toastManager.add({
        type: "error",
        title: "Could not send the reply",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <div className="chat-content-lane px-1 pb-3">
      <section
        aria-label="Turn recap"
        className="rounded-xl border border-border bg-card px-3.5 py-3 text-card-foreground text-sm shadow-xs/5"
      >
        <p className="text-pretty leading-relaxed">{props.recap.summary}</p>
        {props.recap.question === undefined ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-border border-t pt-3">
            <p className="min-w-0 flex-1 font-medium">{props.recap.question}</p>
            <div className="flex shrink-0 gap-1.5">
              {props.recap.replies.map((text, index) => (
                <Button
                  key={text}
                  size="compact"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={sending}
                  onClick={() => void reply(text)}
                >
                  {text}
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
