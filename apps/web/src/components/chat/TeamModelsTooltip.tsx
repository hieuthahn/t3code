import type { ProviderInstanceId, TeamMember, TeamSetup } from "@t3tools/contracts";

import { getTriggerDisplayModelName, type ModelEsque } from "./providerIconUtils";

/** The team's seats for the model picker's tooltip: the architect, then each numbered worker. */
export function TeamModelsTooltip(props: {
  readonly team: TeamSetup;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
}) {
  const nameOf = (member: TeamMember) => {
    const option = props.modelOptionsByInstance
      .get(member.instanceId)
      ?.find((candidate) => candidate.slug === member.model);
    return option === undefined ? member.model : getTriggerDisplayModelName(option);
  };
  const seats = [
    { role: "Architect", member: props.team.architect },
    ...props.team.workers.map((member, index) => ({ role: `Worker ${index + 1}`, member })),
  ];
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {seats.map((seat) => (
        <li key={seat.role}>
          {seat.role} · {nameOf(seat.member)}
        </li>
      ))}
    </ul>
  );
}
