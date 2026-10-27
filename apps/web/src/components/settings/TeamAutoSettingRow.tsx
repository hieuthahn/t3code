import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";
import { ScopedSwitch } from "./ScopedSwitch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Whether new threads start on Team Auto, where the effort judge picks a team or a single agent. */
export function TeamAutoSettingRow() {
  const { team } = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const hasDefaultTeam = team.defaultSetup !== null;
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("team-auto-new-threads")}
      description={
        hasDefaultTeam
          ? "New threads start on Auto. The effort judge reads each message, starts the default team when a large job arrives, and keeps small requests to one agent. Pick Team on or off in the composer to decide yourself."
          : "Start a team once from the composer's Team control to give Auto a default team."
      }
      settingKeys={["team"]}
      control={
        <ScopedSwitch
          settingKeys={["team"]}
          checked={team.autoNewThreads}
          disabled={!hasDefaultTeam}
          onCheckedChange={(checked) =>
            updateSettings({ team: { autoNewThreads: Boolean(checked) } })
          }
          aria-label="Team Auto for new threads"
        />
      }
    />
  );
}
