import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { hasTestDb, testEnv } from './db';
import { callApi } from './call';
import { seedWorld, type World } from './world';
import type { Env } from '$lib/server/env';
import { matches, chatArchive, chatArchivePending, orgRoles } from '$lib/server/db/schema';
import { acquireOrRenew, ownershipPeriod, releaseOwnership } from '$lib/server/leadership';
import { collectChat, expireChat } from '$lib/server/chat-archive';
import type { WardogsClient } from '$lib/server/rcon';
import { GET } from '../routes/api/servers/[id]/matches/[matchId]/chat/+server';

describe.skipIf(!hasTestDb)('archived chat integration', () => {
 let env: Env; let w: World;
 beforeAll(async () => { env = await testEnv(); w = await seedWorld(env); });
 test('a full unresolved page must not block later pages', async () => {
   const now=Date.now(), server=w.otherServer, paths:string[]=[];
   const [match]=await env.db.insert(matches).values({serverId:server.id,startedAt:new Date(now-20000)}).returning();
   const messages=Array.from({length:501},(_,i)=>({seq:i+1,sentUtc:new Date(now-(i===0?60000:10000)).toISOString(),channel:'Global',realName:'test',text:`page ${i}`}));
   const client={json:async (_method:string,path:string)=>{paths.push(path); const after=Number(new URL('http://test'+path).searchParams.get('after')); return {latestSeq:501,messages:messages.filter(l=>l.seq>after).slice(0,500)};}} as unknown as WardogsClient;
   expect(await acquireOrRenew(env,'archive page blockage')).toBe(true);
   try {
     await collectChat(env,client,server.id,ownershipPeriod());
     expect(paths).toContain('/v1/chat?after=500&limit=500');
     expect((await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,server.id))).length).toBe(500);
   } finally { await releaseOwnership(env); await env.db.delete(chatArchivePending).where(eq(chatArchivePending.serverId,server.id)); await env.db.delete(matches).where(eq(matches.id,match.id)); }
 });
 test('retries missing and overlapping match windows without advancing the cursor', async () => {
   const now = Date.now();
   const [server] = [w.otherServer];
   const paths: string[] = [];
   const messages = [{seq:1,sentUtc:new Date(now-30000).toISOString(),channel:'Global',realName:'test',text:'deferred'}, {seq:2,sentUtc:new Date(now-10000).toISOString(),channel:'Global',realName:'test',text:'later'}];
   const client = {json:async (_method:string,path:string) => { paths.push(path); const after=Number(new URL('http://test'+path).searchParams.get('after')); return {latestSeq:2,messages:messages.filter(l=>l.seq>after)}; }} as unknown as WardogsClient;
   expect(await acquireOrRenew(env,'archive ambiguity test')).toBe(true);
   try {
     await collectChat(env,client,server.id,ownershipPeriod());
     expect((await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,server.id))).length).toBe(0);
     expect((await env.db.select().from(chatArchivePending).where(eq(chatArchivePending.serverId,server.id))).length).toBe(2);
     await releaseOwnership(env);
     expect(await acquireOrRenew(env,'archive worker reacquired')).toBe(true);
     const restartModule: string = '../lib/server/chat-archive?worker-restart';
     const restartedCollector: typeof import('$lib/server/chat-archive') = await import(restartModule);
     const [one] = await env.db.insert(matches).values({serverId:server.id,startedAt:new Date(now-60000)}).returning();
     const [overlap] = await env.db.insert(matches).values({serverId:server.id,startedAt:new Date(now-40000),endedAt:new Date(now-20000)}).returning();
     paths.length=0;
     await restartedCollector.collectChat(env,client,server.id,ownershipPeriod());
     expect(paths[0]).toContain('after=0');
     expect((await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,server.id))).length).toBe(1);
     await env.db.delete(matches).where(eq(matches.id,overlap.id));
     paths.length=0;
     await collectChat(env,client,server.id,ownershipPeriod());
     expect(paths[0]).toContain('after=2');
     const rows=await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,server.id));
     expect(rows.length).toBe(2);
     expect(rows.every(r=>r.matchId===one.id)).toBe(true);
     expect((await env.db.select().from(chatArchivePending).where(eq(chatArchivePending.serverId,server.id))).length).toBe(0);
     paths.length=0;
     await collectChat(env,client,server.id,ownershipPeriod());
     expect(paths[0]).toContain('after=2');
     await env.db.delete(matches).where(eq(matches.id,one.id));
   } finally { await releaseOwnership(env); }
 });
 test('pages over 500 messages, separates matches, deduplicates and enforces archive permissions', async () => {
   const now = Date.now();
   const [old] = await env.db.insert(matches).values({serverId:w.server.id,startedAt:new Date(now-100000),endedAt:new Date(now-50000)}).returning();
   const [current] = await env.db.insert(matches).values({serverId:w.server.id,startedAt:new Date(now-50000)}).returning();
   const [other] = await env.db.insert(matches).values({serverId:w.otherServer.id,startedAt:new Date(now-100000),endedAt:new Date(now-50000)}).returning();
   const all = Array.from({length:650}, (_,i) => ({seq:i+1,sentUtc:new Date(now-(i<325?75000:25000)).toISOString(),channel:'Global',realName:'test',text:`fixture ${i}`}));
   const paths:string[]=[];
   const client = {json:async (_method:string,path:string) => { paths.push(path); const after=Number(new URL('http://test'+path).searchParams.get('after')); return {latestSeq:650,messages:all.filter(l=>l.seq>after).slice(0,500)}; }} as unknown as WardogsClient;
   expect(await acquireOrRenew(env,'archive test')).toBe(true);
   try {
    await collectChat(env,client,w.server.id,ownershipPeriod());
    await collectChat(env,client,w.server.id,ownershipPeriod());
    expect(paths).toContain('/v1/chat?after=500&limit=500');
    expect(paths.at(-1)).toBe('/v1/chat?after=650&limit=500');
    const restarted = Array.from({length:700}, (_,i) => ({seq:i+1,sentUtc:new Date(now-10000).toISOString(),channel:'Global',realName:'test',text:`restart ${i}`}));
    const restartPaths:string[]=[];
    const restartClient = {json:async (_method:string,path:string) => { restartPaths.push(path); const after=Number(new URL('http://test'+path).searchParams.get('after')); return {latestSeq:700,messages:restarted.filter(l=>l.seq>after).slice(0,500)}; }} as unknown as WardogsClient;
    await collectChat(env,restartClient,w.server.id,ownershipPeriod(), now-120000);
    restartPaths.length = 0;
    await collectChat(env,restartClient,w.server.id,ownershipPeriod(), now-115000);
    expect(restartPaths).toEqual(['/v1/chat?after=700&limit=500']);
    restartPaths.length = 0;
    await collectChat(env,restartClient,w.server.id,ownershipPeriod(), now-1000);
    expect(restartPaths[0]).toBe('/v1/chat?after=0&limit=500');
    expect((await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,w.server.id))).length).toBe(1350);
    const rows=await env.db.select().from(chatArchive).where(eq(chatArchive.serverId,w.server.id));
    expect(rows.length).toBe(1350);
    expect(rows.filter(r=>r.matchId===old.id).length).toBe(325);
    expect(rows.filter(r=>r.matchId===current.id).length).toBe(1025);
    await env.db.update(orgRoles).set({capabilities:['server.view','chat.archive.read']}).where(eq(orgRoles.id,w.roles.viewer));
    const params={id:w.server.id,matchId:String(old.id)};
    const first=await callApi(GET,w.users.viewer,{params});
    expect(first.status).toBe(200);
    const body=first.body as {lines:unknown[];nextCursor:string};
    expect(body.lines.length).toBe(200); expect(body.nextCursor).toBeTruthy();
    const second=await callApi(GET,w.users.viewer,{params,query:`cursor=${body.nextCursor}`});
    expect((second.body as {lines:unknown[]}).lines.length).toBe(125);
    expect((await callApi(GET,w.users.operator,{params})).status).toBe(403);
    expect((await callApi(GET,w.users.keyAll,{params})).status).toBe(403);
    expect((await callApi(GET,w.users.viewer,{params:{...params,matchId:String(other.id)}})).status).toBe(404);
    expect((await callApi(GET,w.users.viewer,{params:{...params,matchId:String(current.id)}})).status).toBe(404);
    await env.db.insert(chatArchive).values({serverId:w.server.id,matchId:old.id,sentAt:new Date(now-8*86400000),line:{text:'expired'},fingerprint:'expired-fixture'});
    await env.db.insert(chatArchivePending).values([
      {serverId:w.server.id,fingerprint:'pending-old',sentAt:new Date(now-8*86400000),line:{}},
      {serverId:w.server.id,fingerprint:'pending-future',sentAt:new Date(now+8*86400000),firstSeenAt:new Date(now-8*86400000),line:{}},
      {serverId:w.server.id,fingerprint:'pending-keep',sentAt:new Date(now-1000),line:{}}
    ]);
    await expireChat(env);
    expect((await env.db.select().from(chatArchive).where(eq(chatArchive.fingerprint,'expired-fixture'))).length).toBe(0);
    const pending=await env.db.select().from(chatArchivePending).where(eq(chatArchivePending.serverId,w.server.id));
    expect(pending.map(p=>p.fingerprint)).toEqual(['pending-keep']);
   } finally { await releaseOwnership(env); }
 });
});
