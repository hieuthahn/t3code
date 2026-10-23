import { TEAM_MAX_PROFILES, type TeamProfile } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type NameEdit = { readonly kind: "save-as" } | { readonly kind: "rename"; readonly id: string };

/** Pick a saved team, or keep the current setup under a name. */
export function TeamProfileBar(props: {
  readonly profiles: ReadonlyArray<TeamProfile>;
  readonly selectedId: string | null;
  readonly canWrite: boolean;
  readonly onSelect: (profile: TeamProfile) => void;
  readonly onSaveAs: (name: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
}) {
  const [edit, setEdit] = useState<NameEdit | null>(null);
  const [name, setName] = useState("");
  const selected = props.profiles.find((profile) => profile.id === props.selectedId) ?? null;

  if (edit !== null) {
    const submit = () => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      if (edit.kind === "save-as") props.onSaveAs(trimmed);
      else props.onRename(edit.id, trimmed);
      setEdit(null);
    };
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          size="sm"
          autoFocus
          aria-label="Team profile name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button size="xs" type="submit" disabled={name.trim().length === 0}>
          Save
        </Button>
        <Button size="xs" variant="ghost" type="button" onClick={() => setEdit(null)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={props.selectedId ?? ""}
        onValueChange={(id) => {
          const profile = props.profiles.find((candidate) => candidate.id === id);
          if (profile !== undefined) props.onSelect(profile);
        }}
      >
        <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Team profile">
          <SelectValue>{selected?.name ?? "Unsaved setup"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {props.profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Team profile actions"
              disabled={!props.canWrite}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            disabled={props.profiles.length >= TEAM_MAX_PROFILES}
            onClick={() => {
              setName("");
              setEdit({ kind: "save-as" });
            }}
          >
            Save as…
          </MenuItem>
          <MenuItem
            disabled={selected === null}
            onClick={() => {
              if (selected === null) return;
              setName(selected.name);
              setEdit({ kind: "rename", id: selected.id });
            }}
          >
            Rename…
          </MenuItem>
          <MenuItem
            variant="destructive"
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) props.onDelete(selected.id);
            }}
          >
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
