import { useMemo, useState } from 'react';
import { tripDayKey, tripTimeZone } from '../lib/tripTimeline';
import { Ic } from '../components/Ic';
import { PhotoGrid, PhotoSlideshow } from '../components/PhotoSlideshow';
import { ReportGenerateModal } from '../components/ReportGenerateModal';
import { TripMap } from '../components/TripMap';
import { MediaThumb } from '../components/MediaThumb';
import { AudioAttachment } from '../components/AudioAttachment';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { addTripMemory, forkTripAsTemplate, getCurrentUserId, getTrip, isTripMember, saveTrip } from '../lib/storage';
import { resolveUserDisplayName } from '../lib/tripParticipants';
import { shareEntity } from '../lib/share';
import { buildTripManifest, manifestContentHash } from '../lib/tripManifest';
import { collectTripPhotos, listTripDays, preparePhotosForApi } from '../lib/tripPhotos';
import { narrativeFromReportResult } from '../lib/recapSettings';
import { weaveChronologicalPhotoPlaceholders, ensurePhotoPlaceholders, hasPhotoPlaceholders } from '../lib/recapNarrative';
import { generateTripReport, emailTripReport } from '../lib/recapApi';
import { RECAP_EMAIL_ENABLED } from '../lib/recapSettings';
import { downloadTripReportDocx, encodeDocxForEmailTransport, buildTripReportDocx } from '../lib/recapDocx';
import { ReportNarrativeEditor } from '../components/ReportNarrativeEditor';

