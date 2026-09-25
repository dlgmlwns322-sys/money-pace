// app_data 가드 SQL 검증(실제 Postgres = PGlite). 실행: npm i @electric-sql/pglite 후 node test/sql/guard.mjs supabase/guard.sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const sql = fs.readFileSync(process.argv[2], 'utf8');
const mk = async (rows) => { const db = new PGlite(); await db.exec(`create table public.app_data (id text primary key, data jsonb, updated_at timestamptz);`);
  for (const [id, d] of rows) await db.query(`insert into app_data values ($1,$2,now())`, [id, JSON.stringify(d)]); return db; };
const trig = async (db) => (await db.query(`select count(*)::int n from pg_trigger where tgname='app_data_guard'`)).rows[0].n;
// A: 썸네일만 큼 → 정리 후 설치
let db = await mk([['my_money_data', { rev: 3, captures: [{ id: 'a', thumb: 'x'.repeat(400000) }, { id: 'b' }] }]]);
await db.exec(sql);
const d = (await db.query(`select data from app_data`)).rows[0].data;
console.log('A 정리+설치:', JSON.stringify(d.captures), 'rev', d.rev, 'trigger', await trig(db));
try { await db.query(`update app_data set data=$1`, [JSON.stringify({ rev: 4, captures: [{ id: 'a', thumb: 'x' }] })]); console.log('A 썸네일 저장: 허용(오류)'); } catch (e) { console.log('A 썸네일 저장: 거부'); }
// B: 썸네일 없이 350KB → 전체 취소, 가드 없음, 데이터 그대로
db = await mk([['my_money_data', { rev: 3, captures: [{ id: 'a', thumb: 'y' }], big: 'z'.repeat(350000) }]]);
try { await db.exec(sql); console.log('B: 통과(오류)'); } catch (e) { console.log('B 중단:', e.message.slice(0, 60)); try { await db.exec('rollback'); } catch {} }
const d2 = (await db.query(`select data from app_data`)).rows[0].data;
console.log('B 되돌림: thumb 유지', d2.captures[0].thumb === 'y', 'trigger', await trig(db));
