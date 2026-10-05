// Per-server kill feed relays: CRUD and fire-and-forget forwarding.
import { eq, and } from 'drizzle-orm';
import type { Env } from './env';
import { newId } from './http';
import { decryptSecret, encryptSecret } from './crypto';
import { serverFeedRelays, type ServerFeedRelayRow } from './db/schema';

export interface RelayView {
	id: string;
	label: string;
	url: string;
	token: string;
	enabled: boolean;
	createdAt: string;
}

function shape(env: Env, r: ServerFeedRelayRow): RelayView {
	return {
		id: r.id,
		label: r.label,
		url: r.url,
		token: r.tokenEnc ? decryptSecret(env, r.tokenEnc) : '',
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
	return rows.map((r) => shape(env, r));
}

export async function createRelay(
	env: Env,
	serverId: string,
	label: string,
	url: string,
	token: string
): Promise<RelayView> {
	const id = newId();
	const [row] = await env.db
		.insert(serverFeedRelays)
		.values({
			id,
			serverId,
			label,
			url,
			tokenEnc: token ? encryptSecret(env, token) : '',
			enabled: true
		})
		.returning();
	return shape(env, row);
}

export async function updateRelay(
	env: Env,
	serverId: string,
	id: string,
	updates: { label?: string; url?: string; token?: string; enabled?: boolean }
): Promise<RelayView> {
	const set: Record<string, unknown> = { updatedAt: new Date() };
	if (updates.label !== undefined) set.label = updates.label;
	if (updates.url !== undefined) set.url = updates.url;
	if (updates.token !== undefined) set.tokenEnc = updates.token ? encryptSecret(env, updates.token) : '';
	if (updates.enabled !== undefined) set.enabled = updates.enabled;

	const [row] = await env.db
		.update(serverFeedRelays)
		.set(set)
		.where(and(eq(serverFeedRelays.id, id), eq(serverFeedRelays.serverId, serverId)))
		.returning();
	if (!row) throw new Error('Relay not found');
	return shape(env, row);
}

export async function deleteRelay(env: Env, serverId: string, id: string): Promise<void> {
	await env.db
		.delete(serverFeedRelays)
		.where(and(eq(serverFeedRelays.id, id), eq(serverFeedRelays.serverId, serverId)));
}

/** Fire-and-forget POST to every enabled relay of this server. */
export async function forwardToRelays(
	env: Env,
	serverId: string,
	body: unknown
): Promise<void> {
	const relays = await env.db
		.select({ url: serverFeedRelays.url, tokenEnc: serverFeedRelays.tokenEnc })
		.from(serverFeedRelays)
		.where(and(eq(serverFeedRelays.serverId, serverId), eq(serverFeedRelays.enabled, true)))
		.limit(50);
	if (!relays.length) return;
	const text = JSON.stringify(body);
	await Promise.all(
		relays.map(async ({ url, tokenEnc }) => {
			try {
				const headers: Record<string, string> = { 'Content-Type': 'application/json' };
				if (tokenEnc) {
					const token = decryptSecret(env, tokenEnc);
					if (token) headers['Authorization'] = `Bearer ${token}`;
				}
				await fetch(url, {
					method: 'POST',
					headers,
					body: text
				});
			} catch (e) {
				console.error(`[warcon] relay to ${url} failed`, e);
			}
		})
	);
}
