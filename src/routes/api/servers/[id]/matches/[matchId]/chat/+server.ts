import { sql } from 'drizzle-orm';
import { getEnv } from '$lib/server/env';
import { requireServerCap } from '$lib/server/access';
import { ApiError, apiJson, param, route } from '$lib/server/http';
import { parseMatchId } from '$lib/server/matches';

export const GET = route(async (event) => {
	const env = getEnv();
	const { server } = await requireServerCap(env, event.locals, param(event, 'id'), 'chat.archive.read');
	const matchId = parseMatchId(param(event, 'matchId'));
	if (matchId === null) throw new ApiError(404, 'No such match here.', 'not_found');
	const [match] = await env.db.execute<{ id: number }>(sql`
		SELECT id FROM matches WHERE id = ${matchId} AND server_id = ${server.id} AND ended_at IS NOT NULL`);
	if (!match) throw new ApiError(404, 'No such match here.', 'not_found');
	const raw = event.url.searchParams.get('cursor');
	if (raw && !/^\d{1,15}$/.test(raw)) throw new ApiError(400, 'Invalid cursor.', 'bad_request');
	const cursor = raw ? Number(raw) : 0;
	const rows = await env.db.execute<{ id: number; line: unknown }>(sql`
		SELECT id, line FROM chat_archive
		WHERE server_id = ${server.id} AND match_id = ${matchId} AND id > ${cursor}
		  AND sent_at >= now() - interval '7 days'
		ORDER BY id LIMIT 201`);
	return apiJson({ lines: rows.slice(0, 200).map((r) => r.line), nextCursor: rows.length > 200 ? String(rows[199].id) : null });
});
