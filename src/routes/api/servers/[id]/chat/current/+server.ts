import { and, desc, eq, isNull } from 'drizzle-orm';
import { getEnv } from '$lib/server/env';
import { requireServerCap } from '$lib/server/access';
import { apiJson, param, route } from '$lib/server/http';
import { matches } from '$lib/server/db/schema';

export const GET = route(async (event) => {
  const env = getEnv();
  const { server } = await requireServerCap(env, event.locals, param(event, 'id'), 'chat.read');
  const [match] = await env.db.select({id:matches.id, startedAt:matches.startedAt})
    .from(matches).where(and(eq(matches.serverId,server.id), isNull(matches.endedAt)))
    .orderBy(desc(matches.id)).limit(1);
  return apiJson({match: match ? {id:match.id, startedAt:match.startedAt.toISOString()} : null});
});
