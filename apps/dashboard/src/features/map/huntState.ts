import {
  type Mission,
  type Truck,
  isWorthTaking,
  missionIsOpen,
  useMissions,
  useStations,
  useTrucks,
  withRouteLeg,
} from './hunt';

export interface HuntData {
  /** Trucks worth a march, every server's, with a leg wherever the route gives one. */
  worth: Truck[];
  /** Plunder missions still open on this server. */
  open: Mission[];
  loading: boolean;
  trucksLoaded: boolean;
  missionsLoaded: boolean;
  errors: string[];
}

/** The two queries behind the trucks and plunder layers, reduced to what is
 * worth a march right now. The rules live in hunt.ts; this only runs them on
 * what was fetched. */
export function useHuntData(serverId: number): HuntData {
  const trucks = useTrucks();
  const stations = useStations();
  const missions = useMissions(serverId);
  const now = new Date();
  const known = stations.data ?? new Map();
  return {
    worth: (trucks.data ?? [])
      .map((truck) => withRouteLeg(truck, known))
      .filter((truck) => isWorthTaking(truck, now)),
    open: (missions.data ?? []).filter((mission) => missionIsOpen(mission, now)),
    loading: trucks.isPending || missions.isPending,
    trucksLoaded: trucks.data !== undefined,
    missionsLoaded: missions.data !== undefined,
    errors: [
      trucks.error ? `Could not load trucks: ${(trucks.error as Error).message}` : null,
      missions.error ? `Could not load missions: ${(missions.error as Error).message}` : null,
    ].filter((message): message is string => message !== null),
  };
}
