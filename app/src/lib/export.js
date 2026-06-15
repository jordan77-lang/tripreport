// Trip export: GPX track file and HTML trip report

export function exportGpx(trip) {
  const track = trip.track || [];
  const locations = trip.locations || [];
  const name = trip.name || 'Trip';

  const wpts = locations
    .filter((l) => l.lat != null && l.lng != null)
    .map((l) => {
      const time = l.observedAt ? `<time>${new Date(l.observedAt).toISOString()}</time>` : '';
      const desc = l.notes ? `<desc>${escXml(l.notes)}</desc>` : '';
      return `  <wpt lat="${l.lat}" lon="${l.lng}">\n    <name>${escXml(l.name || 'Location')}</name>${desc}${time}\n  </wpt>`;
    })
    .join('\n');

  const trkpts = track
    .map((p) => {
      const ele = p.alt != null ? `\n      <ele>${p.alt.toFixed(1)}</ele>` : '';
      const time = p.ts ? `\n      <time>${new Date(p.ts).toISOString()}</time>` : '';
      return `    <trkpt lat="${p.lat}" lon="${p.lng}">${ele}${time}\n    </trkpt>`;
    })
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TripReport"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escXml(name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}
  <trk>
    <name>${escXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

  triggerDownload(gpx, `${slugify(name)}.gpx`, 'application/gpx+xml');
}

export function exportHtmlReport(trip) {
  const entries = trip.entries || [];
  const locations = trip.locations || [];
  const track = trip.track || [];
  const name = trip.name || 'Trip';

  const typeBadges = (trip.types || [])
    .map((t) => `<span class="badge">${escHtml(t)}</span>`)
    .join(' ');

  const startDate = trip.startDate ? fmtDate(trip.startDate) : '—';
  const endDate = trip.endDate || trip.endedAt
    ? fmtDate(trip.endDate || new Date(trip.endedAt).toISOString().slice(0, 10))
    : '—';

  const stats = computeStats(trip);

  const locationRows = locations
    .map((l) => {
      const time = l.observedAt ? fmtDateTime(l.observedAt) : '—';
      const coord = l.lat != null ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}` : '—';
      const entryCount = entries.filter((e) => e.locationId === l.id).length;
      return `<tr><td>${escHtml(l.icon || '')} ${escHtml(l.name)}</td><td>${escHtml(l.type)}</td><td>${coord}</td><td>${time}</td><td>${entryCount}</td></tr>`;
    })
    .join('\n');

  const entryRows = [...entries]
    .sort((a, b) => new Date(a.observedAt || a.createdAt) - new Date(b.observedAt || b.createdAt))
    .map((e) => {
      const time = e.observedAt ? fmtDateTime(e.observedAt) : '—';
      const loc = locations.find((l) => l.id === e.locationId);
      const locName = loc?.name || e.locationName || '—';
      const detail = buildEntryDetail(e);
      return `<tr><td>${time}</td><td>${escHtml(e.type)}</td><td>${escHtml(e.title || e.type)}</td><td>${escHtml(locName)}</td><td>${escHtml(e.notes || '')}</td><td>${detail}</td></tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(name)} — TripReport</title>
<style>
  body { font-family: system-ui, sans-serif; background: #F5F4F0; color: #1A1917; margin: 0; padding: 24px; }
  h1 { font-size: 28px; font-weight: 800; color: #2C5F3E; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 700; color: #1A1917; margin: 24px 0 8px; border-bottom: 2px solid #E8E5E0; padding-bottom: 4px; }
  .meta { font-size: 13px; color: #6B6763; margin-bottom: 16px; }
  .badge { background: #EBF3ED; color: #2C5F3E; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; margin-right: 4px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 8px; }
  .stat { background: #fff; border: 1px solid #E8E5E0; border-radius: 10px; padding: 12px 14px; }
  .stat-val { font-size: 22px; font-weight: 800; color: #2C5F3E; }
  .stat-lbl { font-size: 11px; color: #6B6763; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); font-size: 12px; }
  th { background: #2C5F3E; color: white; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; }
  td { padding: 7px 10px; border-bottom: 1px solid #F0EDE8; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) { background: #FAFAF8; }
  .footer { margin-top: 32px; font-size: 11px; color: #A09D99; text-align: center; }
</style>
</head>
<body>
<h1>${escHtml(name)}</h1>
<div class="meta">
  ${typeBadges}
  <span style="margin-left:8px">${escHtml(trip.location || '')}</span>
  &nbsp;·&nbsp; ${startDate} → ${endDate}
</div>

<h2>Summary</h2>
<div class="stats">
  <div class="stat"><div class="stat-val">${stats.days}</div><div class="stat-lbl">Days</div></div>
  <div class="stat"><div class="stat-val">${entries.length}</div><div class="stat-lbl">Entries</div></div>
  <div class="stat"><div class="stat-val">${locations.length}</div><div class="stat-lbl">Locations</div></div>
  <div class="stat"><div class="stat-val">${track.length}</div><div class="stat-lbl">GPS Points</div></div>
  <div class="stat"><div class="stat-val">${stats.distanceMi} mi</div><div class="stat-lbl">Track Distance</div></div>
  ${stats.minTempC != null ? `<div class="stat"><div class="stat-val">${stats.minTempC}–${stats.maxTempC}°C</div><div class="stat-lbl">Temp Range</div></div>` : ''}
  ${stats.maxCfs != null ? `<div class="stat"><div class="stat-val">${stats.maxCfs} cfs</div><div class="stat-lbl">Peak Flow</div></div>` : ''}
</div>

<h2>Locations (${locations.length})</h2>
${locations.length ? `<table>
<thead><tr><th>Name</th><th>Type</th><th>Coordinates</th><th>Time</th><th>Entries</th></tr></thead>
<tbody>${locationRows}</tbody>
</table>` : '<p style="color:#A09D99;font-size:13px">No locations logged.</p>'}

<h2>Journal Entries (${entries.length})</h2>
${entries.length ? `<table>
<thead><tr><th>Time</th><th>Type</th><th>Title</th><th>Location</th><th>Notes</th><th>Data</th></tr></thead>
<tbody>${entryRows}</tbody>
</table>` : '<p style="color:#A09D99;font-size:13px">No entries logged.</p>'}

<div class="footer">Generated by TripReport · ${new Date().toLocaleString()}</div>
</body>
</html>`;

  triggerDownload(html, `${slugify(name)}-report.html`, 'text/html');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeStats(trip) {
  const entries = trip.entries || [];
  const track = trip.track || [];

  const start = trip.startDate ? new Date(trip.startDate) : null;
  const end = trip.endDate ? new Date(trip.endDate) : (trip.endedAt ? new Date(trip.endedAt) : null);
  const days = start && end ? Math.max(1, Math.round((end - start) / 864e5) + 1) : '—';

  let distanceM = 0;
  for (let i = 1; i < track.length; i++) {
    distanceM += haversineM(track[i - 1].lat, track[i - 1].lng, track[i].lat, track[i].lng);
  }
  const distanceMi = (distanceM / 1609.34).toFixed(1);

  const temps = entries.filter((e) => e.weatherTempC != null).map((e) => e.weatherTempC);
  const minTempC = temps.length ? Math.round(Math.min(...temps)) : null;
  const maxTempC = temps.length ? Math.round(Math.max(...temps)) : null;

  const flows = entries.filter((e) => e.cfs != null).map((e) => e.cfs);
  const maxCfs = flows.length ? Math.round(Math.max(...flows)) : null;

  return { days, distanceMi, minTempC, maxTempC, maxCfs };
}

function buildEntryDetail(e) {
  const parts = [];
  if (e.cfs != null) parts.push(`${Math.round(e.cfs)} cfs`);
  if (e.gaugeHt != null) parts.push(`${e.gaugeHt.toFixed(2)} ft`);
  if (e.weatherTempC != null) parts.push(`${Math.round(e.weatherTempC)}°C`);
  if (e.weatherSummary) parts.push(escHtml(e.weatherSummary));
  if (e.featureType) parts.push(escHtml(e.featureType));
  if (e.rapidClass) parts.push(`Class ${escHtml(e.rapidClass)}`);
  return parts.join(' · ');
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
