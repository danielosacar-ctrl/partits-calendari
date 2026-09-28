// Funció "api" de Supabase: web i calendaris subscrivibles.
// Es publica SENSE verificació de JWT (supabase/config.toml) perquè Google/Apple/Outlook
// han de poder llegir el calendari sense clau.
import { handle, makeDispatch } from '../_shared/api.js';
import { makeDb } from '../_shared/db.js';

const db = makeDb(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const rawDispatch = makeDispatch(Deno.env.get('GH_TOKEN'), Deno.env.get('GH_REPO'));

// com a molt una petició a GitHub cada 10 minuts per tipus
const last: Record<string, number> = {};
const dispatch = rawDispatch
  ? async (mode: string) => {
      if (Date.now() - (last[mode] || 0) < 10 * 60e3) return;
      last[mode] = Date.now();
      await rawDispatch(mode);
    }
  : null;

// LIVE_FETCH=false si la FCBQ bloqueja els servidors de Supabase (només es farà servir GitHub)
const live = Deno.env.get('LIVE_FETCH') !== 'false';

Deno.serve((req) => handle(req, { db, dispatch, live }));
