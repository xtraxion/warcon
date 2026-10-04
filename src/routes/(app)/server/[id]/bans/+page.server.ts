import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { getOrg, listsRoleFor, requireServerCap, auditVisibility } from '$lib/server/access';
import { normalizeError } from '$lib/server/http';
import { orgListsView, serverListsState } from '$lib/server/lists';
import { queryAudit } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const env = getEnv();
	try {
		const { server, user, access } = await requireServerCap(env, locals, params.id, 'server.view');
		const [listState, org, role, kicks] = await Promise.all([
			serverListsState(env, server, user, access),
			getOrg(env, server.orgId),
			listsRoleFor(env, user, server.orgId),
			// Recent kicks on this server (rcon.kick audit rows)
			queryAudit(env, {
				serverId: server.id,
				category: 'rcon',
				action: 'rcon.kick',
				visibleTo: await auditVisibility(env, user)
			}).then((r) => r.entries).catch(() => [])
		]);
		return {
			tab: url.searchParams.get('tab') === 'kicks' ? 'kicks' : 'bans',
			listState,
			orgLists: org && role ? await orgListsView(env, org, role) : null,
			kicks
		};
	} catch (err) {
		const known = normalizeError(err);
		if (!known) throw err;
		error(known.status, known.message);
	}
};
