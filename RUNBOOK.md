# two-do — Build & Test Runbook

A shared planning calendar for two partners. Add personal plans (visible to both, so nobody double-books), propose shared plans for specific day + time slots that require the other's approval, and turn live puttingscene.com Bangalore events into proposable plans. Email alerts on proposals and approvals.

## Stack
- **Next.js (App Router) + TypeScript + Tailwind CSS** — UI + backend API routes in one app.
- **Supabase** — Postgres DB + Auth (email magic links) + Row Level Security.
- **react-big-calendar** + **date-fns** / **date-fns-tz** — calendar UI in Asia/Kolkata (IST).
- **Resend** — email notifications.
- **Vercel** — hosting.

## Conventions used in this runbook
- Project root: `/Users/paritoshchaudhary/myProjects/two-do`
- Run all commands from the project root unless stated otherwise.
- Replace the two partner emails wherever you see `EMAIL_A` and `EMAIL_B`.
- Each phase ends with a **Test** block. Don't move on until it passes.

---

## Phase 0 — Prerequisites & accounts

### Steps
1. Install Node.js LTS (v20+). Check:
   ```bash
   node -v && npm -v
   ```
   If missing, install via [nodejs.org](https://nodejs.org) or `brew install node`.
2. Confirm git + GitHub:
   ```bash
   git --version && git config user.email
   ```
3. Create free accounts (no setup beyond sign-up yet):
   - Supabase: https://supabase.com
   - Resend: https://resend.com
   - Vercel: https://vercel.com (sign in with GitHub)
4. Decide the two login emails (`EMAIL_A`, `EMAIL_B`).

### Test
- `node -v` prints v20+.
- You can log into all three dashboards.

---

## Phase 1 — Scaffold the Next.js app

### Steps
1. From `/Users/paritoshchaudhary/myProjects`, create the app **into the existing folder** (it already has a `.git`):
   ```bash
   cd /Users/paritoshchaudhary/myProjects
   npx create-next-app@latest two-do \
     --typescript --tailwind --eslint --app --src-dir \
     --import-alias "@/*" --use-npm
   ```
   If it warns the directory isn't empty (because of `.git`/`RUNBOOK.md`), choose to continue — it keeps existing files.
2. Start the dev server:
   ```bash
   cd two-do
   npm run dev
   ```
   Visit http://localhost:3000.
3. Install runtime deps:
   ```bash
   npm install @supabase/supabase-js @supabase/ssr \
     react-big-calendar date-fns date-fns-tz resend
   npm install -D @types/react-big-calendar
   ```
4. Create a `.env.local` (left empty for now) and ensure it's git-ignored:
   ```bash
   touch .env.local
   grep -q ".env.local" .gitignore || echo ".env.local" >> .gitignore
   ```
5. First commit + push to GitHub:
   ```bash
   git add -A
   git commit -m "Scaffold Next.js app for two-do"
   gh repo create two-do --private --source=. --push   # or create repo in GitHub UI and: git remote add origin <url> && git push -u origin main
   ```

### Test
- http://localhost:3000 shows the Next.js starter.
- Editing `src/app/page.tsx` hot-reloads.
- Repo visible on GitHub.

---

## Phase 2 — Supabase project, schema & RLS

### Steps
1. In Supabase dashboard: **New project** (region closest to India, e.g. Mumbai/Singapore). Save the DB password.
2. In **Project Settings -> API**, copy:
   - Project URL
   - `anon` public key
   - `service_role` key (server-only, secret)
3. Add to `.env.local`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   RESEND_API_KEY=            # filled in Phase 8
   APP_URL=http://localhost:3000
   PARTNER_EMAILS=EMAIL_A,EMAIL_B
   ```
4. In Supabase **SQL Editor**, run the schema:
   ```sql
   -- Allowed partners (gate sign-in to two emails)
   create table public.allowed_emails (
     email text primary key
   );
   insert into public.allowed_emails (email) values
     ('EMAIL_A'), ('EMAIL_B');

   -- Profile per partner
   create table public.profiles (
     id uuid primary key references auth.users(id) on delete cascade,
     email text not null,
     display_name text,
     color text default '#4f46e5',
     created_at timestamptz default now()
   );

   create type event_kind as enum ('personal','shared');
   create type event_status as enum ('confirmed','proposed','declined');

   create table public.events (
     id uuid primary key default gen_random_uuid(),
     owner_id uuid not null references public.profiles(id) on delete cascade,
     title text not null,
     note text,
     event_date date not null,
     start_time time not null,
     end_time time,
     kind event_kind not null,
     status event_status not null default 'confirmed',
     proposed_by uuid references public.profiles(id),
     approved_by uuid references public.profiles(id),
     source text not null default 'manual',     -- 'manual' | 'puttingscene'
     source_url text,
     source_event_id text,
     venue text,
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );

   create index events_date_idx on public.events (event_date);
   ```
5. Auto-create a profile on first login (trigger):
   ```sql
   create or replace function public.handle_new_user()
   returns trigger language plpgsql security definer as $$
   begin
     insert into public.profiles (id, email, display_name)
     values (new.id, new.email, split_part(new.email,'@',1))
     on conflict (id) do nothing;
     return new;
   end; $$;

   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function public.handle_new_user();
   ```
6. Enable **Row Level Security** and policies (both partners can read all; only edit your own; only the non-proposer can approve):
   ```sql
   alter table public.profiles enable row level security;
   alter table public.events  enable row level security;

   -- helper: is the current user an allowed partner?
   create or replace function public.is_partner()
   returns boolean language sql stable as $$
     select exists (
       select 1 from public.allowed_emails a
       where a.email = (auth.jwt() ->> 'email')
     );
   $$;

   -- profiles
   create policy "partners read profiles" on public.profiles
     for select using (public.is_partner());
   create policy "user updates own profile" on public.profiles
     for update using (id = auth.uid());

   -- events: read all (both partners share the calendar)
   create policy "partners read events" on public.events
     for select using (public.is_partner());
   -- insert: must be a partner and own the row
   create policy "partner inserts own events" on public.events
     for insert with check (public.is_partner() and owner_id = auth.uid());
   -- update: owner can edit personal; partner can approve/decline shared proposals they did NOT propose
   create policy "owner updates own events" on public.events
     for update using (owner_id = auth.uid());
   create policy "partner approves proposals" on public.events
     for update using (
       public.is_partner() and kind = 'shared'
       and status = 'proposed' and proposed_by <> auth.uid()
     );
   -- delete own
   create policy "owner deletes own events" on public.events
     for delete using (owner_id = auth.uid());
   ```
7. (Optional but recommended) Block sign-ins from non-partner emails: Supabase **Authentication -> Hooks -> Before user created**, add a Postgres function that raises if `event.email` not in `allowed_emails`. If you skip this, RLS still prevents unknown users from seeing/writing anything.

### Test
- Tables `allowed_emails`, `profiles`, `events` exist in **Table Editor**.
- Running `select public.is_partner();` while logged out returns false/null (expected).
- No SQL errors.

---

## Phase 3 — Auth (magic link) + app shell

### Steps
1. Supabase **Authentication -> Providers -> Email**: enable, turn ON "magic link". Under **URL Configuration**, set Site URL `http://localhost:3000` and add redirect `http://localhost:3000/auth/callback` (you'll add the prod URL in Phase 10).
2. Create Supabase clients:
   - `src/lib/supabase/client.ts` (browser):
     ```ts
     import { createBrowserClient } from '@supabase/ssr';
     export const createClient = () =>
       createBrowserClient(
         process.env.NEXT_PUBLIC_SUPABASE_URL!,
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
       );
     ```
   - `src/lib/supabase/server.ts` (server components / route handlers) using `createServerClient` from `@supabase/ssr` with Next `cookies()`.
3. Add `src/middleware.ts` to refresh the session and protect routes (redirect unauthenticated users to `/login`).
4. Build pages:
   - `src/app/login/page.tsx`: email input -> `supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: APP_URL + '/auth/callback' }})`.
   - `src/app/auth/callback/route.ts`: exchange code for session, redirect to `/`.
   - `src/app/page.tsx`: protected home (the calendar shell). Show logged-in partner's name + a logout button.

### Test
- Visiting `/` while logged out redirects to `/login`.
- Entering `EMAIL_A` sends a magic link; clicking it logs you in and lands on `/`.
- A row for `EMAIL_A` appears in `profiles`.
- Logging in with a non-partner email results in no data access (and an error if you added the hook in 2.7).

---

## Phase 4 — Calendar UI (read events, IST)

### Steps
1. Create a typed events module `src/lib/events.ts` (types + fetch helpers using the Supabase client).
2. Build `src/components/CalendarView.tsx` wrapping `react-big-calendar`:
   - Use the `date-fns` localizer.
   - Treat all dates/times as **Asia/Kolkata**; format with `date-fns-tz` (`formatInTimeZone`).
   - Views: Month + Week + Agenda (Agenda is the mobile-friendly list).
   - Color events by owner (`profiles.color`) and style `proposed` ones (dashed/translucent) differently from `confirmed`.
3. Load events in `src/app/page.tsx` (server component) for a date window, pass to `CalendarView`.
4. Import the library CSS once (e.g. in `src/app/globals.css` or layout): `react-big-calendar/lib/css/react-big-calendar.css`.

### Test
- Manually `insert` a couple of `confirmed` rows in Supabase; they render on the calendar at the correct IST date/time.
- Month/Week/Agenda toggles work; layout is usable on a narrow (mobile) viewport.

---

## Phase 5 — Personal plans (CRUD)

### Steps
1. "Add plan" button opens a modal/sheet `src/components/PlanForm.tsx`: title, optional note, date, start time, optional end time, and kind = **Personal**.
2. Submit via a server action or route handler `POST /api/events`:
   - Insert with `kind='personal'`, `status='confirmed'`, `owner_id = auth.uid()`, `source='manual'`.
3. Allow the owner to edit/delete their personal plans (`PATCH`/`DELETE /api/events/[id]`). RLS already restricts to owner.
4. Refresh the calendar after mutations (revalidate or refetch).

### Test
- As `EMAIL_A`, add a personal plan -> appears immediately in A's color.
- Log in as `EMAIL_B` -> you can **see** A's personal plan but the edit/delete controls are hidden/disabled, and a direct `DELETE` is rejected by RLS.
- Edit and delete your own personal plan works.

---

## Phase 6 — Propose / approve shared plans

### Steps
1. In `PlanForm`, add kind = **Shared (propose)**. On submit insert `kind='shared'`, `status='proposed'`, `proposed_by = auth.uid()`, `owner_id = auth.uid()`.
2. Build a **Proposals inbox** `src/components/Proposals.tsx` listing `status='proposed'` rows, separating "Waiting on me" (`proposed_by <> me`) from "Awaiting partner" (`proposed_by = me`).
3. Approve: `PATCH /api/events/[id]` setting `status='confirmed'`, `approved_by = auth.uid()`. (RLS policy "partner approves proposals" allows only the non-proposer.)
4. Decline: set `status='declined'` (only the non-proposer).
5. On the calendar, render `proposed` events with a distinct style and an Approve/Decline affordance for the partner.

### Test
- A proposes a shared plan -> shows under "Awaiting partner" for A, and "Waiting on me" for B.
- B approves -> it becomes `confirmed` and shows on the shared calendar for both.
- A (the proposer) attempting to approve their own proposal is rejected by RLS.
- Decline path sets `declined` and removes it from the active calendar.

---

## Phase 7 — Clash detection

### Steps
1. Add `src/lib/clash.ts`: given a candidate `{date, start_time, end_time}`, query existing events on that date for **either** partner and compute time-overlap (treat missing `end_time` as a default duration, e.g. 1h).
2. Call it when:
   - Submitting a new plan/proposal (warn before save).
   - Viewing a "Waiting on me" proposal (show a "conflicts with X" badge).
3. Surface conflicts as a non-blocking warning (user can proceed knowingly).

### Test
- Create a personal plan 7–9pm; then propose a shared plan 8–10pm same day -> a clash warning appears citing the conflicting plan.
- Non-overlapping times show no warning.
- Conflicts against the partner's plans are detected too.

---

## Phase 8 — Email notifications (Resend)

### Steps
1. In Resend: create an API key; for testing you can send from `onboarding@resend.dev`. (For a custom domain later, verify it in Resend.) Put `RESEND_API_KEY` in `.env.local`.
2. Create `src/lib/email.ts` with a `sendEmail({to, subject, html})` using the Resend SDK.
3. Trigger emails from server code (use the service-role client server-side to look up the partner's email):
   - On **new proposal** -> email the other partner: "New plan proposed: <title> on <date> <time>" + link to `APP_URL`.
   - On **approval** -> email the proposer: "<partner> approved <title>".
4. Keep sends server-side only (never expose `RESEND_API_KEY` to the browser).

### Test
- Proposing a plan sends an email to the partner within a few seconds (check inbox/spam).
- Approving sends an email to the proposer.
- Emails contain a working link back to the app.

---

## Phase 9 — puttingscene.com suggestions

> The public API (no key needed) is:
> `GET https://api.puttingscene.com/api/v1/events/events/`
> with params `approval_status=approved&is_private=false&ordering=event_date&page_size=50`.
> - **Single day** (today / tomorrow): add `event_date=<YYYY-MM-DD>` and `publish_date__lte=<that date>`.
> - **Range** (this weekend): add `event_date__gte=<sat>&event_date__lte=<sun>`.
> Response fields per item: `title`, `short_description`, `event_date`, `start_time`, `end_time`, `venue`, plus a numeric `id` (use for `source_event_id`).

### Steps
1. Add `src/lib/dates.ts`: compute today, tomorrow, and the upcoming Sat/Sun in **Asia/Kolkata**.
2. Create a cached server route `GET /api/suggestions?when=today|tomorrow|weekend`:
   - Build the puttingscene URL with the right date params, `fetch` it server-side.
   - Cache briefly, e.g. `fetch(url, { next: { revalidate: 1800 } })` (30 min).
   - Normalize each event to `{ title, note: short_description, date: event_date, start_time, end_time, venue, source_url, source_event_id }`. Build `source_url` like `https://puttingscene.com` + event path (confirm the public event URL pattern; otherwise link to the homepage section).
3. Build `src/components/Suggestions.tsx` with tabs **Today / Tomorrow / This Weekend** rendering cards. Each card has **Propose this** which opens `PlanForm` prefilled (kind = Shared, `source='puttingscene'`, plus `source_url`/`source_event_id`).

### Test
- `curl "https://api.puttingscene.com/api/v1/events/events/?approval_status=approved&is_private=false&ordering=event_date&page_size=5&event_date=$(date +%F)"` returns JSON with results.
- Each tab lists real upcoming events for the right dates (IST).
- "Propose this" creates a shared proposal carrying the event's title/time/venue/link, and the normal approve flow (Phase 6) + email (Phase 8) works.

---

## Phase 10 — Deploy to Vercel

### Steps
1. Push latest to GitHub.
2. In Vercel: **New Project** -> import the `two-do` repo. Framework auto-detects Next.js.
3. Add **Environment Variables** (Production + Preview): all keys from `.env.local`, but set `APP_URL` to the Vercel URL (e.g. `https://two-do.vercel.app`).
4. Deploy.
5. Update Supabase **Auth -> URL Configuration**: Site URL = Vercel URL; add redirect `https://<your-vercel-url>/auth/callback`.
6. (Optional) Add a custom domain in Vercel and update `APP_URL` + Supabase redirect accordingly.

### Test (production smoke test)
- Both `EMAIL_A` and `EMAIL_B` can magic-link login on the live URL.
- Add personal plan, propose shared plan, approve, see it on the shared calendar.
- Proposal/approval emails arrive.
- Suggestions tabs load live puttingscene events and can be proposed.
- Open on a phone browser — layout is usable.

---

## Post-launch ideas (optional, later)
- Push notifications (PWA / web push) in addition to email.
- Recurring personal plans.
- A "free time" finder that suggests open slots for the weekend.
- Filter suggestions by category/price from the puttingscene API.

## Quick reference — env vars
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY     # server only
RESEND_API_KEY                # server only
APP_URL
PARTNER_EMAILS
```
