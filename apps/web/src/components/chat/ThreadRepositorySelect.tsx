import { FolderGit2Icon } from "lucide-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import type { RepositoryOption } from "./repositorySelection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

const OUTER_VALUE = "";

function BranchHint(props: { readonly branch: string | null }) {
  return props.branch === null ? null : (
    <span className="ms-auto min-w-0 max-w-1/2 truncate text-xs text-muted-foreground">
      {props.branch}
    </span>
  );
}

/** Pick which repository the git section below targets. */
export function ThreadRepositorySelect(props: {
  readonly options: readonly RepositoryOption[];
  readonly selected: RepositoryOption | null;
  readonly onSelect: (path: string | null) => void;
  /** Locks the choice while a git action runs so it cannot retarget mid-flight. */
  readonly disabled?: boolean;
}) {
  const selected = props.selected ?? props.options[0];
  if (props.options.length < 2 || selected === undefined) return null;
  return (
    <Select
      value={selected.path ?? OUTER_VALUE}
      disabled={props.disabled === true}
      onValueChange={(value) => props.onSelect(value === OUTER_VALUE ? null : value)}
    >
      <SelectTrigger
        size="sm"
        variant="ghost"
        aria-label="Repository"
        data-testid="thread-repository-select"
        render={<ThreadDetailsControl />}
      >
        <FolderGit2Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <SelectValue>{selected.label}</SelectValue>
        <BranchHint branch={selected.branch} />
      </SelectTrigger>
      <SelectPopup>
        {props.options.map((option) => (
          <SelectItem key={option.path ?? OUTER_VALUE} value={option.path ?? OUTER_VALUE}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="truncate">{option.label}</span>
              <BranchHint branch={option.branch} />
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
