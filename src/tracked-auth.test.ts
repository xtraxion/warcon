import { expect, test } from 'bun:test';
import { GET } from './routes/api/tracked-servers/+server';
import { load } from './routes/(app)/+page.server';

test('anonymous tracked status API is rejected', async () => {
 const res = await GET({ locals: { user: null } } as any);
 expect(res.status).toBe(401);
});
test('anonymous dashboard loader is rejected before fetching', async () => {
 let calls = 0; const old = globalThis.fetch;
 globalThis.fetch = (async () => { calls++; throw new Error('unexpected fetch'); }) as unknown as typeof fetch;
 try {
  await expect(Promise.resolve().then(() => load({ locals: { user: null } } as any))).rejects.toMatchObject({ status: 401 });
  expect(calls).toBe(0);
 } finally { globalThis.fetch = old; }
});
