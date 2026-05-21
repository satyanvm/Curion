create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.profile_atoms (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  semantic_path text not null,
  raw_value text not null,
  embedding_text text not null,
  embedding vector(768) not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists profile_atoms_user_path_uidx
  on public.profile_atoms (user_id, semantic_path);

create index if not exists profile_atoms_user_id_idx
  on public.profile_atoms using btree (user_id);

create index if not exists profile_atoms_embedding_hnsw_idx
  on public.profile_atoms using hnsw (embedding vector_cosine_ops);

create or replace function public.replace_profile_atoms(
  p_user_id text,
  p_atoms jsonb
)
returns table(inserted_or_updated_count bigint, pruned_count bigint)
language sql
security definer
set search_path = public
as $$
  with incoming as (
    select
      semantic_path,
      raw_value,
      embedding_text,
      (embedding::text)::vector(768) as embedding
    from jsonb_to_recordset(coalesce(p_atoms, '[]'::jsonb)) as atom(
      semantic_path text,
      raw_value text,
      embedding_text text,
      embedding jsonb
    )
  ),
  pruned as (
    delete from public.profile_atoms stored
    where stored.user_id = p_user_id
      and not exists (
        select 1
        from incoming
        where incoming.semantic_path = stored.semantic_path
      )
    returning 1
  ),
  upserted as (
    insert into public.profile_atoms (
      user_id,
      semantic_path,
      raw_value,
      embedding_text,
      embedding,
      updated_at
    )
    select
      p_user_id,
      semantic_path,
      raw_value,
      embedding_text,
      embedding,
      now()
    from incoming
    on conflict (user_id, semantic_path)
    do update set
      raw_value = excluded.raw_value,
      embedding_text = excluded.embedding_text,
      embedding = excluded.embedding,
      updated_at = now()
    returning 1
  )
  select
    (select count(*) from upserted) as inserted_or_updated_count,
    (select count(*) from pruned) as pruned_count;
$$;

create or replace function public.match_profile_atoms_batch(
  p_user_id text,
  p_queries jsonb,
  p_match_count int default 5,
  p_max_distance double precision default 0.42
)
returns table(
  query_index int,
  id uuid,
  semantic_path text,
  raw_value text,
  embedding_text text,
  distance double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with queries as (
    select
      (ordinality - 1)::int as query_index,
      (value::text)::vector(768) as embedding
    from jsonb_array_elements(coalesce(p_queries, '[]'::jsonb)) with ordinality
  )
  select
    queries.query_index,
    matched.id,
    matched.semantic_path,
    matched.raw_value,
    matched.embedding_text,
    matched.distance
  from queries
  cross join lateral (
    select
      atoms.id,
      atoms.semantic_path,
      atoms.raw_value,
      atoms.embedding_text,
      (atoms.embedding <=> queries.embedding)::double precision as distance
    from public.profile_atoms atoms
    where atoms.user_id = p_user_id
    order by atoms.embedding <=> queries.embedding
    limit greatest(1, least(coalesce(p_match_count, 5), 20))
  ) matched
  where matched.distance <= coalesce(p_max_distance, 0.42)
  order by queries.query_index, matched.distance;
$$;
