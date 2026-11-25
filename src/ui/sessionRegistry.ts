export interface MountedSession {
  id: string;
  isExisting: boolean;
}

export function mountedSessions(
  prev: MountedSession[],
  active: MountedSession,
  running: Record<string, boolean>
): MountedSession[] {
  const kept = prev.filter((session) => session.id !== active.id && running[session.id]);
  // A new entry for a mounted session remounts it, and the unmount stops its running turn.
  const mounted = prev.find((session) => session.id === active.id);

  return [...kept, mounted ?? active];
}

export function backgroundRunning(
  sessions: MountedSession[],
  activeId: string,
  running: Record<string, boolean>
): string[] {
  return sessions
    .filter((session) => session.id !== activeId && running[session.id])
    .map((session) => session.id);
}
