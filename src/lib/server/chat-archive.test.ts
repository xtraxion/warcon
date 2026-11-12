import { describe, expect, test } from 'bun:test';
import { eligibleLine, lineFingerprint, RETENTION_MS } from './chat-archive';
import type { ChatLine } from '$lib/chat-read';

const now = Date.parse('2026-11-12T12:00:00Z');
const line: ChatLine = { seq: 1, at: new Date(now).toISOString(), channel: 'Global', faction: '', steamId: '', name: 'Example', hiddenName: '', anonymous: false, text: 'hello', typed: null, ping: false };
describe('chat archive retention and identity', () => {
  test('accepts a dated message for seven days, but not future or undated', () => {
    expect(eligibleLine(line, now)).toBe(true);
    expect(eligibleLine({ ...line, at: new Date(now - RETENTION_MS - 1).toISOString() }, now)).toBe(false);
    expect(eligibleLine({ ...line, at: new Date(now + 1).toISOString() }, now)).toBe(false);
    expect(eligibleLine({ ...line, at: null }, now)).toBe(false);
  });
  test('deduplicates repeated reads but distinguishes restart sequence reuse', () => {
    expect(lineFingerprint(line)).toBe(lineFingerprint({ ...line }));
    expect(lineFingerprint(line)).not.toBe(lineFingerprint({ ...line, at: new Date(now + 1000).toISOString() }));
  });
});
