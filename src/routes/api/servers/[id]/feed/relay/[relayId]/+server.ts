// Update or delete one kill feed relay. Org owners only.
import { getEnv } from '$lib/server/env';
import { apiJson, param, route } from '$lib/server/http';
import { requireServerManager } from '$lib/server/access';
import { updateRelay, deleteRelay } from '$lib/server/feed-relay';

export const PATCH = route(async (event) => {
	const env = getEnv();
	const { server } = await requireServerManager(env, event.locals, param(event, 'id'));
	const relayId = param(event, 'relayId');
	const body = (await event.request.json()) as { label?: unknown; url?: unknown; token?: unknown; enabled?: unknown };
	const updates: { label?: string; url?: string; token?: string; enabled?: boolean } = {};
	if (typeof body.label === 'string') updates.label = body.label;
	if (typeof body.url === 'string') {
		if (!URL.canParse(body.url)) return apiJson({ ok: false, error: 'Invalid URL.' }, 400);
		try {
			const u = new URL(body.url);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') {
				return apiJson({ ok: false, error: 'URL must use http or https.' }, 400);
			}
		} catch {
			return apiJson({ ok: false, error: 'Invalid URL.' }, 400);
		}
		updates.url = body.url;
	}
	if (typeof body.token === 'string') updates.token = body.token;
	if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
	const relay = await updateRelay(env, server.id, relayId, updates);
	return apiJson({ ok: true, relay });
});

export const DELETE = route(async (event) => {
	const env = getEnv();
	const { server } = await requireServerManager(env, event.locals, param(event, 'id'));
	const relayId = param(event, 'relayId');
	await deleteRelay(env, server.id, relayId);
	return apiJson({ ok: true });
});
