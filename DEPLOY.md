# Going live: Supabase (accounts + database) and Vercel (website)

About 20 minutes, all in your browser. Both services are free for this size of project.
You'll end up with a public address (this project uses `https://color-fingerprint.fun`) where anyone
can create an account. Every push to `main` on GitHub redeploys the site automatically.

## 1. Create the Supabase project

1. Go to <https://supabase.com>, sign up (GitHub sign-in is easiest), then **New project**.
2. Name: `color-fingerprint`. Set a database password and save it in your password manager
   (the site never needs it). Region: **West US** (closest to Vancouver). Create the project.
3. When it's ready, open **SQL Editor → New query**, paste the whole of
   `supabase/migrations/001_accounts.sql` from this repo, and click **Run**. You should see "Success".
   This creates the `fingerprints` table, the privacy rules (each person sees only their own data)
   and the delete-my-account function. It's safe to run again.

## 2. Set up sign-in

In Supabase, **Authentication**:

1. **Sign In / Providers → Email**: leave Email enabled. **Turn off "Confirm email"** for now, then Save.
   Supabase's built-in email sender only delivers to your own team's addresses, two emails an hour,
   so with confirmation on, members of the public would never receive their link.
2. **URL Configuration**: you'll fill this in after step 3, once you know the Vercel address.

Later (before you share widely), add a real email service so "Forgot your password?" emails reach
people: **Authentication → Emails → SMTP Settings → Enable custom SMTP**, using a provider such as
Resend, Brevo or SendGrid (all have free tiers). Then you can turn "Confirm email" back on.

## 3. Copy the two keys

**Project Settings → API Keys** (and **Data API** for the URL). Copy:

- **Project URL**, like `https://abcdefghijkl.supabase.co`
- **Publishable key** (newer projects, starts with `sb_publishable_`) or the **anon public** key (older
  projects). This key is designed to be public; the privacy rules from step 1 are what protect data.

**Never** copy the `service_role` / secret key anywhere in this project.

## 4. Deploy on Vercel

1. Go to <https://vercel.com>, sign up with GitHub.
2. **Add New → Project → Import** `MMM1122/color_fingerprint`. If it isn't listed, click
   "Adjust GitHub App Permissions" and give Vercel access to that repo.
3. Framework preset: **Vite** (detected automatically). Leave build settings as they are.
4. **Environment Variables**, add both:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the publishable (or anon) key
5. **Deploy**. When it finishes, copy your address, e.g. `https://color-fingerprint.vercel.app`.

## 5. Tell Supabase your address

Back in Supabase, **Authentication → URL Configuration**:

- **Site URL**: your Vercel address.
- **Redirect URLs**: add `https://YOUR-ADDRESS.vercel.app/**` and `http://localhost:5173/**`.

## 6. Check it works

1. Open your Vercel address. "Sign in" should appear in the top right.
2. **Create an account**, take the test (or open a saved fingerprint file from Save and share).
3. Open the site in a private window or on your phone, sign in: your colors should be there.
4. In Supabase, **Table Editor → fingerprints** shows one row per account.

If "Sign in" doesn't appear, the two environment variables are missing or misspelled: fix them in
Vercel → Settings → Environment Variables, then **Deployments → Redeploy**.

## Local development with accounts

Copy `.env.example` to `.env.local`, fill in the same two values, then `npm run dev`.
Without `.env.local` the site runs without accounts, as before.

## What is stored, and privacy

- Stored per account: email, a password hash (handled by Supabase), and the fingerprint JSON:
  color answers, reaction times, scores. Never audio, microphone or camera data.
- Each person can read and change only their own row (row-level security). Checked by
  `npm run test:db`, which runs the real SQL in an in-memory Postgres.
- People can delete their account and all its data from the Account page.
- Using account data for a course or study needs research ethics approval and consent first
  (spec section 6). This setup does not collect data for research.

## Custom domain (how color-fingerprint.fun is set up)

1. **Vercel → Settings → Domains → Add Existing**: add `color-fingerprint.fun` (connected to Production),
   and `www.color-fingerprint.fun` as a **308 redirect** to `color-fingerprint.fun`.
2. **Cloudflare (where the domain is registered) → DNS → Records**: add the CNAME records Vercel shows,
   one for `@` and one for `www`, both pointing to the target Vercel gives you, with the proxy **off**
   ("DNS only").
3. **Supabase → Authentication → URL Configuration**: Site URL `https://color-fingerprint.fun`, and add
   `https://color-fingerprint.fun/**` to Redirect URLs. The vercel.app address keeps working too.
