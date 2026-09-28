// Client mínim de la base de dades de Supabase (API REST), sense dependències.
// Funciona igual a Deno (funció de Supabase) i a Node (GitHub Actions).

export function makeDb(url, key) {
  const base = url.replace(/\/$/, '') + '/rest/v1/';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function call(method, path, body, extra = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;

  return {
    select: (table, query = '') => call('GET', `${table}?${query}`),
    upsert: (table, rows, onConflict) =>
      rows.length
        ? call('POST', `${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, rows, {
            Prefer: 'resolution=merge-duplicates,return=minimal',
          })
        : null,
    remove: (table, query) => call('DELETE', `${table}?${query}`, undefined, { Prefer: 'return=minimal' }),
    inList,
  };
}

// ---------------------------------------------------------------- operacions de l'app

const now = () => new Date().toISOString();

export const toRow = (m) => ({
  uid: m.uid,
  team_id: m.teamId,
  date: m.date,
  time: m.time,
  home_id: m.homeId,
  home: m.home,
  away_id: m.awayId,
  away: m.away,
  category: m.category,
  venue: m.venue,
  address: m.address,
  updated_at: now(),
});

export const fromRow = (r) => ({
  uid: r.uid,
  teamId: r.team_id,
  date: r.date,
  time: r.time,
  homeId: r.home_id,
  home: r.home,
  awayId: r.away_id,
  away: r.away,
  category: r.category,
  venue: r.venue,
  address: r.address,
});

// desa els partits llegits d'un equip i esborra els que ja no hi són
export async function saveTeamMatches(db, clubId, teamId, matches, info) {
  if (matches.length) {
    await db.upsert('matches', matches.map(toRow), 'uid');
    await db.remove('matches', `team_id=eq.${teamId}&uid=not.${db.inList(matches.map((m) => m.uid))}`);
  }
  if (info) await db.upsert('teams', [{ id: teamId, club_id: clubId, name: info.name, category: info.category, updated_at: now() }], 'id');
  await db.upsert('tracked', [{ team_id: teamId, club_id: clubId, scraped_at: now(), fail_count: 0 }], 'team_id');
}
