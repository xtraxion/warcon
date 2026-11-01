import type { PageServerLoad } from './$types';
import { fetchTrackedServers } from '$lib/server/tracked-servers';

export const load: PageServerLoad = async () => {
	const tracked = await fetchTrackedServers();
	return { tracked };
};
