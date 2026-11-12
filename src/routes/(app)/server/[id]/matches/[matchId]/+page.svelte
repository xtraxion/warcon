<script lang="ts">
	// One match: the header, final scores, the score over time, awards and the scoreboard from the
	// page's data, and the match's kill feed from the kills route narrowed to it, paged.
	import { api, errorMessage, qs } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { matches } from '$lib/table.svelte';
	import MatchPanel from '$lib/components/MatchPanel.svelte';
	import FactionChip from '$lib/components/FactionChip.svelte';
	import { causeLabel } from '$lib/causes';
	import { fmtDuration, fmtTime } from '$lib/format';
	import { shownName, type ChatLine } from '$lib/chat-read';
	import type { KillView } from '$lib/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let id = $derived(data.server.id);
	let view = $derived(data.match);
	const PAGE = 100;
	let kills = $state<KillView[]>([]);
	let more = $state(false);
	let loading = $state(false);
	let seq = 0;
	let archiveOpen = $state(false);
	let archiveLoading = $state(false);
	let archiveError = $state('');
	let archiveLines = $state<ChatLine[]>([]);
	let archiveCursor = $state<string | null>(null);
	let archiveRequest = 0;
	let archiveChannel = $state('');
	let archiveSearch = $state('');
	let archiveChannels = $derived([...new Set(archiveLines.map((line) => line.channel).filter(Boolean))].sort());
	let archiveChannelOptions = $derived(archiveChannel && !archiveChannels.includes(archiveChannel) ? [...archiveChannels, archiveChannel].sort() : archiveChannels);
	let archiveRows = $derived(archiveLines.filter((line) =>
		(!archiveChannel || line.channel === archiveChannel) &&
		matches(archiveSearch, line.name, line.hiddenName, line.text, line.typed, line.steamId)
	));
	async function loadArchive(append = false) {
		const request = ++archiveRequest;
		archiveLoading = true;
		archiveError = '';
		try {
			const result = await api<{ lines: ChatLine[]; nextCursor: string | null }>('GET',
				`/api/servers/${encodeURIComponent(id)}/matches/${encodeURIComponent(view.match.id)}/chat${qs({ cursor: append ? archiveCursor : undefined })}`);
			if (request !== archiveRequest) return;
			archiveLines = append ? [...archiveLines, ...result.lines] : result.lines;
			archiveCursor = result.nextCursor;
		} catch (err) {
			if (request === archiveRequest) archiveError = errorMessage(err);
		} finally {
			if (request === archiveRequest) archiveLoading = false;
		}
	}
	function toggleArchive() {
		archiveOpen = !archiveOpen;
		if (archiveOpen) void loadArchive();
		else { archiveRequest++; archiveLines = []; archiveCursor = null; archiveLoading = false; }
	}

	async function load(append = false) {
		const my = ++seq;
		const last = append ? kills[kills.length - 1] : undefined;
		loading = true;
		try {
			const r = await api<{ kills: KillView[] }>(
				'GET',
				`/api/servers/${encodeURIComponent(id)}/kills${qs({
					match: view.match.id,
					limit: PAGE,
					before: last?.ts,
					beforeTime: last?.eventTime
				})}`
			);
			if (my !== seq) return;
			kills = last ? [...kills, ...r.kills] : r.kills;
			more = r.kills.length === PAGE;
		} catch (err) {
			toast(errorMessage(err), 'err');
		} finally {
			if (my === seq) loading = false;
		}
	}
	$effect(() => {
		void view.match.id;
		kills = [];
		archiveRequest++; archiveOpen = false; archiveLines = []; archiveCursor = null; archiveLoading = false; archiveError = ''; archiveChannel = ''; archiveSearch = '';
		if (view.kills) void load();
	});
	const dossier = (steamId: string) =>
		`/server/${encodeURIComponent(id)}/players/${encodeURIComponent(steamId)}`;
	const factions = $derived(
		view.factions.map((f) => ({ name: f.name, colorHex: f.colorHex ?? '', score: 0 }))
	);
	const causeText = (k: KillView) =>
		causeLabel(k.cause) || (k.tags.includes('Falling') ? 'Fall' : '—');
</script>

