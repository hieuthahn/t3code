import { createContext, useContext } from "react";

export const SplitPaneFocusContext = createContext(true);

/** Whether this pane takes window shortcuts; true outside split view. */
export const useSplitPaneFocused = () => useContext(SplitPaneFocusContext);
