import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/access';
import { fetchTrackedServers } from '$lib/server/tracked-servers';

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
	const tracked = await fetchTrackedServers();
	return { tracked };
};
