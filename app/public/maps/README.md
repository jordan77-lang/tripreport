# Offline map packs

TripReport ships optional **offline map packs** — downloadable regions any trip can use.

## Main Salmon River pack

**File:** `main-salmon-river.pmtiles`  
**URL after deploy:** `/maps/main-salmon-river.pmtiles`

The app pre-downloads all catalog packs in the background when online. Trips opt in via **New Trip → Offline map packs** or **Plan → Maps**.

### Generate the PMTiles file

1. Use [Protomaps Build](https://maps.protomaps.com/) or [Planetiler](https://github.com/onthegomap/planetiler) to build a vector extract for this bbox:
   - SW: 44.95, -116.55
   - NE: 46.05, -114.15
2. Export as `.pmtiles`
3. Place the file in this folder as `main-salmon-river.pmtiles`
4. Commit (if under ~100 MB) or upload to Netlify/Supabase Storage and update `pmtilesPath` in `src/lib/mapRegions.js`

Until the file exists, downloads will show an error — live Mapbox maps still work when online.

### Adding more regions

Add an entry to `OFFLINE_MAP_REGIONS` in `app/src/lib/mapRegions.js` and place the matching `.pmtiles` file here.
