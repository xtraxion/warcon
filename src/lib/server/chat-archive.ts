// Match-scoped, seven-day moderation archive. Chat is never written to logs.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CHAT_MAX_LIMIT, chatReadOf, type ChatLine } from '$lib/chat-read';
import type { Env } from './env';
import type { WardogsClient } from './rcon';
import { withOwnedTransaction } from './leadership';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the worker may keep a copy of the game's chat for this server: only where an
 * owner asked for it. The game's chat terms forbid recording the chat beyond what
 * moderating the server requires, so the archive is off unless a server's owner turns it
 * on, and then only for seven days and for moderation.
 */
export function archiveWanted(server: { chatArchive?: boolean | null }): boolean {
	return server.chatArchive === true;
}
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
/** What the collector remembers between two reads of one server's chat. */
export interface ChatCursor {
	/** the leadership period the place belongs to */
	period: number;
	/** the newest line the collector has read */
	after: number;
	/** the game's start, as its uptime says it; a new one is a new process */
	serverEpoch: number | null;
	/** what the line under the newest number says, so a replaced chat can be told from a quiet one */
	anchor: string | null;
}
const cursors = new Map<string, ChatCursor>();
// Uptime-derived start estimates jitter slightly between polls; require a meaningful change.
const SERVER_RESTART_DRIFT_MS = 60_000;

/**
 * What a line says about itself, in the parts that never change: its number, when it was sent
 * and what it said. A player's name may be written differently later; this is not.
 */
export function lineAnchor(line: ChatLine): string {
	return createHash('sha256')
		.update(JSON.stringify([line.seq, line.at, line.text]))
		.digest('hex');
}

/**
 * Whether the place the collector kept is still the place the game keeps.
 *
 * The game's chat is a buffer of its own: a new map, a new process or a new world replaces it,
 * and the new one numbers its lines from one again. Two things give that away, and the second
 * is the one that matters:
 *   - the game's newest number is below the place: the new chat has not yet reached the place;
 *   - the line under the place is another one: the new chat has already numbered past the
 *     place, and only what that line says tells the two apart. Without it the lines between the
 *     new chat's start and the place are lost for good.
 */
export function chatPlaceKept(
	place: { after: number; anchor: string | null },
	read: { latestSeq: number | null; lines: ChatLine[] }
): boolean {
	// Nothing kept yet: nothing to compare against.
	if (place.after <= 0) return true;
	// The game numbers from the start again: its newest number is below the place.
	if (read.latestSeq !== null && read.latestSeq < place.after) return false;
	// The line under the place is another one: this is not the chat the place belongs to.
	if (place.anchor) {
		const under = read.lines.find((l) => l.seq === place.after);
		if (under && lineAnchor(under) !== place.anchor) return false;
	}
	return true;
}

export async function collectChat(
	env: Env,
	client: WardogsClient,
	serverId: string,
	period: number,
	startedAt = 0
): Promise<void> {
	const previous = cursors.get(serverId);
	const serverEpoch = startedAt > 0 ? startedAt : null;
	// The place the collector keeps: the newest line it has read, and what the line under that
	// number says.
	let after = previous?.period === period ? previous.after : 0;
	let anchor = previous?.period === period ? previous.anchor : null;
	if (
		previous &&
		previous.period === period &&
		previous.serverEpoch !== null &&
		serverEpoch !== null &&
		Math.abs(previous.serverEpoch - serverEpoch) > SERVER_RESTART_DRIFT_MS
	) {
		after = 0;
		anchor = null;
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
		// The line under the place is asked for as well: it is the only sign that the game's chat
		// was replaced while the collector was not looking, once the new chat has numbered past
		// the place and the newest number says nothing any more.
		const ask = page === 0 && after > 0 ? after - 1 : after;
		let raw: unknown;
		try {
			raw = await client.json('GET', `/v1/chat?after=${ask}&limit=${CHAT_MAX_LIMIT}`);
		} catch (err) {
			if (typeof err === 'object' && err !== null && 'status' in err && [404, 409].includes(Number(err.status))) return;
			throw err;
		}
		const read = chatReadOf(raw);
		if (!read) return;
		// The game's chat is another one: it numbers from one again, so the buffer is read from
		// the start and nothing of the old chat is read as new.
		if (!chatPlaceKept({ after, anchor }, read)) {
			after = 0;
			anchor = null;
			cursors.delete(serverId);
			continue;
		}
		if (!read.lines.length) return;
		const now = Date.now();
		// Only dated lines can be assigned to a match. Future timestamps are queued too,
		// with retention bounded by first observation, not by an untrusted future clock.
		// The place's own line is not written again: it is in the archive already.
		const lines = read.lines.filter(
			(line) =>
				line.seq > after &&
				!!line.at &&
				Number.isFinite(Date.parse(line.at)) &&
				Date.parse(line.at) >= now - RETENTION_MS
		);
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
		// The anchor is what the line under the newest number says, so the next read can tell a
		// chat that was replaced from one that merely went quiet.
		cursors.set(serverId, {
			period,
			after: newest,
			serverEpoch: serverEpoch ?? previous?.serverEpoch ?? null,
			anchor: lineAnchor(read.lines[read.lines.length - 1])
		});
		anchor = lineAnchor(read.lines[read.lines.length - 1]);
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
