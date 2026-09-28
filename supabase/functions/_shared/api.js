// Rutes de l'API (funció "api" de Supabase):
//   GET /clubs                       llista de clubs
//   GET /club/{id}                   equips d'un club
//   GET /teams?t=club-equip,...      partits dels equips (per a la web)
//   GET /cal.ics?t=...&c=&p=&d=&a=   calendari subscrivible (Google, Apple, Outlook)
//
// Les dades surten de la base de dades, que omple el lector programat de GitHub Actions.
// Si un equip encara no s'ha llegit mai, s'intenta llegir en directe; si la FCBQ ho bloqueja,
// es demana a GitHub Actions que el llegeixi ara mateix (tarda 1–2 minuts).

import { parseClub, parseClubs, parseMatches, buildIcs, fetchFcbq, teamCalendarPath, withUids, teamNameFrom } from './fcbq.js';
import { fromRow, saveTeamMatches } from './db.js';

const STALE_MS = 3 * 3600e3; // si fa més de 3 h que no es llegeix, es demana una lectura

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (data, status = 200, maxAge = 120) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
  });

const num = (v, def, min, max) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const TEAMS_RE = /^\d{1,7}-\d{1,7}(,\d{1,7}-\d{1,7}){0,9}$/;
export const parseTeams = (t) => (t && TEAMS_RE.test(t) ? [...new Set(t.split(','))].map((x) => x.split('-')) : null);

// deps: { db, dispatch(reason) => Promise, live: boolean }
export async function handle(req, deps) {
  const { db } = deps;
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  // Supabase passa el camí com /api/..., o /functions/v1/api/...
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';

  try {
    if (path === '/clubs') {
      let clubs = await db.select('clubs', 'select=id,name,town&order=name');
      if (!clubs.length && deps.live) {
        clubs = parseClubs(JSON.parse(await fetchFcbq('/clubs/ajax')));
        await db.upsert('clubs', clubs, 'id');
      }
      return json(clubs, 200, 3600);
    }

    let m = path.match(/^\/club\/(\d{1,7})$/);
    if (m) {
      const clubId = m[1];
      let teams = await db.select('teams', `select=id,name,category&club_id=eq.${clubId}&listed=eq.true&order=category,name`);
      if (!teams.length && deps.live) {
        try {
          teams = parseClub(await fetchFcbq(`/club/${clubId}`, 8000));
          await db.upsert('teams', teams.map((t) => ({ ...t, club_id: clubId, listed: true })), 'id');
        } catch {
          deps.dispatch && (await deps.dispatch('clubs').catch(() => {}));
          return json({ clubId, teams: [], pending: true }, 200, 0);
        }
      }
      return json({ clubId, teams }, 200, 3600);
    }

    if (path === '/teams' || path === '/cal.ics' || path === '/calendari.ics') {
      const list = parseTeams(url.searchParams.get('t'));
      if (!list) return json({ error: 'Paràmetre t invàlid' }, 400);
      const data = await loadTeams(list, deps);

      if (path === '/teams') return json(data, 200, data.some((d) => d.pending) ? 0 : 120);

      const matches = data.flatMap((d) => d.matches).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      const name = url.searchParams.get('n') || data.map((d) => d.team.name).join(' + ');
      const body = buildIcs(matches, {
        conv: num(url.searchParams.get('c'), 45, 0, 180),
        post: num(url.searchParams.get('p'), 30, 0, 120),
        dur: num(url.searchParams.get('d'), 90, 30, 180),
        alarm: num(url.searchParams.get('a'), 0, 0, 1440),
        name: `🏀 ${name}`.slice(0, 120),
        pending: data.filter((d) => d.pending).map((d) => ({ teamId: d.team.id, name: d.team.name })),
      });
      const headers = { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=900' };
      if (url.searchParams.get('dl')) headers['Content-Disposition'] = 'attachment; filename="partits.ics"';
      return new Response(body, { headers });
    }

    return json({ error: 'No trobat' }, 404);
  } catch (err) {
    // amb error, els calendaris subscrits conserven la versió anterior (millor que un calendari buit)
    return json({ error: 'Error temporal. Torna-ho a provar d\'aquí a una estona.', detail: String(err?.message || err) }, 503, 0);
  }
}

async function loadTeams(list, deps) {
  const { db } = deps;
  const ids = list.map(([, t]) => t);
  const [tracked, teams, rows] = await Promise.all([
    db.select('tracked', `select=team_id,scraped_at&team_id=${db.inList(ids)}`),
    db.select('teams', `select=id,name,category&id=${db.inList(ids)}`),
    db.select('matches', `select=*&team_id=${db.inList(ids)}&order=date,time`),
  ]);
  const scraped = new Map(tracked.map((r) => [r.team_id, r.scraped_at]));
  const info = new Map(teams.map((r) => [r.id, r]));

  // apunta els equips que algú fa servir, perquè el lector programat els mantingui al dia
  await db.upsert('tracked', list.map(([c, t]) => ({ team_id: t, club_id: c, requested_at: new Date().toISOString() })), 'team_id');

  let needDispatch = false;
  const out = [];
  for (const [clubId, teamId] of list) {
    let matches = rows.filter((r) => r.team_id === teamId).map(fromRow);
    let team = { id: teamId, clubId, name: info.get(teamId)?.name || `Equip ${teamId}`, category: info.get(teamId)?.category || '' };
    let pending = false;

    if (!scraped.get(teamId)) {
      // mai llegit: intent en directe
      let ok = false;
      if (deps.live) {
        try {
          const parsed = withUids(parseMatches(await fetchFcbq(teamCalendarPath(clubId, teamId), 8000)), teamId);
          const tn = teamNameFrom(parsed, teamId);
          await saveTeamMatches(deps.db, clubId, teamId, parsed, tn);
          matches = parsed;
          if (tn) team = { ...team, ...tn };
          ok = true;
        } catch {}
      }
      if (!ok) {
        pending = true;
        needDispatch = true;
      }
    } else if (Date.now() - new Date(scraped.get(teamId)).getTime() > STALE_MS) {
      needDispatch = true;
    }
    out.push({ team, matches, pending });
  }
  if (needDispatch && deps.dispatch) await deps.dispatch('matches').catch(() => {});
  return out;
}

// demana a GitHub Actions que executi el lector ara (token amb permís "Actions: write" al repositori)
export function makeDispatch(token, repo, workflow = 'scrape.yml') {
  if (!token || !repo) return null;
  return (mode) =>
    fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'partits-calendari' },
      body: JSON.stringify({ ref: 'main', inputs: { mode } }),
    });
}
