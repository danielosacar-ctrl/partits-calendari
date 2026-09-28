// Base de dades falsa en memòria que entén les consultes que fa l'app (subconjunt de PostgREST)
export function fakeDb() {
  const T = { clubs: [], teams: [], matches: [], tracked: [] };
  const PK = { clubs: 'id', teams: 'id', matches: 'uid', tracked: 'team_id' };
  const list = (v) => v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
  const filt = (rows, q) => {
    const p = new URLSearchParams(q);
    for (const [k, v] of p) {
      if (['select', 'order'].includes(k)) continue;
      rows = rows.filter((r) => {
        const x = r[k];
        if (v.startsWith('eq.')) return String(x) === v.slice(3);
        if (v.startsWith('gte.')) return x >= v.slice(4);
        if (v.startsWith('in.')) return list(v.slice(3)).includes(String(x));
        if (v.startsWith('not.in.')) return !list(v.slice(7)).includes(String(x));
        throw new Error('filtre desconegut ' + v);
      });
    }
    return rows;
  };
  const db = {
    T,
    inList: (ids) => `in.(${ids.map((x) => `"${x}"`).join(',')})`,
    async select(t, q = '') { return structuredClone(filt(T[t], q)); },
    async upsert(t, rows) {
      for (const r of rows) {
        const i = T[t].findIndex((x) => x[PK[t]] === r[PK[t]]);
        if (i >= 0) Object.assign(T[t][i], r);
        else T[t].push({ ...(t === 'teams' ? { listed: false } : {}), ...(t === 'tracked' ? { fail_count: 0, scraped_at: null } : {}), ...r });
      }
    },
    async remove(t, q) { const del = new Set(filt(T[t], q)); T[t] = T[t].filter((r) => !del.has(r)); },
  };
  return db;
}
