import type { ProviderDriverKind, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { pickRepresentativeAccount } from "@t3tools/shared/usageLimitSwitchCandidates";

interface GroupableEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationGroupKey?: string | undefined;
  readonly displayName: string;
}

interface GroupableModel {
  readonly slug: string;
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationGroupKey?: string | undefined;
}

export type MergedModel<T> = T & {
  readonly memberInstanceIds: ReadonlyArray<ProviderInstanceId>;
};

const accountGroupId = (entry: {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationGroupKey?: string | undefined;
}): string =>
  entry.continuationGroupKey === undefined
    ? `instance:${entry.instanceId}`
    : `group:${entry.driverKind}:${entry.continuationGroupKey}`;

/**
 * Fold the accounts that share a history into one sidebar tab, kept on the active account's
 * entry when it is in the group, and map every account to the tab that stands for it.
 */
export function mergeModelPickerAccountTabs<T extends GroupableEntry>(input: {
  readonly entries: ReadonlyArray<T>;
  readonly activeInstanceId: ProviderInstanceId;
}): {
  readonly entries: ReadonlyArray<T>;
  readonly tabByInstanceId: ReadonlyMap<ProviderInstanceId, ProviderInstanceId>;
} {
  const members = new Map<string, T[]>();
  for (const entry of input.entries) {
    const id = accountGroupId(entry);
    members.set(id, [...(members.get(id) ?? []), entry]);
  }
  const tabByInstanceId = new Map<ProviderInstanceId, ProviderInstanceId>();
  const entries: T[] = [];
  for (const group of members.values()) {
    const tab = group.find((entry) => entry.instanceId === input.activeInstanceId) ?? group[0]!;
    for (const entry of group) tabByInstanceId.set(entry.instanceId, tab.instanceId);
    const groupName = accountGroupName(group.map((entry) => entry.displayName));
    entries.push(
      group.length > 1
        ? { ...tab, displayName: `${groupName ?? tab.displayName} · ${group.length} accounts` }
        : tab,
    );
  }
  const order = new Map(input.entries.map((entry, index) => [entry.instanceId, index]));
  entries.sort((left, right) => order.get(left.instanceId)! - order.get(right.instanceId)!);
  return { entries, tabByInstanceId };
}

/**
 * Collapse a model offered by several accounts of one group into a single row whose account
 * is the thread's own when it offers the model, else the roomiest ready one.
 */
export function mergeModelPickerAccountModels<T extends GroupableModel>(input: {
  readonly models: ReadonlyArray<T>;
  readonly providersByInstanceId: ReadonlyMap<ProviderInstanceId, ServerProvider>;
  readonly activeInstanceId: ProviderInstanceId;
  readonly nowMs: number;
}): ReadonlyArray<MergedModel<T>> {
  const groups = new Map<string, T[]>();
  for (const model of input.models) {
    const key = `${accountGroupId(model)}\0${model.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), model]);
  }
  const merged: Array<MergedModel<T>> = [];
  for (const group of groups.values()) {
    const memberInstanceIds = group.map((model) => model.instanceId);
    const providers = memberInstanceIds.flatMap((instanceId) => {
      const provider = input.providersByInstanceId.get(instanceId);
      return provider === undefined ? [] : [provider];
    });
    const chosen =
      pickRepresentativeAccount({
        members: providers,
        preferredInstanceId: input.activeInstanceId,
        model: group[0]!.slug,
        nowMs: input.nowMs,
      }) ?? group[0]!.instanceId;
    const representative = group.find((model) => model.instanceId === chosen) ?? group[0]!;
    merged.push({ ...representative, memberInstanceIds });
  }
  return merged;
}

/** Tell whether an account belongs to the group a merged tab stands for. */
export function sameAccountGroup(
  left: Pick<GroupableEntry, "instanceId" | "driverKind" | "continuationGroupKey">,
  right: Pick<GroupableEntry, "instanceId" | "driverKind" | "continuationGroupKey">,
): boolean {
  return accountGroupId(left) === accountGroupId(right);
}

export type ModelPickerAccountAction =
  | { readonly kind: "toggle"; readonly instanceId: ProviderInstanceId }
  | {
      readonly kind: "select";
      readonly instanceId: ProviderInstanceId;
      readonly accountChoice: "pinned" | "auto";
    };

/** Decide which account a model row click lands on, honouring the account picked in the footer. */
export function resolveModelPickerAccountAction(input: {
  readonly instanceId: ProviderInstanceId;
  readonly memberInstanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly accountPick: ProviderInstanceId | "auto";
  readonly additive: boolean;
  readonly canToggle: boolean;
}): ModelPickerAccountAction {
  const picked = input.accountPick === "auto" ? undefined : input.accountPick;
  const pinnedId =
    picked !== undefined && input.memberInstanceIds.includes(picked) ? picked : undefined;
  const instanceId = pinnedId ?? input.instanceId;
  if (input.additive && input.canToggle) return { kind: "toggle", instanceId };
  return { kind: "select", instanceId, accountChoice: pinnedId ? "pinned" : "auto" };
}

/** Name a group of accounts by the first word every name shares, such as the driver's name. */
export function accountGroupName(displayNames: ReadonlyArray<string>): string | undefined {
  const words = displayNames.map((name) => name.trim().split(/\s+/));
  const first = words[0]?.[0];
  return first !== undefined &&
    words.length > 1 &&
    words.every((parts) => parts.length > 1 && parts[0] === first)
    ? first
    : undefined;
}

/**
 * Shorten account names for the footer toggle to the shortest form that still tells them apart:
 * an email's first name, then its local part, then the whole address.
 */
export function shortAccountLabels(displayNames: ReadonlyArray<string>): ReadonlyArray<string> {
  const sharedFirstWord = accountGroupName(displayNames) !== undefined;
  const forms = displayNames.map((name) => {
    const parts = name.trim().split(/\s+/);
    const lastWord = parts.at(-1) ?? "";
    const at = lastWord.indexOf("@");
    if (at > 0) {
      const localPart = lastWord.slice(0, at);
      return [localPart.split(".")[0]!, localPart, lastWord, name];
    }
    return sharedFirstWord ? [parts.slice(1).join(" "), name] : [name];
  });
  const depth = Math.max(...forms.map((form) => form.length));
  for (let level = 0; level < depth; level += 1) {
    const labels = forms.map((form) => form[Math.min(level, form.length - 1)]!);
    if (new Set(labels).size === labels.length) return labels;
  }
  return displayNames;
}

/** Name an account by its signed-in email, else the email in its name, else the name itself. */
export function accountEmailLabel(input: {
  readonly displayName: string;
  readonly authEmail?: string | undefined;
}): string {
  const email = input.authEmail?.trim();
  if (email) return email;
  return (
    input.displayName
      .trim()
      .split(/\s+/)
      .find((word) => word.includes("@")) ?? input.displayName
  );
}

/** Tell whether the footer's account bar offers this account's sign-in, so no separate notice is due. */
export function accountBarOffersSignIn(input: {
  readonly instanceId: ProviderInstanceId;
  readonly signedOut: boolean;
  readonly barInstanceIds: ReadonlyArray<ProviderInstanceId>;
}): boolean {
  return (
    input.signedOut &&
    input.barInstanceIds.length > 1 &&
    input.barInstanceIds.includes(input.instanceId)
  );
}
