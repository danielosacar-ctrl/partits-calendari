// Lector programat (GitHub Actions). Llegeix la FCBQ i desa a Supabase.
//   node scraper/scrape.mjs matches          partits dels equips que fan servir les famílies
//   node scraper/scrape.mjs clubs            llista de clubs i equips de cada club
//   node scraper/scrape.mjs team 2737-90955  un equip concret (proves)
// Variables d'entorn: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { parseClub, parseClubs, parseMatches, fetchFcbq, teamCalendarPath, withUids, teamNameFrom } from '../supabase/functions/_shared/fcbq.js';
import { makeDb, saveTeamMatches } from '../supabase/functions/_shared/db.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Falten SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = makeDb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSE = 1200; // pausa entre peticions per no carregar la web de la FCBQ
const ACTIVE_DAYS = 120; // equips que ningú ha consultat en 4 mesos deixen de llegir-se

async function scrapeTeam(clubId, teamId) {
  const parsed = withUids(parseMatches(await fetchFcbq(teamCalendarPath(clubId, teamId))), teamId);
  const info = teamNameFrom(parsed, teamId);
  await saveTeamMatches(db, clubId, teamId, parsed, info);
  return parsed.length;
}

async function matches() {
  const since = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString();
  const list = await db.select('tracked', `select=team_id,club_id,fail_count&requested_at=gte.${since}&order=scraped_at.asc.nullsfirst`);
  console.log(`${list.length} equips a llegir`);
  let ok = 0, fail = 0, blocked = 0;
  for (const t of list) {
    try {
      const n = await scrapeTeam(t.club_id, t.team_id);
      console.log(`✓ ${t.club_id}-${t.team_id}: ${n} partits`);
      ok++;
    } catch (e) {
      fail++;
      if (/bloquejat|403|429/.test(e.message)) blocked++;
      console.log(`✗ ${t.club_id}-${t.team_id}: ${e.message}`);
      await db.upsert('tracked', [{ team_id: t.team_id, club_id: t.club_id, fail_count: (t.fail_count || 0) + 1 }], 'team_id').catch(() => {});
    }
    await sleep(PAUSE);
  }
  console.log(`Fet: ${ok} bé, ${fail} errors`);
  if (list.length && ok === 0) {
    console.error(blocked ? 'La FCBQ està bloquejant les lectures des de GitHub.' : 'Cap equip s\'ha pogut llegir.');
    process.exit(1); // el workflow surt en vermell i GitHub t'avisa per correu
  }
}

async function clubs() {
  const all = parseClubs(JSON.parse(await fetchFcbq('/clubs/ajax')));
  if (all.length < 50) throw new Error(`Només ${all.length} clubs: sembla que la lectura ha fallat`);
  await db.upsert('clubs', all.map((c) => ({ ...c, updated_at: new Date().toISOString() })), 'id');
  console.log(`${all.length} clubs desats`);
  let n = 0;
  for (const c of all) {
    try {
      const teams = parseClub(await fetchFcbq(`/club/${c.id}`));
      await db.upsert('teams', teams.map((t) => ({ ...t, club_id: c.id, listed: true, updated_at: new Date().toISOString() })), 'id');
      n += teams.length;
    } catch (e) {
      console.log(`✗ club ${c.id}: ${e.message}`);
    }
    await sleep(PAUSE);
  }
  console.log(`${n} equips desats`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'clubs') await clubs();
else if (mode === 'team' && /^\d+-\d+$/.test(arg || '')) console.log(await scrapeTeam(...arg.split('-')), 'partits');
else await matches();
