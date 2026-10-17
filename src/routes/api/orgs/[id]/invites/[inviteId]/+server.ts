import { getEnv } from '$lib/server/env';
import { apiJson, param, route } from '$lib/server/http';
import { requireOrgRole } from '$lib/server/access';
import { revokeInvite, deleteInvite } from '$lib/server/orgs';

/**
 * Revokes the link (default). Rows are kept so the audit trail and "joined via" stay meaningful.
 * Pass ?permanent=1 to hard-delete a deactivated invite.
 */
export const DELETE = route(async (event) => {
	const env = getEnv();
	const { org, user } = await requireOrgRole(env, event.locals, param(event, 'id'), 'owner');
	const permanent = event.url.searchParams.get('permanent') === '1';
	if (permanent) {
		await deleteInvite(env, event.request, user, org, param(event, 'inviteId'));
	} else {
		await revokeInvite(env, event.request, user, org, param(event, 'inviteId'));
	}
	return apiJson({ ok: true });
});
