import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  TeamMember,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { TraitsPicker } from "./TraitsPicker";

/** One team seat: a model on one provider account, with its effort and other options. */
export function TeamMemberPicker(props: {
  readonly label: string;
  readonly environmentId: EnvironmentId;
  readonly member: TeamMember;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly disabled: boolean;
  readonly onChange: (member: TeamMember) => void;
  readonly onRemove?: () => void;
}) {
  const entry = props.instanceEntries.find(
    (candidate) => candidate.instanceId === props.member.instanceId,
  );
  return (
    <div className="flex min-w-0 items-center gap-1" role="group" aria-label={props.label}>
      <ProviderModelPicker
        environmentId={props.environmentId}
        activeInstanceId={props.member.instanceId}
        model={props.member.model}
        lockedProvider={props.lockedProvider}
        instanceEntries={props.instanceEntries}
        modelOptionsByInstance={props.modelOptionsByInstance}
        size="sm"
        disabled={props.disabled}
        triggerAriaLabel={`${props.label} model`}
        onInstanceModelChange={(instanceId, model) => props.onChange({ instanceId, model })}
      />
      {entry === undefined ? null : (
        <TraitsPicker
          provider={entry.driverKind}
          instanceId={props.member.instanceId}
          models={entry.models}
          model={props.member.model}
          modelOptions={props.member.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={false}
          size="sm"
          disabled={props.disabled}
          onModelOptionsChange={(options) =>
            props.onChange({
              instanceId: props.member.instanceId,
              model: props.member.model,
              ...(options === undefined || options.length === 0 ? {} : { options: [...options] }),
            })
          }
        />
      )}
      {props.onRemove === undefined ? null : (
        <Button
          size="icon-xs"
          variant="ghost"
          className="ms-auto"
          aria-label={`Remove ${props.label}`}
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
