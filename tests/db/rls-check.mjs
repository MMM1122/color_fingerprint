// Usage: npm run test:db
// Runs supabase/migrations/001_accounts.sql in PGlite (real Postgres compiled to WASM) on top of a
// minimal copy of Supabase's auth schema and roles, then checks the row-level security rules.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(process.argv[2], 'utf8');
const db = new PGlite();

// --- Minimal Supabase environment: roles, auth.users, auth.uid() from the JWT claim setting ---
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);

await db.exec(sql);
// Supabase grants table privileges to these roles by default; RLS is what restricts rows.
await db.exec(`grant select, insert, update, delete on public.fingerprints to authenticated;`);
await db.exec(sql); // second run: the migration must be safe to re-run

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`);

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};
async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
const tryQ = async (q, params) => {
  try {
    return { ok: true, res: await db.query(q, params) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};

// A saves a fingerprint.
await as('authenticated', A, async () => {
  const r = await tryQ(`insert into public.fingerprints (user_id, data) values ($1, $2)`, [A, JSON.stringify({ schemaVersion: 1, who: 'A' })]);
  check('A can save their own fingerprint', r.ok);
});
// B tries to write a row for A.
await as('authenticated', B, async () => {
  const r = await tryQ(`insert into public.fingerprints (user_id, data) values ($1, $2)`, [A, JSON.stringify({ who: 'B-as-A' })]);
  check('B cannot create a row for A', !r.ok);
  const read = await db.query(`select * from public.fingerprints`);
  check('B cannot see A’s row', read.rows.length === 0);
  const upd = await db.query(`update public.fingerprints set data = '{"hacked":true}' where user_id = $1`, [A]);
  check('B cannot change A’s row', upd.affectedRows === 0);
  const del = await db.query(`delete from public.fingerprints where user_id = $1`, [A]);
  check('B cannot delete A’s row', del.affectedRows === 0);
  const own = await tryQ(`insert into public.fingerprints (user_id, data) values ($1, $2)`, [B, JSON.stringify({ who: 'B' })]);
  check('B can save their own fingerprint', own.ok);
});
// Anonymous visitors.
await as('anon', null, async () => {
  const r = await tryQ(`select * from public.fingerprints`);
  check('Signed-out visitors cannot read anything', !r.ok || r.res.rows.length === 0);
  const del = await tryQ(`select public.delete_my_account()`);
  check('Signed-out visitors cannot call delete_my_account', !del.ok);
});
// A reads and updates own row; updated_at moves.
await as('authenticated', A, async () => {
  const before = (await db.query(`select updated_at, data from public.fingerprints`)).rows;
  check('A sees exactly one row (their own)', before.length === 1 && before[0].data.who === 'A');
  await new Promise((r) => setTimeout(r, 20));
  await db.query(`update public.fingerprints set data = $1 where user_id = $2`, [JSON.stringify({ who: 'A2' }), A]);
  const after = (await db.query(`select updated_at from public.fingerprints`)).rows;
  check('updated_at changes on update', new Date(after[0].updated_at) > new Date(before[0].updated_at));
  const big = await tryQ(`update public.fingerprints set data = $1 where user_id = $2`, [JSON.stringify({ pad: 'x'.repeat(1_100_000) }), A]);
  check('Oversized data is rejected', !big.ok);
});
// A deletes their account: only A's user and row go.
await as('authenticated', A, async () => {
  const r = await tryQ(`select public.delete_my_account()`);
  check('A can delete their own account', r.ok);
});
const users = (await db.query(`select id from auth.users order by id`)).rows.map((r) => r.id);
const rows = (await db.query(`select user_id from public.fingerprints`)).rows.map((r) => r.user_id);
check('Deleting A removed A’s user and data (cascade)', !users.includes(A) && !rows.includes(A));
check('B’s account and data are untouched', users.includes(B) && rows.includes(B));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll RLS checks passed');
process.exit(failures ? 1 : 0);