<div class="panel">
	<a href="/server/{encodeURIComponent(id)}/matches" class="caps text-mist-400 hover:text-mist-100"
		>← Matches</a
	>
	<div class="mt-3">
		<MatchPanel {view} hrefFor={dossier} showIds />
	</div>
	{#if data.server.caps.some((cap: string) => cap === 'chat.archive.read')}
		<button class="mt-4 btn" onclick={toggleArchive} aria-expanded={archiveOpen}>
			{archiveOpen ? 'Close archived chat' : 'Read archived chat'}
		</button>
		{#if archiveOpen}
			<section class="mt-3" aria-label="Archived chat">
				<p class="note">Archived chat is retained for up to seven days.</p>
				<div class="mb-3 flex flex-wrap items-center gap-3">
					<select class="input w-36" aria-label="Channel" bind:value={archiveChannel}>
						<option value="">All channels</option>
						{#each archiveChannelOptions as c (c)}<option value={c}>{c}</option>{/each}
					</select>
					<input class="input w-full sm:w-64" type="search" placeholder="Filter by name, text or SteamID…" aria-label="Filter chat lines" bind:value={archiveSearch} />
					<span class="ml-auto text-[12.5px] text-mist-600">{archiveRows.length} of {archiveLines.length} loaded lines{archiveCursor ? ' · load more to search the rest' : ''}</span>
				</div>
				{#if archiveError}<div class="callout border-danger/30 bg-danger/12">{archiveError}</div>{/if}
				<div class="table-wrap"><table>
					<thead><tr><th>Time</th><th>Channel</th><th>Player</th><th>Message</th></tr></thead>
					<tbody>
						{#each archiveRows as line, index (index)}
							<tr><td>{line.at ? fmtTime(line.at) : '—'}</td><td>{line.channel || '—'}</td><td><span class="inline-flex items-center gap-2"><FactionChip faction={line.faction} scores={factions} /><span class="font-medium">{shownName(line)}</span></span></td><td class="break-words">{line.text}</td></tr>
						{:else}
							<tr><td colspan="4">{archiveLoading ? 'Loading…' : archiveError ? 'Could not load archived chat.' : archiveLines.length ? 'Nothing matches the current filter.' : 'No archived chat available for this match.'}</td></tr>
						{/each}
					</tbody>
				</table></div>
				{#if archiveCursor}<button class="mt-3 btn" disabled={archiveLoading} onclick={() => loadArchive(true)}>Load more</button>{/if}
				{#if archiveError}<button class="mt-3 btn" disabled={archiveLoading} onclick={() => loadArchive(false)}>Retry</button>{/if}
			</section>
		{/if}
	{/if}
	{#if view.kills}
		<span class="mt-4 field-label">Kill feed · {view.kills}</span>
		<div class="table-wrap">
			<table>
				<thead>
					<tr
						><th>Clock</th><th>Killer</th><th>Victim</th><th>Cause</th><th class="num">Distance</th
						><th></th></tr
					>
				</thead>
				<tbody>
					{#each kills as k (k.eventId)}
						<tr class={k.teamKill ? 'text-warn' : ''}>
							<td class="font-mono text-[12px] whitespace-nowrap text-mist-400"
								>{fmtDuration(k.eventTime)}</td
							>
							<td>
								{#if k.killer}
									<a
										href={dossier(k.killer.steamId)}
										data-sveltekit-preload-data="tap"
										class="hover:text-accent hover:underline">{k.killer.name}</a
									>
									{#if k.killer.faction}<FactionChip
											faction={k.killer.faction}
											scores={factions}
										/>{/if}
								{:else}<span class="text-mist-600">—</span>{/if}
							</td>
							<td>
								<a
									href={dossier(k.victim.steamId)}
									data-sveltekit-preload-data="tap"
									class="hover:text-accent hover:underline">{k.victim.name}</a
								>
								{#if k.victim.faction}<FactionChip
										faction={k.victim.faction}
										scores={factions}
									/>{/if}
							</td>
							<td class="text-mist-200">{causeText(k)}</td>
							<td class="num">{k.distanceM === null ? '—' : `${Math.round(k.distanceM)} m`}</td>
							<td class="whitespace-nowrap">
								{#if k.teamKill}<span class="chip">team kill</span>{/if}
								{#if k.suicide}<span class="chip">suicide</span>{/if}
								{#if k.headshot}<span class="chip">headshot</span>{/if}
							</td>
						</tr>
					{:else}
						<tr
							><td colspan="6" class="py-4 text-center text-mist-600"
								>{loading ? 'Loading…' : 'No kills of this match were received.'}</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
		{#if more}
			<button class="mt-3 btn" onclick={() => load(true)} disabled={loading}>
				{loading ? 'Loading…' : 'Load older kills'}
			</button>
		{/if}
	{/if}
	<p class="note">
		Kills, deaths and cash are the game's own scoreboard counters over this match; time is how long
		each player was on during it. {#if view.hasFeed}Headshots, team kills, vehicle kills and streaks
			come from the kill feed, newest kill first below.{:else}This server has no kill feed, so there
			are no feed columns.{/if} Awards need a match of twenty minutes; best K/D needs ten kills.
	</p>
</div>
