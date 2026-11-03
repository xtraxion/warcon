// AFK Protection Match (kind `cash_watch`), the pure part. Monitors a list of target players and kills
// (respawns) them if their cash has not increased within a random time window. Each target gets
// their own rolling timer; when it fires and the player's cash hasn't risen since the timer
// started, they are killed. Cash growth resets the timer.
//
// The rule trusts the cash value the host reports per player. If the host reports 0 for everyone,
// active players may be respawned too; disable the rule in that case.
//
// Only a live match counts: a side has scored, no match ended at this look, and the rule's count
// is on. Whatever stops the count (the match not live, the player off the list, a gap in the looks)
// starts their time again.

import { int, str } from './http';
import { MAX_CHAT } from '$lib/chat';

export const CASH_WATCH_MIN_MINUTES = 5;
export const CASH_WATCH_MAX_MINUTES = 120;
export const CASH_WATCH_DEFAULT_MIN_MINUTES = 5;
export const CASH_WATCH_DEFAULT_MAX_MINUTES = 9;

export interface CashWatchConfig {
	/** minimum minutes between checks (random window low bound) */
	minMinutes: number;
	/** maximum minutes between checks (random window high bound) */
	maxMinutes: number;
	/** message whispered after the kill ('' for none) */
	killMessage: string;
	/** only act while at most this many are on */
	maxPlayers: number;
	/** target SteamIDs to watch; rule does nothing if empty */
	targets: string[];
}

export function validateCashWatch(c: Record<string, unknown>): CashWatchConfig {
	const minMinutes = int(c.minMinutes, CASH_WATCH_DEFAULT_MIN_MINUTES, CASH_WATCH_MIN_MINUTES, CASH_WATCH_MAX_MINUTES);
	const maxMinutes = int(c.maxMinutes, CASH_WATCH_DEFAULT_MAX_MINUTES, CASH_WATCH_MIN_MINUTES, CASH_WATCH_MAX_MINUTES);
	if (maxMinutes < minMinutes)
		throw new Error('The maximum minutes must be at least the minimum minutes.');
	return {
		minMinutes,
		maxMinutes,
		killMessage: str(c.killMessage, MAX_CHAT),
		maxPlayers: int(c.maxPlayers, 100, 1, 1000),
		targets: Array.isArray(c.targets)
			? (c.targets as unknown[]).map((s) => String(s).trim()).filter((s) => /^\d{17}$/.test(s))
			: []
	};
}

export interface CashWatchPlayer {
	steamId: string;
	cash: number;
	spared: boolean;
}

export interface CashWatchState {
	at: number;
	cash: number;
	/** when this player's next check is due (ms since epoch) */
	dueAt: number;
}

/** The next due time for a player, randomly between min and max minutes from now. */
export function cashWatchDueAt(now: number, cfg: CashWatchConfig): number {
	const rangeMs = (cfg.maxMinutes - cfg.minMinutes) * 60_000;
	const extraMs = rangeMs > 0 ? Math.floor(Math.random() * (rangeMs + 1)) : 0;
	return now + cfg.minMinutes * 60_000 + extraMs;
}

/** Compute the next step for each target player. */
export function cashWatchStep(
	cfg: CashWatchConfig,
	prev: CashWatchState | null,
	ctx: {
		now: number;
		live: boolean;
		count: number;
		players: CashWatchPlayer[];
	}
): {
	warn: { steamId: string; idleMs: number }[];
	act: { steamId: string; idleMs: number }[];
	next: CashWatchState | null;
	/** why nothing happened */
	held: string;
} {
	if (!cfg.targets.length) return { warn: [], act: [], next: null, held: 'No target players configured.' };
	if (!ctx.live) return { warn: [], act: [], next: prev, held: 'Match not live.' };
	if (ctx.count > cfg.maxPlayers) return { warn: [], act: [], next: prev, held: `Above ${cfg.maxPlayers} players.` };

	const targets = new Set(cfg.targets);
	const on = ctx.players.filter((p) => targets.has(p.steamId) && !p.spared);
	if (!on.length) return { warn: [], act: [], next: prev, held: 'No target players on server.' };

	// Cash comparison happens per-target below; a host reporting no cash for anyone
	// would previously block here, but that also blocks legitimate AFK targets with 0 cash.

	const byId = new Map(ctx.players.map((p) => [p.steamId, p]));
	const p = on[0]; // we handle one player per step; the worker loops per rule per tick

	const now = ctx.now;

	// First time we see this player in this rule window
	if (!prev || prev.cash === undefined) {
		return {
			warn: [],
			act: [],
			next: { at: now, cash: p.cash, dueAt: cashWatchDueAt(now, cfg) },
			held: ''
		};
	}

	// Cash increased → reset timer
	if (p.cash > prev.cash) {
		return {
			warn: [],
			act: [],
			next: { at: now, cash: p.cash, dueAt: cashWatchDueAt(now, cfg) },
			held: ''
		};
	}

	const idleMs = now - prev.at;

	// Action phase
	if (now >= prev.dueAt) {
		return {
			warn: [],
			act: [{ steamId: p.steamId, idleMs }],
			next: { at: now, cash: p.cash, dueAt: cashWatchDueAt(now, cfg) },
			held: ''
		};
	}

	return { warn: [], act: [], next: prev, held: '' };
}
