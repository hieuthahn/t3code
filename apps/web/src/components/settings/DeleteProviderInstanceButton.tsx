import type { ProviderInstanceConfig, ProviderInstanceId } from "@t3tools/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

/** List the folders an instance signs in from; deleting the instance leaves them on disk. */
export function instanceSignInFolders(instance: ProviderInstanceConfig): ReadonlyArray<string> {
  const config =
    typeof instance.config === "object" && instance.config !== null
      ? (instance.config as Record<string, unknown>)
      : {};
  return ["shadowHomePath", "homePath"].flatMap((key) => {
    const value = config[key];
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
}

export function DeleteProviderInstanceButton(props: {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly disabled: boolean;
  readonly onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const folders = instanceSignInFolders(props.instance);
  const name = props.instance.displayName?.trim() || props.instanceId;
  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-destructive"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        aria-label={`Delete instance ${props.instanceId}`}
      >
        <Trash2Icon />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {folders.length > 0
                ? `T3 Code stops using this account. Its sign-in stays on disk in ${folders.join(" and ")}${props.instance.driver === "claudeAgent" ? " and in the macOS Keychain" : ""}. Move the folder to the Trash yourself if you no longer need it.`
                : "T3 Code stops using this account. Its threads and history stay."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                props.onDelete();
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