export function TripRecap({ trip: tripProp, onBack, onTripUpdate, onForkedTrip, initialTab = 'report', auth }) {
  const trip = tripProp?.id ? (getTrip(tripProp.id) || tripProp) : tripProp;
  const currentUserId = getCurrentUserId();
  const canContributeMemory = Boolean(trip && isTripMember(trip, currentUserId));
  const [tab, setTab] = useState(initialTab || 'report');
  const [photoScope, setPhotoScope] = useState('trip');
  const [photoDay, setPhotoDay] = useState(null);
  const [slideshowIndex, setSlideshowIndex] = useState(null);
  const [narrative, setNarrative] = useState(trip?.recap?.narrativeText || '');
  const [memoryText, setMemoryText] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [status, setStatus] = useState(null);

  const days = useMemo(() => listTripDays(trip), [trip]);
  const photos = useMemo(() => {
    if (photoScope === 'day' && photoDay) {
      return collectTripPhotos(trip, { scope: 'day', day: photoDay });
    }
    return collectTripPhotos(trip, { scope: 'trip' });
  }, [trip, photoScope, photoDay]);

  if (!trip) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontFamily: F }}>
        No trip selected
      </div>
    );
  }

  if (trip.status !== 'completed') {
    return (
      <div style={{ height: '100%', background: T.bg, fontFamily: F, padding: 20 }}>
        <button type="button" onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', marginBottom: 12 }}>
          <Ic d="M19 12H5 M12 5l-7 7 7 7" size={20} color={T.text} sw={2} />
        </button>
        <div style={{ fontSize: ts(16), fontWeight: 700, color: T.text }}>Recap is available after you finish the trip.</div>
      </div>
    );
  }

  function saveNarrative(nextText) {
    const nextRecap = {
      ...(trip.recap || {}),
      narrativeText: nextText,
      updatedAt: Date.now(),
    };
    saveTrip({ ...trip, recap: nextRecap, syncState: 'pending' });
    onTripUpdate?.();
  }

  function insertPhotoPlaceholders() {
    const woven = weaveChronologicalPhotoPlaceholders(trip, narrative);
    setNarrative(woven);
    saveNarrative(woven);
    setStatus({ kind: 'success', message: 'Photo placeholders inserted in chronological order.' });
  }

  async function handleGenerate(settings) {
    setGenerating(true);
    setStatus(null);
    try {
      const manifest = buildTripManifest(trip);
      const photosForApi = await preparePhotosForApi(trip, settings);
      const result = await generateTripReport({ manifest, settings, photos: photosForApi });
      const text = weaveChronologicalPhotoPlaceholders(trip, narrativeFromReportResult(result));
      setNarrative(text);
      const hash = manifestContentHash(manifest);
      saveTrip({
        ...trip,
        recap: {
          ...(trip.recap || {}),
          narrativeText: text,
          reportResult: result,
          settings,
          manifestHash: hash,
          generatedAt: Date.now(),
          updatedAt: Date.now(),
        },
        syncState: 'pending',
      });
      onTripUpdate?.();
      setShowGenerate(false);
      setTab('report');
      setStatus({ kind: 'success', message: 'Draft ready — edit below, then download or email.' });
    } catch (e) {
      setStatus({ kind: 'error', message: e?.message || 'Could not generate report.' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadDocx() {
    if (!narrative.trim()) {
      setStatus({ kind: 'error', message: 'Write or generate a report first.' });
      return;
    }
    setExporting(true);
    try {
      saveNarrative(narrative);
      const exportText = ensurePhotoPlaceholders(trip, narrative);
      await downloadTripReportDocx(trip, exportText);
      setStatus({ kind: 'success', message: 'Word document downloaded. Open on your PC or upload to Google Drive.' });
    } catch (e) {
      setStatus({ kind: 'error', message: e?.message || 'Download failed.' });
    } finally {
      setExporting(false);
    }
  }

  async function handleEmailDocx() {
    const to = auth?.user?.email;
    if (!to) {
      setStatus({ kind: 'error', message: 'Sign in with an email address to use Email to me.' });
      return;
    }
    if (!narrative.trim()) {
      setStatus({ kind: 'error', message: 'Write or generate a report first.' });
      return;
    }
    setEmailing(true);
    setStatus(null);
    try {
      saveNarrative(narrative);
      const exportText = ensurePhotoPlaceholders(trip, narrative);
      const blob = await buildTripReportDocx(trip, exportText, { forEmail: true });
      const { docxBase64, encoding } = await encodeDocxForEmailTransport(blob);
      const fileName = `${(trip.name || 'trip').replace(/[^a-z0-9]+/gi, '-')}-report.docx`;
      await emailTripReport({ to, tripName: trip.name, docxBase64, encoding, fileName });
      setStatus({ kind: 'success', message: `Report emailed to ${to}. Open the attachment on your PC to edit in Word or Google Docs.` });
    } catch (e) {
      setStatus({ kind: 'error', message: e?.message || 'Email failed. Try Download instead.' });
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0, boxShadow: '0 2px 12px rgba(26, 25, 23, 0.03)' }}>
        <div className="screen-header-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onBack}
            style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: ts(20), fontWeight: 800, color: T.text, letterSpacing: -.3 }}>Trip Recap</div>
            <div style={{ fontSize: ts(13), color: T.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => {
                const storyUrl = typeof window !== 'undefined'
                  ? `${window.location.origin}${window.location.pathname}?story=${encodeURIComponent(trip.id)}`
                  : '';
                void shareEntity({
                  title: `${trip.name} — Adventure Story`,
                  text: `Relive ${trip.name}${trip.location ? ` (${trip.location})` : ''}${storyUrl ? `\n${storyUrl}` : ''}`,
                  url: storyUrl || undefined,
                });
              }}
              style={{
                minHeight: 36, padding: '0 10px', borderRadius: 9,
                border: `1px solid ${T.border}`, background: T.bg,
                color: '#2A5C8E', fontSize: ts(12), fontWeight: 800,
                cursor: 'pointer', fontFamily: F,
              }}
            >
              Share Story
            </button>
            <button
              type="button"
              onClick={() => {
                const forked = forkTripAsTemplate(trip.id);
                if (forked) {
                  onTripUpdate?.();
                  onForkedTrip?.(forked.id);
                  setStatus({ kind: 'success', message: `Created new planning trip "${forked.name}" from this adventure's locations & meals.` });
                }
              }}
              style={{
                minHeight: 36, padding: '0 10px', borderRadius: 9,
                border: '1px solid #A4CFAD', background: '#E5F4E8',
                color: '#2E6D3A', fontSize: ts(12), fontWeight: 800,
                cursor: 'pointer', fontFamily: F,
              }}
            >
              Use for New Trip
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 4 }}>
          {[
            { id: 'story', label: 'Story' },
            { id: 'photos', label: `Photos (${photos.length})` },
            { id: 'report', label: 'Report' },
          ].map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{ flex: 1, border: 'none', borderRadius: 9, padding: '10px 12px', fontSize: ts(14), fontWeight: tab === t.id ? 800 : 600, fontFamily: F, cursor: 'pointer', background: tab === t.id ? T.card : 'transparent', color: tab === t.id ? T.text : T.textSub, boxShadow: tab === t.id ? '0 1px 4px rgba(26, 25, 23, 0.06)' : 'none' }}>
              {t.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div className="screen-content-inner">
        <p style={{fontSize:13}}>Report uses the shared timeline in {tripTimeZone(trip)}. Ask every participant to sync or send their final file before publishing.</p>
        {(trip._sync?.conflicts?.length > 0 || trip.syncState === 'pending' || trip._sync?.mediaPending > 0) && <p role="status">This report is a draft: some changes, attachments, or conflicts still need review in Sync &amp; offline sharing.</p>}
        {trip.recap?.manifestHash && trip.recap.manifestHash !== manifestContentHash(buildTripManifest(trip)) && <p role="status">The trip has changed since this report was generated. Regenerate the draft to include the latest contributions.</p>}
        {!!status && (
          <div style={{
            background: status.kind === 'error' ? '#FFF0F0' : '#E8F2EA',
            border: `1px solid ${status.kind === 'error' ? '#E7B5B5' : '#A8CFB2'}`,
            borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: ts(13), fontWeight: 600,
            color: status.kind === 'error' ? '#8A1414' : '#2E6D3A',
          }}>
            {status.message}
          </div>
        )}

        {tab === 'story' && (
          <TripStoryView
            trip={trip}
            currentUserId={currentUserId}
            canContributeMemory={canContributeMemory}
            memoryText={memoryText}
            onMemoryTextChange={setMemoryText}
            onAddMemory={() => {
              if (!memoryText.trim()) return;
              addTripMemory(trip.id, memoryText);
              setMemoryText('');
              onTripUpdate?.();
            }}
          />
        )}

        {tab === 'photos' && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <ScopeChip active={photoScope === 'trip'} onClick={() => { setPhotoScope('trip'); setPhotoDay(null); }} label="Whole trip" />
              {days.map((d) => (
                <ScopeChip key={d} active={photoScope === 'day' && photoDay === d}
                  onClick={() => { setPhotoScope('day'); setPhotoDay(d); }}
                  label={formatDayLabel(d)} />
              ))}
            </div>
            {photos.length > 0 && (
              <button type="button" onClick={() => setSlideshowIndex(0)}
                style={{ width: '100%', border: 'none', borderRadius: 10, padding: '11px', marginBottom: 12, fontSize: ts(14), fontWeight: 800, color: 'white', background: T.accent, cursor: 'pointer' }}>
                Play slideshow
              </button>
            )}
            <PhotoGrid photos={photos} onPhotoClick={setSlideshowIndex} />
          </>
        )}

        {tab === 'report' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button type="button" onClick={() => setShowGenerate(true)}
                style={{ flex: 1, minWidth: 140, border: 'none', borderRadius: 10, padding: '11px 12px', fontSize: ts(14), fontWeight: 800, color: 'white', background: '#2A5C8E', cursor: 'pointer' }}>
                {narrative ? 'Regenerate draft' : 'Generate with AI'}
              </button>
              <button type="button" onClick={() => void handleDownloadDocx()} disabled={exporting}
                style={{ flex: 1, minWidth: 120, border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 12px', fontSize: ts(14), fontWeight: 700, background: T.card, color: T.text, cursor: 'pointer' }}>
                {exporting ? '…' : 'Download .docx'}
              </button>
              {RECAP_EMAIL_ENABLED && (
                <button type="button" onClick={() => void handleEmailDocx()} disabled={emailing}
                  style={{ flex: 1, minWidth: 120, border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 12px', fontSize: ts(14), fontWeight: 700, background: T.card, color: T.text, cursor: 'pointer' }}>
                  {emailing ? 'Sending…' : 'Email to me'}
                </button>
              )}
            </div>

            <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 8, lineHeight: 1.45 }}>
              Edit the text blocks below. Photo placeholders show where images appear in the Word download, in the order they were taken.
            </div>

            {narrative.trim() && !hasPhotoPlaceholders(narrative) && collectTripPhotos(trip).length > 0 && (
              <button type="button" onClick={insertPhotoPlaceholders}
                style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10, fontSize: ts(13), fontWeight: 700, background: T.card, color: T.text, cursor: 'pointer' }}>
                Insert photo placeholders in timeline
              </button>
            )}

            <ReportNarrativeEditor
              value={narrative}
              onChange={setNarrative}
              onBlurSave={() => { if (narrative !== trip.recap?.narrativeText) saveNarrative(narrative); }}
              trip={trip}
            />

            {trip.recap?.generatedAt && (
              <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 8 }}>
                Last AI draft: {new Date(trip.recap.generatedAt).toLocaleString()}
              </div>
            )}

            <CrewMemoriesWall
              trip={trip}
              currentUserId={currentUserId}
              canContribute={canContributeMemory}
              memoryText={memoryText}
              onMemoryTextChange={setMemoryText}
              onAddMemory={() => {
                if (!memoryText.trim()) return;
                addTripMemory(trip.id, memoryText);
                setMemoryText('');
                onTripUpdate?.();
              }}
            />
          </>
        )}
        </div>
      </div>

      <ReportGenerateModal open={showGenerate} onClose={() => !generating && setShowGenerate(false)} onGenerate={handleGenerate} busy={generating} />

      {slideshowIndex !== null && (
        <PhotoSlideshow photos={photos} startIndex={slideshowIndex} onClose={() => setSlideshowIndex(null)} />
      )}
    </div>
  );
}

