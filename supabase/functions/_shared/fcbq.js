// Partits al Calendari — codi compartit (sense dependències).
// El fan servir la funció de Supabase (Deno) i el lector programat de GitHub Actions (Node).

export const FCBQ = 'https://www.basquetcatala.cat';
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// ---------------------------------------------------------------- utilitats

const p2 = (n) => String(n).padStart(2, '0');

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// HTML -> línies de text netes (respecta els <br>)
const lines = (html) =>
  decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const equipId = (html) => (html.match(/\/equip\/(\d+)/) || [])[1] || null;

export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- lectors FCBQ

// /partits/calendari_equip_global/{club}/{equip}
export function parseMatches(html) {
  const tbody = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [''])[0];
  const out = [];
  for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const td = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (td.length < 6) continue;
    const d = lines(td[0]).join(' ').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!d) continue;
    const t = lines(td[1]).join(' ').match(/(\d{1,2}):(\d{2})/);
    const venue = lines(td[5]);
    out.push({
      date: `${d[3]}-${d[2]}-${d[1]}`,
      time: t ? `${p2(t[1])}:${t[2]}` : null,
      homeId: equipId(td[2]),
      home: lines(td[2]).join(' '),
      awayId: equipId(td[3]),
      away: lines(td[3]).join(' '),
      category: lines(td[4]).join(' '),
      venue: venue[0] || '',
      address: venue.slice(1).join(', '),
    });
  }
  return out;
}

// /club/{id}  -> equips amb categoria
export function parseClub(html) {
  const teams = [];
  const blocks = html.split(/<div[^>]*class="table-responsive"[^>]*>/i).slice(1);
  for (const b of blocks) {
    const body = b.split(/<\/div>/i)[0];
    const category = lines(body.split(/<a[\s>]/i)[0]).join(' ').replace(/\|\s*$/, '').trim();
    for (const a of body.matchAll(/<a[^>]*href="[^"]*\/equip\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      teams.push({ id: a[1], name: lines(a[2]).join(' '), category });
    }
  }
  return teams;
}

// /clubs/ajax -> NOMÉS id, nom i població (la resposta original porta dades que no volem tocar)
export function parseClubs(json) {
  return (Array.isArray(json) ? json : [])
    .map((c) => ({ id: String(c.id), name: String(c.name || '').trim(), town: String(c.town || '').trim() }))
    .filter((c) => c.id && c.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'ca'));
}

// ---------------------------------------------------------------- calendari .ics

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// plegat de línies a 75 octets sense trencar caràcters UTF-8
const enc = new TextEncoder();
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // la continuació porta un espai davant
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// hora local "naïf" (Europe/Madrid) +/- minuts
function shift(date, time, min) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi + min));
}
const dt = (t) =>
  `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}T${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}00`;
const hm = (t) => `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
const stamp = (t) => t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export const mapsUrl = (m) =>
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${m.venue}, ${m.address}, Catalunya`);

