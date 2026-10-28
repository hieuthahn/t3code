import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { anyThreadRunningAtom } from "../../state/threads";

export function KeepAwakeCoordinator() {
  const enabled = useClientSettings((settings) => settings.keepAwakeWhileAgentsWork);
  const running = useAtomValue(anyThreadRunningAtom);

  // oxlint-disable-next-line t3code/react-effect-budget -- mirrors the setting and run state into the main process's power blocker
  useEffect(() => {
    void window.desktopBridge?.setKeepAwakeState?.({ enabled, running }).catch(() => undefined);
  }, [enabled, running]);

  return null;
}
