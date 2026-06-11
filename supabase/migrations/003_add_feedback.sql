create table feedback (
  id bigint generated always as identity primary key,
  user_id text,
  email text default '',
  message text not null check (char_length(message) >= 5),
  status text not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  created_at timestamptz default now()
);

create index feedback_created_at_idx on feedback (created_at desc);

alter table feedback enable row level security;
