// Per-server kill feed relays: CRUD and fire-and-forget forwarding.
import { eq } from 'drizzle-orm';
import type { Env } from './env';
import { newId } from './http';
import { serverFeedRelays, type ServerFeedRelayRow } from './db/schema';

export interface RelayView {
	id: string;
	label: string;
	url: string;
	enabled: boolean;
	createdAt: string;
}

function shape(r: ServerFeedRelayRow): RelayView {
	return {
		id: r.id,
		label: r.label,
		url: r.url,
		enabled: r.enabled,
		createdAt: r.createdAt.toISOString()
	};
}

export async function listRelays(env: Env, serverId: string): Promise<RelayView[]> {
	const rows = await env.db
		.select()
		.from(serverFeedRelays)
		.where(eq(serverFeedRelays.serverId, serverId))
		.orderBy(serverFeedRelays.createdAt);
	return rows.map(shape);
}

export async function createRelay(
	env: Env,
	serverId: string,
	label: string,
	url: string
): Promise<RelayView> {
	const id = newId();
	const [row] = await env.db
		.insert(serverFeedRelays)
		.values({ id, serverId, label, url, enabled: true })
		.returning();
	return shape(row);
}

export async function updateRelay(
	env: Env,
	serverId: string,
	id: string,
	updates: { label?: string; url?: string; enabled?: boolean }
): Promise<RelayView> {
	const [row] = await env.db
		.update(serverFeedRelays)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(serverFeedRelays.id, id))
		.returning();
	if (!row) throw new Error('Relay not found');
	return shape(row);
}

export async function deleteRelay(env: Env, serverId: string, id: string): Promise<void> {
	await env.db
		.delete(serverFeedRelays)
		.where(eq(serverFeedRelays.id, id));
}

/** Fire-and-forget POST to every enabled relay of this server. */
export async function forwardToRelays(
	env: Env,
	serverId: string,
	body: unknown
): Promise<void> {
	const relays = await env.db
		.select({ url: serverFeedRelays.url })
		.from(serverFeedRelays)
		.where(eq(serverFeedRelays.serverId, serverId))
		.limit(50);
	if (!relays.length) return;
	const text = JSON.stringify(body);
	await Promise.all(
		relays.map(async ({ url }) => {
			try {
				await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: text
				});
			} catch (e) {
				console.error(`[warcon] relay to ${url} failed`, e);
			}
		})
	);
}
