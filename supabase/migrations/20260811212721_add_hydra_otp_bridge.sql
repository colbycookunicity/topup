create table public.topup_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email like '%@unicity.com'),
  client_ip text not null,
  validation_id text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index topup_otp_challenges_email_created_idx
on public.topup_otp_challenges (email, created_at desc);

create index topup_otp_challenges_ip_created_idx
on public.topup_otp_challenges (client_ip, created_at desc);

alter table public.topup_otp_challenges enable row level security;
alter table public.topup_otp_challenges force row level security;

revoke all on table public.topup_otp_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.topup_otp_challenges to service_role;

comment on table public.topup_otp_challenges is
'Server-only, short-lived Hydra OTP challenges for the Top Up employee sign-in bridge.';
