import { getEnv } from '$lib/server/env';

export interface TrackedServer {
	id: string;
	name: string;
	map: string;
	lighting: string;
	players: number;
	maxPlayers: number;
	joinUrl: string;
}

const ENDPOINT = 'https://wardogserverlist.com/api/server';

const TRACKED = [
	{ id: 'skarvox',   key: '7eef0d25-b12e-4761-8753-2c937a9150ca', name: 'Skarvox' },
	{ id: 'panzerknacker', key: '97afa058-b86e-47c5-bc49-9ad25505fc2a', name: 'Panzerknacker :Tank:' },
	{ id: 'cgt-1',     key: '7c2a5ea6-c0bd-490f-a600-7231bf224c33', name: 'CGT #1' },
	{ id: 'cgt-2',     key: '04f021da-d0dc-43f2-8132-a847a303b587', name: 'CGT #2' },
	{ id: 'cgt-3',     key: '8accb852-ca4e-4543-b28e-47ba0e882968', name: 'CGT #3' },
];

/** Fetch status of tracked external servers from wardogserverlist.com. */
export async function fetchTrackedServers(): Promise<TrackedServer[]> {
	const apiKey = getEnv().WARDOG_API_KEY || '';
	const results = await Promise.all(
		TRACKED.map(async (s) => {
			try {
				const res = await fetch(`${ENDPOINT}?key=id%7C${encodeURIComponent(s.key)}`, {
					headers: {
						Accept: 'application/json',
						...(apiKey ? { 'X-API-Key': apiKey } : {}),
					},
					cf: { cacheEverything: false } as any,
				});
				if (!res.ok) {
					return { ...s, map: '', lighting: 'DayClear', players: 0, maxPlayers: 0, joinUrl: '' };
				}
				const payload = (await res.json()) as {
					server?: {
						name?: string;
						world?: string;
						sky?: string;
						players?: number;
						maxPlayers?: number;
					};
				};
				const sv = payload.server ?? {};
				return {
					id: s.id,
					name: sv.name ?? s.name,
					map: sv.world ?? '',
					lighting: sv.sky ?? 'DayClear',
					players: sv.players ?? 0,
					maxPlayers: sv.maxPlayers ?? 0,
					joinUrl: `https://wardogjoinlist.com/join?key=id%7C${encodeURIComponent(s.key)}`,
				};
			} catch {
				return { ...s, map: '', lighting: 'DayClear', players: 0, maxPlayers: 0, joinUrl: '' };
			}
		})
	);
	return results;
}
