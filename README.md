# Top Up

Top Up is an employee-only Unicity Americas workspace for coordinating new-distributor outreach, rank opportunities, PCM follow-up, monthly CSV imports, and team activity.

## Features

- Six-digit employee OTP delivery through Unicity Hydra, bridged into Supabase Auth sessions
- Row-level security for employee and administrator access
- Real distributor profiles imported from monthly CSV files
- New Distributor, rank opportunity, and PCM work queues
- Ownership, contact activity, team coverage, and CSV export tools
- Administrator-only import history and data import controls

No distributor, employee, seed, placeholder, or demo records are stored in this repository. Production data remains in the secured Supabase project.

## Local setup

Requirements:

- Node.js 22.13 or newer
- A Supabase project

1. Install dependencies with `npm ci`.
2. Apply the SQL migration in `supabase/migrations/` to your Supabase project.
3. Deploy the `topup-otp` function in `supabase/functions/` without gateway JWT verification; the function performs the pre-login Hydra verification itself.
4. Create `.env.local` with:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

5. If using OpenAI Sites, copy `.openai/hosting.example.json` to `.openai/hosting.json` and replace the placeholder project identifier.
6. Start the app with `npm run dev`.

## Validation

- `npm run lint`
- `npm test`
- `npm run validate:artifact`

## Data integrity

CSV imports require a distributor ID and name. Existing distributor IDs are updated without deleting activity or ownership records, and category flags are merged so one distributor can appear in multiple opportunity views without creating duplicate profiles.
