import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { getOrg, listsRoleFor, requireServerCap, auditVisibility } from '$lib/server/access';
import { normalizeError } from '$lib/server/http';
import { orgListsView, serverListsState } from '$lib/server/lists';
import { queryAudit } from '$lib/server/audit';
import { user as userTable } from '$lib/server/db/schema';
import { inArray } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const env = getEnv();
	try {
		const { server, user, access } = await requireServerCap(env, locals, params.id, 'server.view');
		const [listState, org, role, kickRows] = await Promise.all([
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
		const actorIds = [...new Set(kickRows.map((k) => k.actorId).filter((id): id is string => !!id))];
		const users = actorIds.length
			? await env.db
					.select({ id: userTable.id, name: userTable.name })
					.from(userTable)
					.where(inArray(userTable.id, actorIds))
			: [];
		const userNames = new Map(users.map((u) => [u.id, u.name]));
		const kicks = kickRows.map((k) => {
			const detail = k.detail && typeof k.detail === 'object' ? (k.detail as Record<string, unknown>) : {};
			return {
				id: k.id,
				ts: k.ts,
				actorName: (k.actorId && userNames.get(k.actorId)) || k.actorName,
				target: k.target,
				reason: typeof detail.reason === 'string' ? detail.reason : '',
				message: k.message,
				outcome: k.outcome
			};
		});
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
