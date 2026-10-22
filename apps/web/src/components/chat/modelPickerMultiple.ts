/** Name the trigger for several models by count, so Effort and Access keep their labels. */
export function multipleModelsTriggerLabel(labels: ReadonlyArray<string>): string {
  if (labels.length === 0) return "Choose models";
  if (labels.length === 1) return labels[0]!;
  return `${labels.length} models`;
}

/** Decide whether a model row click adds to the selection, and whether it turns the mode on. */
export function modelRowClickIntent(input: {
  readonly shiftKey: boolean;
  readonly multiSelectMode: boolean;
  readonly canToggle: boolean;
}): { readonly additive: boolean; readonly entersMode: boolean } {
  const additive = input.canToggle && (input.shiftKey || input.multiSelectMode);
  return { additive, entersMode: additive && !input.multiSelectMode };
}
