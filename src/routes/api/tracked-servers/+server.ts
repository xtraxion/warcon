import { json } from '@sveltejs/kit';
import { fetchTrackedServers } from '$lib/server/tracked-servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const tracked = await fetchTrackedServers();
	return json(tracked);
};
