import { describe, expect, test } from 'bun:test';
import { chatPlaceKept, eligibleLine, lineAnchor, lineFingerprint, RETENTION_MS } from './chat-archive';
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

/** A line of a chat, as the game sends it. */
const at = (seq: number, text = 'hello'): ChatLine => ({
  ...line,
  seq,
  text,
  at: new Date(now + seq * 1000).toISOString()
});

describe('the place the collector keeps', () => {
  test('a place with nothing kept is kept', () => {
    expect(chatPlaceKept({ after: 0, anchor: null }, { latestSeq: 5, lines: [at(1)] })).toBe(true);
  });
  test('a game that numbers from the start again loses the place', () => {
    expect(chatPlaceKept({ after: 9, anchor: lineAnchor(at(9)) }, { latestSeq: 3, lines: [at(1)] })).toBe(false);
  });
  test('a chat that was replaced under the same numbers loses the place', () => {
    const place = { after: 9, anchor: lineAnchor(at(9, 'the old one')) };
    const read = { latestSeq: 12, lines: [at(9, 'another one'), at(10), at(11), at(12)] };
    expect(chatPlaceKept(place, read)).toBe(false);
  });
  test('the same chat under the same numbers keeps the place', () => {
    const place = { after: 9, anchor: lineAnchor(at(9, 'the old one')) };
    const read = { latestSeq: 12, lines: [at(9, 'the old one'), at(10)] };
    expect(chatPlaceKept(place, read)).toBe(true);
  });
  test('a place whose line the game no longer keeps is kept', () => {
    // The game keeps a bounded number of lines; when the place's own line has fallen out of
    // it, there is nothing to compare and no reason to read everything again.
    const place = { after: 9, anchor: lineAnchor(at(9, 'the old one')) };
    expect(chatPlaceKept(place, { latestSeq: 600, lines: [at(100)] })).toBe(true);
  });
  test('an anchor is what a line says about itself', () => {
    expect(lineAnchor(at(3, 'a'))).toBe(lineAnchor(at(3, 'a')));
    expect(lineAnchor(at(3, 'a'))).not.toBe(lineAnchor(at(4, 'a')));
    expect(lineAnchor(at(3, 'a'))).not.toBe(lineAnchor(at(3, 'b')));
  });
});
