# TripReport

Offline-first collaborative trip logging PWA — GPS tracking, field journal, planning, and shared expenses.

## Local development

```bash
cd app
cp .env.example .env   # add your Mapbox + USGS keys
npm install
npm run dev
```

Open http://127.0.0.1:5173 in your browser (run the dev server yourself; do not rely on IDE-embedded browsers for Mapbox).

From the repo root you can also run `npm run dev`, `npm run build`, and `npm run kill-dev`.

## Deploy (Netlify)

1. Connect this repo at [Netlify](https://app.netlify.com).
2. Build settings are in `netlify.toml` (base: `app`, publish: `dist`).
3. Add environment variables in Netlify → Site settings → Environment variables:
   - `VITE_MAPBOX_TOKEN`
   - `VITE_USGS_KEY` (optional)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (trip recap AI)
   - `RESEND_API_KEY`, `REPORT_EMAIL_FROM` (optional — email report)

See [app/docs/supabase-setup.md](app/docs/supabase-setup.md) for Supabase project setup.
See [app/docs/recap-setup.md](app/docs/recap-setup.md) for AI report and email setup.

Push to `main` to trigger a deploy.

## Field test on Android

Install from your Netlify URL in Chrome → Add to Home screen. Signed-in crew members sync automatically when connected. Open **Trip details → Sync & offline sharing** to exchange updates without cloud access.

## Capture and usability checks

The trip navigation provides Trips, Map, Log, Journal, and Plan. Log opens Photo, Note, Voice, and Expense capture; a saved location is optional. The journal groups observations by day and filters by Everyone, Mine, or Photos.

Run from `app`:

- `npm run test:capture` — local save, event context, audio persistence, and invitation parsing checks.
- `npm run test:ui` — server-rendered navigation and capture smoke checks; no dev server or account needed.
- `npm run build` — production bundle.

For cloud audio sharing, apply `app/supabase/migrations/008_trip_audio_storage.sql` after the earlier migrations. Recording requires a browser with MediaRecorder and microphone permission; Add Audio remains available for existing recordings. Clips are limited to 5 minutes when recorded in-app and 25 MB when attached.

## Collaborative sync (version 2)

Apply migrations through **010_saved_meals.sql** in Supabase before using cloud sync with this version. Migration 008 enables audio; 009 adds atomic change-history merging and attachment checksums. Migration 010 shares saved meals and ingredients with every signed-in user. This repository does not apply database migrations automatically. The new client reports a missing migration and keeps local changes pending; it never falls back to overwriting the cloud trip. Once a trip uses version 2, its database trigger rejects payload writes from older clients. Upgrade every participant's app.

On each phone, sign in and join the same trip while connected. Open the installed production app at least once and preload the maps needed for the trip. A previously authenticated identity and profile remain available locally when offline; this cache does not authorize cloud requests. Explicit sign-out removes the active identity cache. Browser data removal also removes offline access and local work. The Vite development server deliberately does not install a service worker; test offline restarts against a production build served on localhost or HTTPS.

In **Trip details → Sync & offline sharing**:

1. Choose whether to include photos and voice recordings, then **Prepare a sharing file**.
2. Use **Share file** (where the browser supports file sharing) or **Download file**, then transfer using the phone's available sharing or file-transfer tools. Preparing and sharing are separate actions so the share sheet opens from a direct tap.
3. The other participant opens the matching trip, selects **Import a trip file**, reviews the preview, and chooses **Merge into this trip**. Joining a different trip or granting membership through a package is not supported.
4. Review conflicting versions and possible duplicate places. Deleted records can be restored; restore their parent location/event first. Repeated imports are safe. A pre-import checkpoint is downloadable for recovery, and attachment writes are additive. Importing a checkpoint does not undo later edits automatically. Use **Restore checkpoint contents** to make compensating edits that restore the earlier contents, or restore individual deleted records. Restoring the full checkpoint removes later additions from the shared timeline after an explicit confirmation.
5. Reconnect and open the app to sync. Get a final update from every participant before generating the report; “synced” only describes changes this device knows about.

The immutable field history is shared by packages and cloud sync. Concurrent independent fields and attachment additions merge; different edits to the same field remain reviewable. Deletions persist, and resolving a conflict records a new edit rather than erasing earlier versions. Author IDs in transferred files are attribution supplied by participants, not cryptographic proof of authorship. Supabase checks the submitting account's actual trip role. Upload acknowledgements apply only to returned change IDs, including when more edits arrive during a request.

Packages are JSON with base64 attachments, SHA-256 checksums, and a **100 MB limit**. Changes-only exports explicitly list omitted attachments; larger photo collections currently need cloud sync or separate smaller trips. Byte integrity is checked before import; a conflicting attachment ID never replaces the original. Legacy embedded images are preserved, but older reference-only packages cannot recover bytes they never contained.

The journal and report use a shared trip-time-zone timeline containing locations, events, and entries. Repeated visits remain separate events; explicit event selection links contributions. GPS legs stay within each recording session and contributor. Distance is the sum of recorded sessions, so overlapping participants' tracks can count the same route more than once. Reports flag newer contributions and unresolved work; audio is preserved as an attachment, not automatically transcribed.

### Validation and current limits

Run from app: npm run test:sync, npm run test:capture, npm run test:ui, and npm run build. Automated checks cover three-device convergence, repeated imports, concurrent photos/notes, deletion recovery, stale forms, upload races, checksum failures, failed import saves, and package size/identity validation. Cloud-client tests use a simulated server; apply migration 009 to a staging Supabase project and test actual two-phone reconnection and role enforcement before a field deployment.

Trip documents and change history still use localStorage; media uses IndexedDB. History is not compacted and the cloud currently exchanges the full history (maximum 150,000 changes and 50 MB per request). This is a correctness foundation, not yet a proven capacity solution for weeks of high-frequency GPS recording. Browser quota may be reached earlier. Saving then fails visibly without replacing the previous trip; keep transferred backups. IndexedDB trip storage, paginated incremental cloud delivery, history compaction, and resumable multi-file media packages remain follow-up work for long expeditions. Background sync requires the app to be open or resumed; the browser is not guaranteed to run it while closed.

## Route recording

Open an active trip and use the persistent **Start recording** bar. The app requests location only when recording or when you choose **Locate me** / a current-location capture. **Pause** preserves the session; **Resume** begins a fresh segment. **Finish** turns recording off immediately and offers an optional leg name and destination. Starting another trip's recording requires finishing the current session first; navigating to another trip does not redirect GPS points. A route leg appears in the shared timeline, and participant/device/session/segment IDs keep routes separate when merged.

“Recording” appears only after a point is saved. The bar shows distance, elapsed session time (including pauses), accuracy, and last saved time. Fixes older than 30 seconds, uncertainty above 60 metres, implausible jumps above 70 m/s, and small stationary movements are filtered. Gaps longer than a minute begin new segments. These initial thresholds need outdoor testing across hiking, paddling, and driving; displayed GPS elevation remains approximate. The configured save interval throttles writes, not the GPS hardware's sampling rate.

The browser build suspends its watcher when hidden and starts a fresh segment on return. It does not promise screen-locked background recording. Native Android/iOS projects now live in app/android and app/ios and use Capacitor 7 with the community background-geolocation plugin. The native provider requests required location access, and Android notification permission, before starting its foreground location service. Pause/Finish remove the native watcher. Service-worker registration is disabled in the native wrapper. Native recording is not guaranteed after the OS terminates or force-stops the app.

From app, run **npm run native:sync** to build and copy the web app into both native projects. **npm run native:android** opens Android Studio; **npm run native:ios** opens Xcode on a Mac. Android needs its SDK and Java; iOS needs Xcode and CocoaPods. Configure signing and build on those platforms. Generated platform sources and permission descriptions are included, but phone binaries and locked-screen reliability have not been verified in this Windows workspace. Native password login uses the existing Supabase configuration; magic-link/deep-link return URLs and hosted report-function URLs need configuration before distributing native builds.

Run **npm run test:gps** for recorder and storage lifecycle checks. Before field use, test on actual Android and iPhone devices: start with permission denied then granted; record with the screen locked for 20 minutes; pause and finish while offline; reopen after interruption; verify no points after Finish; check that pause/signal gaps do not draw connecting legs; transfer the route to another phone. Long-trip storage limits described above still apply.

Native setup follows the [background-location plugin documentation](https://github.com/capacitor-community/background-geolocation) and [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).
