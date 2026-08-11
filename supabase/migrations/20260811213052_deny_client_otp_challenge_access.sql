create policy "deny all client access to OTP challenges"
on public.topup_otp_challenges
for all
to anon, authenticated
using (false)
with check (false);
