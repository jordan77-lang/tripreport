# Supabase setup for TripReport

Follow these steps to enable accounts, trip sync, and invite codes before the July 20 Main Salmon launch.

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Name it `tripreport` (or similar), pick a region close to your users
3. Save the database password somewhere safe

## 2. Run the database migrations

1. In Supabase: **SQL Editor** → **New query**
2. Paste and run `app/supabase/migrations/001_initial_schema.sql`
3. Paste and run `app/supabase/migrations/002_trip_media_storage.sql`
4. Paste and run `app/supabase/migrations/003_fix_rls.sql`
5. Paste and run `app/supabase/migrations/004_upsert_trip_rpc.sql` (fixes trip cloud sync RLS errors)

Both files are **idempotent** (safe to run more than once). If a previous run failed halfway, run the full file again instead of starting over.

You should see tables: `profiles`, `trips`, `trip_members`, `trip_invites`, `media_objects`, `map_regions`, plus the Main Salmon seed row and a `trip-media` storage bucket.

### If you see “already exists” errors

That usually means an earlier run partially succeeded. Common messages:

| Error | Meaning |
|-------|---------|
| `relation "profiles" already exists` | Tables were created; re-run the updated `001` file (it uses `IF NOT EXISTS`) |
| `policy "…" for table "…" already exists` | Policies were created; re-run the updated `001` file (it drops policies first) |
| `duplicate key value violates unique constraint` on `map_regions` | Seed row already inserted; re-run the updated `001` file (uses `ON CONFLICT`) |

**Do not** drop your project unless you want to lose all data. Re-run the migration files from the repo.

### Verify setup

Run this in the SQL Editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'trips', 'trip_members', 'trip_invites', 'media_objects', 'map_regions')
order by table_name;
```

You should get 6 rows. Then check Storage → **trip-media** bucket exists.

## 3. Configure authentication

1. **Authentication** → **Providers**
2. Enable **Email**
3. For field use on the river, either:
   - **Disable “Confirm email”** (Settings → Auth → Email) so password sign-up works immediately on spotty service, **or**
   - Have everyone create accounts on Wi‑Fi before the trip

Optional: enable **Google** provider for faster sign-in on Android.

## 4. Add redirect URLs

**Authentication** → **URL configuration**

| Setting | Value |
|---------|--------|
| Site URL | Your Netlify URL, e.g. `https://your-site.netlify.app` |
| Redirect URLs | Same URL + `http://localhost:5173` for local dev |

## 5. Copy API keys to env

**Project Settings** → **API**

Add to `app/.env` (local) and **Netlify → Environment variables** (production):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your_anon_key
```

Keep the **service_role** key secret — never put it in the frontend.

## 6. Redeploy

```bash
cd app
npm run build
```

Push to GitHub (Netlify auto-deploys) or drag `dist` to Netlify Drop.

## 7. Test the flow

1. Open your deployed site → **Create account** (password while on Wi‑Fi)
2. Set your **display name**
3. **New Trip** → name it “Main Salmon July 2026”, start date **2026-07-20**
4. On Trip page → generate **invite code** (coming on Trip page; for now use SQL or Home join after we add invite UI to Trip)
5. Second phone: create account → **Join trip** → enter code

## 8. Trip photo storage (local-first sync)

Photos are stored on the device in **IndexedDB** for fast offline viewing. Supabase Storage is used **only** to upload and download blobs when syncing — the app never loads images from Supabase for display.

Migration `002_trip_media_storage.sql` is included in step 2 above. If you skipped it, run that file in the SQL Editor.

When signed in and online, pending photos upload automatically; crew photos download to your device in the background.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Supabase is not configured” | Add env vars and redeploy |
| Sign-up says check email | Disable email confirm in Supabase Auth settings |
| Can't create trip | Complete profile setup (display name) first |
| “new row violates row-level security” on **trips** | Run `004_upsert_trip_rpc.sql`, sign out/in, then **Cloud sync** |
| Other RLS errors on invites/storage | Run `003_fix_rls.sql` |
| Join code invalid | Run migration; check `trip_invites` table |
| Maps still need internet | PMTiles file not built yet — see `app/public/maps/README.md` |

## What's implemented now

- Email/password + magic link sign-in
- User profiles (display name)
- Trip cloud sync on create (`pushTripToCloud`)
- Join trip by invite code
- Main Salmon map region metadata in DB + local config
- Local-first photos (IndexedDB) with Supabase Storage upload/download sync

## Coming next

- Invite code button on Trip page + auto-sync on save
- PMTiles offline map for Main Salmon
- Background sync when connectivity returns
