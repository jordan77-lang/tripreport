import { useMemo, useState } from 'react';
import { Ic } from '../components/Ic';
import { PhotoGrid, PhotoSlideshow } from '../components/PhotoSlideshow';
import { ReportGenerateModal } from '../components/ReportGenerateModal';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { getTrip, saveTrip } from '../lib/storage';
import { buildTripManifest, manifestContentHash } from '../lib/tripManifest';
import { collectTripPhotos, listTripDays, preparePhotosForApi } from '../lib/tripPhotos';
import { narrativeFromReportResult } from '../lib/recapSettings';
import { weaveChronologicalPhotoPlaceholders, ensurePhotoPlaceholders, hasPhotoPlaceholders } from '../lib/recapNarrative';
import { generateTripReport, emailTripReport } from '../lib/recapApi';
import { RECAP_EMAIL_ENABLED } from '../lib/recapSettings';
import { downloadTripReportDocx, docxBlobToBase64, buildTripReportDocx } from '../lib/recapDocx';
import { ReportNarrativeEditor } from '../components/ReportNarrativeEditor';

export function TripRecap({ trip: tripProp, onBack, onTripUpdate, auth }) {
  const trip = tripProp?.id ? (getTrip(tripProp.id) || tripProp) : tripProp;
  const [tab, setTab] = useState('report');
  const [photoScope, setPhotoScope] = useState('trip');
  const [photoDay, setPhotoDay] = useState(null);
  const [slideshowIndex, setSlideshowIndex] = useState(null);
  const [narrative, setNarrative] = useState(trip?.recap?.narrativeText || '');
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
      const blob = await buildTripReportDocx(trip, exportText);
      const docxBase64 = await docxBlobToBase64(blob);
      const fileName = `${(trip.name || 'trip').replace(/[^a-z0-9]+/gi, '-')}-report.docx`;
      await emailTripReport({ to, tripName: trip.name, docxBase64, fileName });
      setStatus({ kind: 'success', message: `Report emailed to ${to}. Open the attachment on your PC to edit in Word or Google Docs.` });
    } catch (e) {
      setStatus({ kind: 'error', message: e?.message || 'Email failed. Try Download instead.' });
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onBack}
            style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: ts(20), fontWeight: 800, color: T.text, letterSpacing: -.3 }}>Trip Recap</div>
            <div style={{ fontSize: ts(13), color: T.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip.name}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 4 }}>
          {[
            { id: 'photos', label: `Photos (${photos.length})` },
            { id: 'report', label: 'Report' },
          ].map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{ flex: 1, border: 'none', borderRadius: 9, padding: '10px 12px', fontSize: ts(14), fontWeight: tab === t.id ? 800 : 600, fontFamily: F, cursor: 'pointer', background: tab === t.id ? T.card : 'transparent', color: tab === t.id ? T.text : T.textSub }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
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
          </>
        )}
      </div>

      <ReportGenerateModal open={showGenerate} onClose={() => !generating && setShowGenerate(false)} onGenerate={handleGenerate} busy={generating} />

      {slideshowIndex !== null && (
        <PhotoSlideshow photos={photos} startIndex={slideshowIndex} onClose={() => setSlideshowIndex(null)} />
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
