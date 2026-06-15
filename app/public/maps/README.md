# Offline map files

Place pre-generated PMTiles files here for offline river maps.

## Main Salmon River

Expected file: `main-salmon-river.pmtiles`

This will be served at `/maps/main-salmon-river.pmtiles` after deploy.

### How we'll generate it (next sprint)

1. Download OpenStreetMap vector data for the Main Salmon corridor (Corn Creek → Riggins).
2. Build a PMTiles archive with [Planetiler](https://github.com/onthegomap/planetiler) or similar.
3. Copy the `.pmtiles` file into this folder.
4. Commit or host on Supabase Storage / R2 if the file is large (>50 MB).

Until the file exists, the app uses live Mapbox tiles when online.
