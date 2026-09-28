-- Partits al Calendari — taules (enganxa-ho al SQL Editor de Supabase i prem Run)

create table if not exists clubs (
  id text primary key,
  name text not null,
  town text,
  updated_at timestamptz default now()
);

create table if not exists teams (
  id text primary key,
  club_id text not null,
  name text not null,
  category text,
  listed boolean not null default false,   -- surt a la pàgina del club (per al cercador)
  updated_at timestamptz default now()
);
create index if not exists teams_club on teams (club_id);

create table if not exists matches (
  uid text primary key,
  team_id text not null,
  date date not null,
  time text,
  home_id text, home text,
  away_id text, away text,
  category text,
  venue text, address text,
  updated_at timestamptz default now()
);
create index if not exists matches_team on matches (team_id, date);

-- equips que fan servir les famílies (el lector programat només llegeix aquests)
create table if not exists tracked (
  team_id text primary key,
  club_id text not null,
  requested_at timestamptz default now(),
  scraped_at timestamptz,
  fail_count int not null default 0
);

-- Tot l'accés passa per la funció "api" amb la clau de servei: ningú hi pot accedir directament.
alter table clubs enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table tracked enable row level security;
