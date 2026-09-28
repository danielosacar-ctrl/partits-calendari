import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseMatches, parseClub, parseClubs, buildIcs, withUids } from '../supabase/functions/_shared/fcbq.js';
import { handle } from '../supabase/functions/_shared/api.js';
import { fakeDb } from './fakedb.mjs';

const f = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

// ---- lector
const matches = withUids(parseMatches(f('equip.html')), '90955');
assert.equal(matches.length, 3);
assert.equal(matches[0].date, '2026-10-04');
assert.equal(matches[0].away, "RIO LOGISTIC CB LLIÇÀ D'AMUNT TARONJA");
assert.equal(matches[0].address, 'AV. SANT ANDREU, 92');
assert.equal(matches[1].awayId, '90955');
const teams = parseClub(f('club.html'));
assert.equal(teams.length, 4);
assert.deepEqual(teams[2], { id: '92373', name: 'MARESME 3 VILES VERMELL - IM', category: 'C.T. INFANTIL MASCULÍ PROMOCIÓ' });
assert.deepEqual(parseClubs([{ id: '2737', name: 'CLUB BASQUET 3 VILES', town: 'X', adPassword: 'secret' }]), [{ id: '2737', name: 'CLUB BASQUET 3 VILES', town: 'X' }]);

// ---- calendari
const ics = buildIcs(matches, { conv: 45, post: 30, dur: 90, alarm: 60, name: 'Prova' }, new Date('2026-09-28T10:00:00Z'));
writeFileSync(new URL('./out.ics', import.meta.url), ics);
const un = ics.replace(/\r\n /g, '');
assert.match(un, /DTSTART;TZID=Europe\/Madrid:20261004T114500/);
assert.match(un, /DTEND;TZID=Europe\/Madrid:20261004T143000/);
assert.match(un, /LOCATION:NOU PAVELLO SANT ANDREU DE LLAVANERES\\, AV. SANT ANDREU\\, 92/);
assert.match(un, /DTSTART;VALUE=DATE:20261107/);
assert.match(un, /TRIGGER:-PT60M/);
for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, 'línia llarga: ' + l);
const moved = withUids([{ ...parseMatches(f('equip.html'))[0], date: '2026-10-05', time: '10:00' }], '90955');
assert.equal(moved[0].uid, matches[0].uid, 'UID estable si canvia data/hora');

// ---- API amb base de dades
const req = (p) => new Request('https://x.supabase.co/functions/v1/api' + p);
let dispatched = [];
let fcbqUp = true;
globalThis.fetch = async (u) => {
  if (!fcbqUp) return new Response('blocked', { status: 403 });
  u = String(u);
  if (u.endsWith('/clubs/ajax')) return new Response(JSON.stringify([{ id: '2737', name: 'CLUB BASQUET 3 VILES', town: 'LLAVANERES', adPassword: 'secret' }]));
  if (u.includes('/club/')) return new Response(f('club.html'));
  if (u.includes('calendari_equip_global')) return new Response(f('equip.html'));
  return new Response('', { status: 404 });
};
const deps = (db, live) => ({ db, live, dispatch: async (m) => dispatched.push(m) });

// 1) FCBQ accessible des de Supabase: tot en directe
let db = fakeDb();
let r = await handle(req('/clubs'), deps(db, true));
let body = await r.text();
assert.ok(!body.includes('secret'));
assert.equal(JSON.parse(body)[0].id, '2737');
r = await (await handle(req('/club/2737'), deps(db, true))).json();
assert.equal(r.teams.length, 4);
r = await (await handle(req('/teams?t=2737-90955'), deps(db, true))).json();
assert.equal(r[0].matches.length, 3);
assert.equal(r[0].pending, false);
assert.equal(r[0].team.name, 'FEMENÍ MARESME 3 VILES - MF');
assert.equal(db.T.matches.length, 3);
r = await handle(req('/cal.ics?t=2737-90955&c=60&p=45'), deps(db, true));
assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
body = (await r.text()).replace(/\r\n /g, '');
assert.match(body, /DTSTART;TZID=Europe\/Madrid:20261004T113000/); // 12:30 - 60'
assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 3);
assert.deepEqual(dispatched, []);

// 2) FCBQ bloqueja Supabase: avís "carregant" + petició a GitHub; després el lector programat omple
fcbqUp = false;
db = fakeDb();
body = await (await handle(req('/cal.ics?t=2737-90955'), deps(db, true))).text();
assert.match(body, /Carregant els partits/);
assert.deepEqual(dispatched, ['matches']);
assert.equal(db.T.tracked[0].team_id, '90955');
// el lector (GitHub) desa els partits
const { saveTeamMatches } = await import('../supabase/functions/_shared/db.js');
await saveTeamMatches(db, '2737', '90955', matches, { name: 'FEMENÍ MARESME 3 VILES - MF', category: 'C.C. MINI' });
body = await (await handle(req('/cal.ics?t=2737-90955'), deps(db, true))).text();
assert.doesNotMatch(body, /Carregant/);
assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 3);
// un partit desapareix a la FCBQ -> s'esborra
await saveTeamMatches(db, '2737', '90955', matches.slice(0, 2), null);
assert.equal(db.T.matches.length, 2);

// 3) paràmetre dolent
assert.equal((await handle(req('/cal.ics?t=xx'), deps(db, true))).status, 400);
console.log('OK — tots els tests passen');
