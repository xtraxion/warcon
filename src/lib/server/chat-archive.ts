// Match-scoped, seven-day moderation archive. Chat is never written to logs.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CHAT_MAX_LIMIT, chatReadOf, type ChatLine } from '$lib/chat-read';
import type { Env } from './env';
import type { WardogsClient } from './rcon';
import { withOwnedTransaction } from './leadership';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export function eligibleLine(line: ChatLine, now: number): boolean {
	if (!line.at) return false;
	const time = Date.parse(line.at);
	return Number.isFinite(time) && time >= now - RETENTION_MS && time <= now;
}
export function lineFingerprint(line: ChatLine): string {
	return createHash('sha256').update(JSON.stringify([line.seq, line.at, line.channel, line.steamId, line.name, line.text])).digest('hex');
}
/** Bounded game history is replayed oldest-first. If history exceeds the server buffer during an outage,
 * only retained messages can be recovered; the API has no external backfill source. */
const cursors = new Map<string, { period: number; after: number; serverEpoch: number | null }>();
// Uptime-derived start estimates jitter slightly between polls; require a meaningful change.
const SERVER_RESTART_DRIFT_MS = 60_000;

export async function collectChat(env: Env, client: WardogsClient, serverId: string, period: number, startedAt = 0): Promise<void> {
	const previous = cursors.get(serverId);
	let after = previous?.period === period ? previous.after : 0;
	const serverEpoch = startedAt > 0 ? startedAt : null;
	if (previous && previous.period === period && previous.serverEpoch !== null && serverEpoch !== null && Math.abs(previous.serverEpoch - serverEpoch) > SERVER_RESTART_DRIFT_MS) {
		after = 0;
		cursors.delete(serverId);
	}
	// Retry pending entries independently of the gameserver buffer and its cursor.
	await withOwnedTransaction(env, async (tx) => {
		await tx.execute(sql`
			WITH resolved AS (
				SELECT p.server_id, p.fingerprint, p.sent_at, p.line, min(m.id) AS match_id
				FROM chat_archive_pending p JOIN matches m ON m.server_id = p.server_id
				 AND m.started_at <= p.sent_at AND (m.ended_at IS NULL OR m.ended_at > p.sent_at)
				WHERE p.server_id = ${serverId} AND p.sent_at <= now()
				  AND p.sent_at >= now() - interval '7 days' AND p.first_seen_at >= now() - interval '7 days'
				GROUP BY p.server_id, p.fingerprint, p.sent_at, p.line HAVING count(*) = 1
			), inserted AS (
				INSERT INTO chat_archive (server_id, match_id, sent_at, line, fingerprint)
				SELECT server_id, match_id, sent_at, line, fingerprint FROM resolved
				ON CONFLICT (server_id, fingerprint) DO NOTHING RETURNING server_id, fingerprint
			)
			DELETE FROM chat_archive_pending p USING resolved r
			WHERE p.server_id = r.server_id AND p.fingerprint = r.fingerprint
			AND (EXISTS (SELECT 1 FROM inserted i WHERE i.server_id = p.server_id AND i.fingerprint = p.fingerprint)
			 OR EXISTS (SELECT 1 FROM chat_archive a WHERE a.server_id = p.server_id AND a.fingerprint = p.fingerprint))`);
	}, { period });
	for (let page = 0; page < 20; page++) {
		let raw: unknown;
		try {
			raw = await client.json('GET', `/v1/chat?after=${after}&limit=${CHAT_MAX_LIMIT}`);
		} catch (err) {
			if (typeof err === 'object' && err !== null && 'status' in err && [404, 409].includes(Number(err.status))) return;
			throw err;
		}
		const read = chatReadOf(raw);
		if (!read) return;
		// A game restart may reset its sequence. Re-read the retained buffer from zero.
		if (read.latestSeq !== null && read.latestSeq < after) {
			after = 0;
			cursors.delete(serverId);
			continue;
		}
		if (!read.lines.length) return;
		const now = Date.now();
		// Only dated lines can be assigned to a match. Future timestamps are queued too,
		// with retention bounded by first observation, not by an untrusted future clock.
		const lines = read.lines.filter((line) => !!line.at && Number.isFinite(Date.parse(line.at)) && Date.parse(line.at) >= now - RETENTION_MS);
		if (lines.length) await withOwnedTransaction(env, async (tx) => {
			for (const line of lines) {
				const at = new Date(line.at!);
				const fingerprint = lineFingerprint(line);
				const [matchCount] = await tx.execute<{ n: number }>(sql`
					SELECT count(*)::int AS n FROM matches m
					WHERE m.server_id = ${serverId} AND m.started_at <= ${at}
					  AND (m.ended_at IS NULL OR m.ended_at > ${at})`);
				if (at.getTime() > now || !matchCount || Number(matchCount.n) !== 1) {
					await tx.execute(sql`
						INSERT INTO chat_archive_pending (server_id, fingerprint, sent_at, line)
						SELECT ${serverId}, ${fingerprint}, ${at}, (${JSON.stringify(line)}::text)::jsonb
						WHERE NOT EXISTS (SELECT 1 FROM chat_archive WHERE server_id = ${serverId} AND fingerprint = ${fingerprint})
						ON CONFLICT (server_id, fingerprint) DO NOTHING`);
					continue;
				}
				await tx.execute(sql`
					INSERT INTO chat_archive (server_id, match_id, sent_at, line, fingerprint)
					SELECT ${serverId}, min(m.id), ${at}, (${JSON.stringify(line)}::text)::jsonb, ${fingerprint}
					FROM matches m
					WHERE m.server_id = ${serverId} AND m.started_at <= ${at}
					  AND (m.ended_at IS NULL OR m.ended_at > ${at})
					HAVING count(*) = 1
					ON CONFLICT (server_id, fingerprint) DO NOTHING`);
				// A match can change between the count and insert statements. If the insert
				// could not assign it, save it for a later retry rather than losing it.
				await tx.execute(sql`
					INSERT INTO chat_archive_pending (server_id, fingerprint, sent_at, line)
					SELECT ${serverId}, ${fingerprint}, ${at}, (${JSON.stringify(line)}::text)::jsonb
					WHERE NOT EXISTS (SELECT 1 FROM chat_archive WHERE server_id = ${serverId} AND fingerprint = ${fingerprint})
					ON CONFLICT (server_id, fingerprint) DO NOTHING`);
			}
		}, { period });
		const newest = read.lines[read.lines.length - 1].seq;
		if (newest <= after) return;
		// Persisted rows and the in-memory cursor advance only after the transaction succeeds.
		cursors.set(serverId, { period, after: newest, serverEpoch: serverEpoch ?? previous?.serverEpoch ?? null });
		if (!read.latestSeq || newest >= read.latestSeq || read.lines.length < CHAT_MAX_LIMIT) return;
		after = newest;
	}
}

export async function expireChat(env: Env): Promise<void> {
	await withOwnedTransaction(env, async (tx) => {
		await tx.execute(sql`DELETE FROM chat_archive WHERE sent_at < now() - interval '7 days'`);
		await tx.execute(sql`DELETE FROM chat_archive_pending WHERE sent_at < now() - interval '7 days' OR first_seen_at < now() - interval '7 days'`);
	});
}
