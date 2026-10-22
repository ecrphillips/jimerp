export interface OrderClient {
  id: string;
  account_name: string;
  programs: string[];
  production_weekdays: number[] | null;
}

export function groupOrderClients<T extends OrderClient>(clients: T[], scheduledLocationAccountIds: string[] = []) {
  const scheduledLocations = new Set(scheduledLocationAccountIds);
  const scheduled: T[] = [];
  const other: T[] = [];
  const coroastingOnly: T[] = [];
  for (const client of [...clients].sort((a, b) => a.account_name.localeCompare(b.account_name))) {
    if (client.programs.includes('COROASTING') && !client.programs.includes('MANUFACTURING')) {
      coroastingOnly.push(client);
    } else if ((client.production_weekdays?.length ?? 0) > 0 || scheduledLocations.has(client.id)) {
      scheduled.push(client);
    } else {
      other.push(client);
    }
  }
  return { scheduled, other, coroastingOnly };
}

export function defaultCommonClientIds(clients: OrderClient[]) {
  return clients.filter(client => ['Matchstick', 'Funk', 'No Smoke'].some(name =>
    client.account_name.toLowerCase().includes(name.toLowerCase()),
  )).map(client => client.id);
}