-- ============================================================
-- SCHÉMA COMPLET — VEILLE EMPLOI COMMAND CENTER
-- À exécuter dans Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) STATUTS DE VEILLE (offres marquées depuis la recherche)
create table if not exists job_status (
  offer_id    text primary key,
  statut      text not null,
  offer_data  jsonb,
  notes       text default '',
  updated_at  timestamptz default now()
);

-- 2) PIPELINE (candidatures suivies)
create table if not exists pipeline (
  id              uuid primary key default gen_random_uuid(),
  entreprise      text not null,
  poste           text,
  ville           text,
  secteur         text,
  source          text,
  lien_offre      text,
  statut          text default 'Envoyé',
  niveau_envie    int default 3,
  contact         text,
  date_envoi      date default current_date,
  date_relance    date,
  date_reponse    date,
  notes           text default '',
  created_at      timestamptz default now()
);

-- 3) ENTREPRISES RÊVE (target list)
create table if not exists entreprises_reve (
  id            uuid primary key default gen_random_uuid(),
  entreprise    text not null,
  secteur       text,
  priorite      text default 'Moyenne',
  ville         text,
  statut        text default 'À explorer',
  source_info   text,
  pourquoi      text,
  notes         text default '',
  created_at    timestamptz default now()
);

-- 4) RÉSEAU (contacts)
create table if not exists reseau (
  id              uuid primary key default gen_random_uuid(),
  nom             text,
  prenom          text,
  entreprise      text,
  poste           text,
  lien_linkedin   text,
  statut          text default 'À contacter',
  dernier_contact date,
  notes           text default '',
  created_at      timestamptz default now()
);

-- 5) ENTRETIENS
create table if not exists entretiens (
  id              uuid primary key default gen_random_uuid(),
  entreprise      text not null,
  poste           text,
  date_entretien  date,
  personnes       text,
  type_entretien  text,
  questions       text,
  points_forts    text,
  notes           text default '',
  created_at      timestamptz default now()
);

-- ============================================================
-- Row Level Security : accès complet via clé anon (usage perso)
-- ============================================================
alter table job_status        enable row level security;
alter table pipeline          enable row level security;
alter table entreprises_reve  enable row level security;
alter table reseau            enable row level security;
alter table entretiens        enable row level security;

create policy "anon_all_job_status"       on job_status       for all using (true) with check (true);
create policy "anon_all_pipeline"         on pipeline         for all using (true) with check (true);
create policy "anon_all_entreprises_reve" on entreprises_reve for all using (true) with check (true);
create policy "anon_all_reseau"           on reseau           for all using (true) with check (true);
create policy "anon_all_entretiens"       on entretiens       for all using (true) with check (true);

-- ============================================================
-- DONNÉES INITIALES : tes entreprises rêve déjà identifiées
-- ============================================================
insert into entreprises_reve (entreprise, secteur, priorite, ville, statut, source_info, pourquoi) values
  ('Michelin', 'Automobile', 'Haute', 'Clermont-Ferrand', 'À explorer', 'Site carrière + recherche perso', 'Top tier QVT, R&D, mer/montagne'),
  ('Stellantis', 'Automobile', 'Haute', 'Marseille / Sochaux', 'À explorer', 'Site carrière Workday', 'Multi-sites, possibilité côte méditerranéenne'),
  ('Beneteau Group', 'Nautisme', 'Haute', 'Vendée (St-Gilles-Croix-de-Vie)', 'À explorer', 'Site carrière + LinkedIn', 'Leader mondial du nautisme, lien avec passion voile'),
  ('Airbus Helicopters', 'Aéronautique', 'Haute', 'Marignane', 'À explorer', 'Site carrière', 'Côte Méditerranée + aéronautique = combo idéal')
on conflict do nothing;
