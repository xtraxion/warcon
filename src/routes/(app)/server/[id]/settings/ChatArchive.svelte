<script lang="ts">
	// A copy of the game's chat, kept seven days for moderation (complaints about insults or
	// threats): the worker reads the chat of a server whose owner asks for it, and keeps it for
	// seven days. Off unless asked for: a game's chat is not read or kept without reason.
	import { invalidateAll } from '$app/navigation';
	import { api, errorMessage } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import type { ServerInfo } from '$lib/types';

	let { data }: { data: { server: ServerInfo } } = $props();
	let busy = $state(false);

	async function setArchive(on: boolean) {
		busy = true;
		try {
			await api('PATCH', `/api/servers/${encodeURIComponent(data.server.id)}`, {
				chatArchive: on
			});
			toast(on ? 'The chat is archived for seven days.' : 'The chat is no longer archived.', 'ok');
			await invalidateAll();
		} catch (err) {
			toast(errorMessage(err), 'err');
		} finally {
			busy = false;
		}
	}
</script>

<div class="panel">
	<span class="label-sm">Chat archive</span>
	<p class="mb-4 text-[13px] text-mist-400">
		A copy of the game's chat, kept seven days for moderation: complaints about insults or threats
		are looked at with the lines that were said. Only staff with the right to read archived chats
		see them, and they are gone after seven days. Off unless an owner asks for it.
	</p>
	{#if !data.server.manager}
		<p class="note">Only an owner of {data.server.orgName} can switch this on.</p>
	{:else}
		<label class="flex items-center gap-2 text-[14px]">
			<input
				type="checkbox"
				checked={data.server.chatArchive}
				disabled={busy}
				onchange={(e) => setArchive(e.currentTarget.checked)}
			/>
			<span class="font-medium">Keep the chat for seven days</span>
		</label>
		<p class="mt-1 pl-6 text-[12.5px] text-mist-400">
			The worker reads the chat of this server on every look and keeps what it reads.
		</p>
	{/if}
</div>
