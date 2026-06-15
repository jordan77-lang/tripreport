# TripReport MVP Blueprint

## Goal
Build an offline-first collaborative camping and river trip app where users can:
- Start a trip, invite participants, and predownload maps.
- Capture entries (text, voice, video, campsite, rapid, wildlife, food, gauge snapshots) with auto time and location.
- Track trip path live and continue fully offline.
- Sync later without data loss.
- Replay and share trip story with participant filters.

## Product Spine
1. Create trip.
2. Capture and track in the field.
3. Sync and merge participant contributions.
4. Replay and share story.

Success metric for MVP: a group can complete a 2-day trip mostly offline and publish a clean replay without losing entries.

## Current App Mapping
Existing screens and modules:
- App navigation shell: src/App.jsx
- Home dashboard: src/screens/Home.jsx
- New trip setup (basic): src/screens/NewTrip.jsx
- Live map and GPS tracking: src/screens/Navigator.jsx
- Journal and quick capture: src/screens/FieldJournal.jsx
- Entry creation form: src/screens/EntryForm.jsx
- River gauge intel: src/screens/RiverIntel.jsx
- Local data layer: src/lib/storage.js
- USGS service: src/lib/usgs.js

## Target Screen Blueprint
### 1) New Trip Flow
Use current NewTrip screen as foundation and split into 3 steps.

Step 1: Trip Basics
- Trip name
- Trip types
- Planned date range
- Open-ended toggle

Step 2: Team and Permissions
- Invite by username, phone, or share link
- Roles: owner, contributor, viewer
- Privacy: private, followers, public

Step 3: Offline Prep
- Select map regions to download
- Show download size estimate
- Start trip CTA

Implementation target files:
- Extend src/screens/NewTrip.jsx
- Add src/components/InviteList.jsx
- Add src/components/OfflineMapPlanner.jsx

### 2) Active Trip Dashboard
Use Home as "mission control" while trip is active.
- Active trip card
- Sync status chip
- Quick capture shortcuts
- Today timeline preview
- Team activity indicator

Implementation target files:
- Extend src/screens/Home.jsx
- Add src/components/SyncChip.jsx
- Add src/components/TodayTimelinePreview.jsx

### 3) Navigator (Map + Track)
Keep current Navigator flow and add:
- Tracking controls: pause, resume, end day
- Pin-drop mode for manual place logging
- Day filter and participant filter
- Offline map coverage warning ribbon

Implementation target files:
- Extend src/screens/Navigator.jsx
- Extend src/components/TripMap.jsx
- Add src/components/TrackControls.jsx

### 4) Journal Capture and Entries
Keep current FieldJournal + EntryForm and standardize entry structure.
- One-tap capture from quick actions
- Auto capture timestamp and coordinates
- Attach media queue (photo/video/voice)
- Optional enrich fields (rating, rapid class, notes)

Implementation target files:
- Extend src/screens/FieldJournal.jsx
- Extend src/screens/EntryForm.jsx
- Add src/components/MediaAttachBar.jsx

### 5) Replay and Share Viewer
New screen family after active capture MVP is stable.
- Day chapter cards
- Animated path playback
- Entry cards synced to playback position
- Participant filter chips
- Share link controls

Implementation target files:
- Add src/screens/ReplayViewer.jsx
- Add src/components/ReplayTimeline.jsx
- Add src/components/ParticipantFilterChips.jsx

## Domain Model (MVP)
Required entities and fields.

Trip:
- id
- name
- types
- privacy
- startDate
- endDate
- status (draft, active, paused, completed, archived)
- ownerId
- collaboratorIds
- createdAt
- updatedAt
- syncState

Participant:
- id
- tripId
- userId
- role (owner, contributor, viewer)
- invitedAt
- joinedAt
- status (invited, active, removed)

Entry:
- id
- tripId
- authorId
- type (campsite, rapid, gauge, wildlife, food, note, voice, video)
- title
- notes
- mediaIds
- lat
- lng
- ts
- metadata (type-specific json)
- createdAt
- updatedAt
- syncState

TrackPoint:
- id
- tripId
- authorId
- lat
- lng
- alt
- accuracy
- ts
- createdAt
- syncState

GaugeSnapshot:
- id
- tripId
- entryId (optional)
- gaugeId
- cfs
- gaugeHt
- fetchedAt
- source (usgs)

SyncEvent:
- id
- entityType
- entityId
- op (create, update, delete)
- payload
- ts
- retryCount
- state (pending, inflight, failed, done)