// opts: { conv, post, dur, alarm, name }
export function buildIcs(matches, opts, now = new Date()) {
  const { conv = 45, post = 30, dur = 90, alarm = 0, name = 'Partits' } = opts;
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Partits al Calendari//CA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    'X-WR-CALDESC:Horaris oficials de la FCBQ. S\'actualitza automàticament.',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  const byTeam = new Map();
  for (const m of matches) {
    if (!byTeam.has(m.teamId)) byTeam.set(m.teamId, []);
    byTeam.get(m.teamId).push(m);
  }
  const all = [...byTeam].flatMap(([t, ms]) => (ms.every((m) => m.uid) ? ms : withUids(ms, t)));

  // equips encara no llegits: un avís de dia sencer que desapareix quan arriben els partits
  for (const p of opts.pending || []) {
    const today = new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    L.push(
      'BEGIN:VEVENT',
      `UID:pendent-${p.teamId}@partits-calendari`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${today}`,
      `SUMMARY:${esc(`⏳ Carregant els partits de ${p.name || 'l\'equip'}`)}`,
      `DESCRIPTION:${esc('Els partits apareixeran en aquest calendari en pocs minuts. No cal fer res.')}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }

  for (const m of all) {
    const uid = `${m.uid}@partits-calendari`;

    const home = m.homeId === m.teamId;
    const rival = home ? m.away : m.home;
    const place = [m.venue, m.address].filter(Boolean).join(', ');
    const summaryBase = `🏀 ${m.home} – ${m.away}`;

    L.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`);

    if (m.time && m.time !== '00:00') {
      const start = shift(m.date, m.time, -conv);
      const kick = shift(m.date, m.time, 0);
      const endGame = shift(m.date, m.time, dur);
      const end = shift(m.date, m.time, dur + post);
      const desc = [
        conv ? `📣 Convocatòria: ${hm(start)}` : null,
        `🏀 Partit: ${hm(kick)}`,
        post ? `🚿 Sortida aprox.: ${hm(end)} (fi partit ~${hm(endGame)})` : `⏱️ Fi aprox.: ${hm(endGame)}`,
        `${home ? '🏠 A casa' : '🚗 A fora'} contra ${rival}`,
        m.category ? `🏆 ${m.category}` : null,
        place ? `📍 ${place}` : null,
        place ? `🗺️ ${mapsUrl(m)}` : null,
        '',
        'Horari oficial FCBQ. Si canvia, aquest calendari s\'actualitza sol.',
      ].filter((x) => x !== null);
      L.push(
        `DTSTART;TZID=Europe/Madrid:${dt(start)}`,
        `DTEND;TZID=Europe/Madrid:${dt(end)}`,
        `SUMMARY:${esc(`${summaryBase} · ${hm(kick)}`)}`,
        `DESCRIPTION:${esc(desc.join('\n'))}`
      );
    } else {
      // hora encara no publicada: esdeveniment de dia sencer
      const [y, mo, d] = m.date.split('-');
      const next = new Date(Date.UTC(+y, +mo - 1, +d + 1));
      L.push(
        `DTSTART;VALUE=DATE:${y}${mo}${d}`,
        `DTEND;VALUE=DATE:${next.getUTCFullYear()}${p2(next.getUTCMonth() + 1)}${p2(next.getUTCDate())}`,
        `SUMMARY:${esc(`${summaryBase} · hora pendent`)}`,
        `DESCRIPTION:${esc(
          [`Hora pendent de publicar per la FCBQ.`, m.category ? `🏆 ${m.category}` : null, place ? `📍 ${place}` : null]
            .filter(Boolean)
            .join('\n')
        )}`,
        'TRANSP:TRANSPARENT'
      );
    }
    if (place) L.push(`LOCATION:${esc(place)}`);
    L.push(`URL:${FCBQ}/equip/${m.teamId}`);
    if (alarm > 0 && m.time && m.time !== '00:00') {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Convocatòria: ' + summaryBase)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}


// ---------------------------------------------------------------- lectura directa de la FCBQ

export async function fetchFcbq(path, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FCBQ + path, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'ca,es;q=0.8' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`FCBQ ${res.status} a ${path}`);
    const text = await res.text();
    // la protecció anti-robots torna una pàgina de repte en lloc del contingut
    if (/captcha|challenge|access denied/i.test(text.slice(0, 3000)) && !/basquetcatala/i.test(text.slice(0, 3000)))
      throw new Error(`FCBQ ha bloquejat la petició a ${path}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export const teamCalendarPath = (clubId, teamId) => `/partits/calendari_equip_global/${clubId}/${teamId}`;

// identificador estable d'un partit (no depèn de data ni hora: si s'ajorna, es mou)
export function withUids(matches, teamId) {
  const seen = new Map();
  return matches.map((m) => {
    let key = `${teamId}|${m.homeId}|${m.awayId}|${m.category}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) key += `|${n}`;
    return { ...m, teamId, uid: `${hash(key)}-${teamId}` };
  });
}

export function teamNameFrom(matches, teamId) {
  const m = matches.find((x) => x.homeId === teamId || x.awayId === teamId);
  return m ? { name: m.homeId === teamId ? m.home : m.away, category: m.category } : null;
}
