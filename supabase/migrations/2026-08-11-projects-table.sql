create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table projects enable row level security;

create policy "own projects" on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
