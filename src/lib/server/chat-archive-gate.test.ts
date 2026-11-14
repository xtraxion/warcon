import { describe, expect, test } from 'bun:test';
import { archiveWanted } from './chat-archive';

describe('the chat archive', () => {
	test('is wanted only where the owner of a server asked for it', () => {
		expect(archiveWanted({ chatArchive: true })).toBe(true);
		expect(archiveWanted({ chatArchive: false })).toBe(false);
		expect(archiveWanted({})).toBe(false);
		expect(archiveWanted({ chatArchive: null })).toBe(false);
	});
});