function TripStoryView({
  trip,
  currentUserId,
  canContributeMemory,
  memoryText,
  onMemoryTextChange,
  onAddMemory,
}) {
  const tz = tripTimeZone(trip);
  const locations = trip.locations || [];
  const entries = trip.entries || [];
  const events = trip.events || [];
  const track = trip.track || [];

  const mapEntries = useMemo(
    () => locations.filter((l) => l.lat != null && l.lng != null).map((l) => ({
      id: l.id,
      lng: l.lng,
      lat: l.lat,
      title: l.name,
      symbol: l.icon || '📍',
      col: '#2A5C8E',
    })),
    [locations],
  );

  const highlights = useMemo(() => {
    const items = [];
    for (const ev of events) {
      const reactCount = Object.values(ev.reactions || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      if (ev.highlighted || reactCount > 0) {
        items.push({
          id: `ev-${ev.id}`,
          title: ev.name || ev.type,
          place: ev.locationName || '',
          author: resolveUserDisplayName(trip, ev.createdBy, currentUserId),
          notes: ev.notes || '',
          highlighted: Boolean(ev.highlighted),
          reactions: ev.reactions || {},
        });
      }
    }
    for (const en of entries) {
      const reactCount = Object.values(en.reactions || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      if (en.highlighted || reactCount > 0) {
        items.push({
          id: `en-${en.id}`,
          title: en.title || en.type,
          place: en.locationName || '',
          author: resolveUserDisplayName(trip, en.authorId, currentUserId),
          notes: en.notes || '',
          highlighted: Boolean(en.highlighted),
          reactions: en.reactions || {},
        });
      }
    }
    return items;
  }, [events, entries, trip, currentUserId]);

  const chaptersByDay = useMemo(() => {
    const byDay = new Map();
    const sortedEntries = [...entries].sort((a, b) => {
      const ta = new Date(a.observedAt || a.createdAt || 0).getTime() || 0;
      const tb = new Date(b.observedAt || b.createdAt || 0).getTime() || 0;
      return ta - tb;
    });
    for (const entry of sortedEntries) {
      const key = tripDayKey(entry.observedAt || entry.createdAt, tz) || 'Trip';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(entry);
    }
    return [...byDay.entries()];
  }, [entries, tz]);

  return (
    <div>
      {(mapEntries.length > 0 || track.length > 0) && (
        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
            Route &amp; Anchored Locations ({locations.length})
          </div>
          <div style={{ borderRadius: 10, overflow: 'hidden', height: 200 }}>
            <TripMap
              style="outdoors-v12"
              track={track}
              entries={mapEntries}
              center={mapEntries[0] ? { lng: mapEntries[0].lng, lat: mapEntries[0].lat } : undefined}
              zoom={11}
              interactive
              showHoverPopup
            />
          </div>
        </div>
      )}

      {highlights.length > 0 && (
        <div style={{ background: '#FBF0E4', borderRadius: 12, border: '1px solid #E8C9A0', padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#7A4A14', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
            ⭐ Crew Highlights ({highlights.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {highlights.map((h) => (
              <div key={h.id} style={{ background: T.card, borderRadius: 10, padding: '10px 12px', border: '1px solid #E8C9A0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{h.title}</span>
                  {h.place && <span style={{ fontSize: 11, color: T.textSub }}>· {h.place}</span>}
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2A5C8E', marginLeft: 'auto' }}>{h.author}</span>
                </div>
                {h.notes && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: T.textSub, lineHeight: 1.5 }}>&ldquo;{h.notes}&rdquo;</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {trip.recap?.narrativeText && (
        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 15px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.accent, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
            The Story
          </div>
          <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {trip.recap.narrativeText}
          </div>
        </div>
      )}

      {chaptersByDay.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
            Day-by-Day Perspectives
          </div>
          {chaptersByDay.map(([day, dayEntries]) => (
            <div key={day} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#2A5C8E', marginBottom: 8 }}>
                {day === 'Trip' ? 'Trip Moments' : formatDayLabel(day)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dayEntries.map((en) => {
                  const author = resolveUserDisplayName(trip, en.authorId, currentUserId) || 'Crew';
                  return (
                    <div key={en.id} style={{ borderLeft: `3px solid ${T.accent}`, paddingLeft: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{en.title || en.type}</span>
                        {en.locationName && <span style={{ fontSize: 11, color: T.textSub }}>@ {en.locationName}</span>}
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#2A5C8E', marginLeft: 'auto' }}>— {author}</span>
                      </div>
                      {en.notes && (
                        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: T.textSub, lineHeight: 1.5 }}>
                          &ldquo;{en.notes}&rdquo;
                        </p>
                      )}
                      {(en.photoFiles || []).length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {en.photoFiles.slice(0, 4).map((pf, idx) => (
                            <MediaThumb
                              key={pf.id || idx}
                              media={pf}
                              alt={pf.caption || en.title || 'Photo'}
                              style={{ width: 68, height: 68, borderRadius: 8, objectFit: 'cover' }}
                            />
                          ))}
                        </div>
                      )}
                      {(en.voiceFiles || []).length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                          {en.voiceFiles.map((vf, idx) => (
                            <AudioAttachment key={vf.id || idx} media={vf} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <CrewMemoriesWall
        trip={trip}
        currentUserId={currentUserId}
        canContribute={canContributeMemory}
        memoryText={memoryText}
        onMemoryTextChange={onMemoryTextChange}
        onAddMemory={onAddMemory}
      />
    </div>
  );
}

function CrewMemoriesWall({ trip, currentUserId, canContribute, memoryText, onMemoryTextChange, onAddMemory }) {
  const memories = Array.isArray(trip?.recap?.memories) ? trip.recap.memories : [];
  return (
    <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '13px 14px', marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
        Crew Memories &amp; Reflections ({memories.length})
      </div>
      {memories.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.textFaint, marginBottom: canContribute ? 10 : 0 }}>
          What stood out most from this trip? Add your favorite memory or reflection for the crew.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: canContribute ? 10 : 0 }}>
          {memories.map((m) => (
            <div key={m.id || m.createdAt} style={{ background: T.bg, borderRadius: 10, padding: '9px 11px', border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#2A5C8E' }}>
                {m.authorName || resolveUserDisplayName(trip, m.authorId, currentUserId) || 'Crew'}
              </div>
              <div style={{ fontSize: 13, color: T.text, marginTop: 3, lineHeight: 1.45 }}>&ldquo;{m.text}&rdquo;</div>
            </div>
          ))}
        </div>
      )}
      {canContribute && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={memoryText}
            onChange={(e) => onMemoryTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && memoryText.trim()) onAddMemory();
            }}
            placeholder="Share a favorite memory from the trip…"
            style={{
              flex: 1, minWidth: 0, border: `1px solid ${T.border}`, borderRadius: 9,
              padding: '8px 10px', fontSize: 13, fontFamily: F, background: T.bg, outline: 'none',
            }}
          />
          <button
            type="button"
            disabled={!memoryText.trim()}
            onClick={onAddMemory}
            style={{
              minHeight: 36, padding: '0 14px', borderRadius: 9, border: 'none',
              background: memoryText.trim() ? '#2A5C8E' : '#7A9BB8',
              color: 'white', fontWeight: 800, fontSize: 12.5, cursor: memoryText.trim() ? 'pointer' : 'default', fontFamily: F,
            }}
          >
            Add memory
          </button>
        </div>
      )}
    </div>
  );
}

function ScopeChip({ active, onClick, label }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        border: `1px solid ${active ? T.accent : T.border}`,
        borderRadius: 20, padding: '6px 11px', fontSize: ts(12), fontWeight: 700, cursor: 'pointer',
        background: active ? T.accentLight : T.card, color: active ? T.accent : T.textSub,
      }}>
      {label}
    </button>
  );
}

function formatDayLabel(isoDay) {
  try {
    return new Date(`${isoDay}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return isoDay;
  }
}
