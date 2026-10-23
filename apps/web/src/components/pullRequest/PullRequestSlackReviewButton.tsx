import * as Schema from "effect/Schema";
import { ChevronDownIcon, CopyIcon, MessageSquareShareIcon } from "lucide-react";
import { useId } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  buildSlackReviewMessage,
  DEFAULT_SLACK_REVIEW_ASSIGNEES,
  projectNameFromRepository,
  resolveStoredSlackAssignees,
} from "./slackReviewMessage";

const SLACK_REVIEW_ASSIGNEES_KEY = "t3code:pr:slack-review-assignees";

function slackReviewProjectKey(repository: string): string {
  return `t3code:pr:slack-review-project:${repository.toLowerCase()}`;
}

/** Copy a #--tasks review request for this pull request, with a preview to adjust it. */
export function PullRequestSlackReviewButton({
  repository,
  title,
  url,
}: {
  readonly repository: string;
  readonly title: string;
  readonly url: string;
}) {
  const fieldId = useId();
  const defaultProject = projectNameFromRepository(repository);
  const [project, setProject] = useLocalStorage(
    slackReviewProjectKey(repository),
    defaultProject,
    Schema.String,
  );
  const [storedAssignees, setAssignees] = useLocalStorage(
    SLACK_REVIEW_ASSIGNEES_KEY,
    DEFAULT_SLACK_REVIEW_ASSIGNEES,
    Schema.String,
  );
  const assignees = resolveStoredSlackAssignees(storedAssignees);
  const message = buildSlackReviewMessage({
    project: project.trim() === "" ? defaultProject : project,
    title,
    assignees: assignees.trim() === "" ? DEFAULT_SLACK_REVIEW_ASSIGNEES : assignees,
    url,
  });

  const copy = async () => {
    try {
      await writeTextToClipboard(message, "Slack review message");
      toastManager.add({ type: "success", title: "Slack review message copied" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy the Slack review message",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <Group>
      <Button size="xs" variant="outline" aria-label="Slack review" onClick={() => void copy()}>
        <MessageSquareShareIcon aria-hidden className="size-3.5" />
        <span className="@max-[35rem]/pr-header:hidden">Slack review</span>
      </Button>
      <GroupSeparator />
      <Popover>
        <PopoverTrigger
          render={<Button size="xs" variant="outline" aria-label="Edit Slack review message" />}
        >
          <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverPopup align="end" side="bottom" className="w-96 max-w-[calc(100vw-2rem)]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-project`}>Project</Label>
              <Input
                id={`${fieldId}-project`}
                size="sm"
                value={project}
                placeholder={defaultProject}
                onChange={(event) => setProject(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-assignees`}>Assignee</Label>
              <Input
                id={`${fieldId}-assignees`}
                size="sm"
                value={assignees}
                placeholder={DEFAULT_SLACK_REVIEW_ASSIGNEES}
                onChange={(event) => setAssignees(event.target.value)}
              />
            </div>
            <Textarea aria-label="Slack review message" readOnly rows={4} value={message} />
            <Button size="sm" className="self-end" onClick={() => void copy()}>
              <CopyIcon aria-hidden className="size-3.5" />
              Copy
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}