## Trip Lifecycle State Machine
States:
- draft
- active
- paused
- completed
- archived

Transitions:
- draft -> active (start recording)
- active -> paused (pause tracking)
- paused -> active (resume)
- active -> completed (finish trip)
- completed -> archived (hide from active views)
- archived -> active (reopen)

Guard rules:
- Cannot complete without at least one entry or trackpoint.
- Only owner can archive or reopen.

## Offline-First Architecture
### Local-first write path
1. User action writes to local DB immediately.
2. UI updates instantly from local query.
3. SyncEvent queued for background upload.

### Sync engine behavior
1. Runs on connectivity regained and periodic timer.
2. Sends events in order by ts per entity.
3. Retries with exponential backoff.
4. Marks local records with syncState.

### Conflict policy (MVP)
- New entries and media: append only.
- Mutable metadata: last-write-wins by updatedAt.
- Trip settings and permissions: owner wins, conflicts flagged in activity feed.

### Storage and media
- Start with IndexedDB for structured entities and queue.
- Store media blobs in IndexedDB or filesystem abstraction per platform.
- Persist thumbnails for timeline performance.

## Data Layer Refactor Plan
Current localStorage layer in src/lib/storage.js should be abstracted behind repositories.

Create:
- src/lib/db/client.js
- src/lib/db/tripRepo.js
- src/lib/db/entryRepo.js
- src/lib/db/trackRepo.js
- src/lib/sync/syncQueue.js
- src/lib/sync/syncWorker.js

Keep existing API surface temporarily:
- createTrip
- addEntry
- appendTrackPoint
- getActiveTrip

Then migrate callers incrementally.

## UX Rules for Field Reliability
- Never block save on network.
- Always show save confirmation with local or synced indicator.
- Auto attach time and location when available.
- Allow manual correction for location and timestamp.
- Keep primary actions reachable in one thumb zone.

## Engineering Backlog (2-Week Sprints)
### Sprint 1: Foundation
- Add normalized data models and repository interfaces.
- Replace direct localStorage writes with repository adapter.
- Add syncState to trip, entry, trackpoint.
- Add app-wide sync status context.

Definition of done:
- Existing screens still function.
- Entries and trackpoints include sync metadata.

### Sprint 2: New Trip 3-Step Flow
- Expand NewTrip to 3-step wizard.
- Add invite list UI and role model.
- Add offline map planner mock state.
- Save draft trip before launch.

Definition of done:
- User can create a trip with participants and planned map regions.

### Sprint 3: Capture Reliability
- Add media attach queue in EntryForm.
- Add pin-drop and tag-now parity for all relevant entry types.
- Add quick capture speed path in FieldJournal.
- Add participant attribution on entries.

Definition of done:
- User can create all entry types offline in under 10 seconds.

### Sprint 4: Sync Engine MVP
- Implement SyncEvent queue.
- Implement connectivity listener and retry worker.
- Add sync chips on Home and Journal entries.
- Add conflict banner for trip settings collisions.

Definition of done:
- Offline-created entries sync after reconnect with visible status.

### Sprint 5: Replay Viewer Alpha
- Implement day chapter timeline.
- Animate map track by day and playback time.
- Bind entry cards to playback cursor.
- Add participant filters.

Definition of done:
- A completed trip can be replayed start-to-finish.

### Sprint 6: Share + Hardening
- Public/follower/private replay modes.
- Share link generation and permissions gate.
- Media optimization and preload strategy.
- Edge-case QA (no GPS, no network, long trips).

Definition of done:
- Replay can be shared externally with privacy controls.

## Non-Functional Requirements
- Cold start to capture action under 2 seconds on mid-range Android.
- Entry save acknowledgement under 300 ms local.
- No data loss after process kill.
- Battery-aware tracking with adjustable GPS interval.

## Instrumentation (MVP)
Track events:
- trip_created
- invite_sent
- entry_created_local
- entry_synced
- sync_conflict
- replay_opened
- replay_shared

Use this to validate the product spine and reliability goals.

## Immediate Next Build Tasks (This Week)
1. Add syncState to Trip and Entry in src/lib/storage.js.
2. Add SyncChip component and surface it on Home and FieldJournal entries.
3. Expand NewTrip from 2 steps to 3 steps with invite placeholders.
4. Add participantId to entries from current user context placeholder.
5. Add replay route shell screen with mock timeline data.
