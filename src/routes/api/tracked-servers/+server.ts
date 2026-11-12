import { apiJson, route } from '$lib/server/http';
import { requireUser } from '$lib/server/access';
import { fetchTrackedServers } from '$lib/server/tracked-servers';

export const GET = route(async ({ locals }) => {
	requireUser(locals);
	const tracked = await fetchTrackedServers();
	return apiJson(tracked);
});
