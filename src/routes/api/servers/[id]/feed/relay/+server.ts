// List and create per-server kill feed relays. Org owners only (same cap as feed token).
import { getEnv } from '$lib/server/env';
import { apiJson, param, route } from '$lib/server/http';
import { requireServerManager } from '$lib/server/access';
import { listRelays, createRelay } from '$lib/server/feed-relay';

export const GET = route(async (event) => {
	const env = getEnv();
	const { server } = await requireServerManager(env, event.locals, param(event, 'id'));
	const relays = await listRelays(env, server.id);
	return apiJson({ ok: true, relays });
});

export const POST = route(async (event) => {
	const env = getEnv();
	const { server } = await requireServerManager(env, event.locals, param(event, 'id'));
	const body = (await event.request.json()) as { label?: unknown; url?: unknown; token?: unknown };
	const label = typeof body.label === 'string' ? body.label : '';
	const url = typeof body.url === 'string' ? body.url : '';
	const token = typeof body.token === 'string' ? body.token : '';
	if (!url || !URL.canParse(url)) return apiJson({ ok: false, error: 'Invalid URL.' }, 400);
	// Reject non-http(s) schemes
	try {
		const u = new URL(url);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') {
			return apiJson({ ok: false, error: 'URL must use http or https.' }, 400);
		}
	} catch {
		return apiJson({ ok: false, error: 'Invalid URL.' }, 400);
	}
	const relay = await createRelay(env, server.id, label, url, token);
	return apiJson({ ok: true, relay });
});
