/** Name the trigger for several models by count, so Effort and Access keep their labels. */
export function multipleModelsTriggerLabel(labels: ReadonlyArray<string>): string {
  if (labels.length === 0) return "Choose models";
  if (labels.length === 1) return labels[0]!;
  return `${labels.length} models`;
}
