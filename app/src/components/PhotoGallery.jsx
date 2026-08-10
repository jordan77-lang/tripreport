import { useEffect, useRef, useState } from 'react';
import { Ic } from './Ic';
import { MediaThumb } from './MediaThumb';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { createMediaObjectUrl, isLegacyMediaRef } from '../lib/mediaStore';
import { GALLERY_ACCEPT, galleryPhotos, isVideoRef } from '../lib/gallery';

/**
 * The one photo surface used by locations, events, and entries.
 *
 * Any member can add; captions are per image; the author of a photo can always
 * caption or remove their own even when they cannot edit the parent entity.
 */
export function PhotoGallery({
  entity,
  title = 'Photos',
  canAdd = true,
  canManage = false,
  currentUserId = null,
  busy = false,
  onAdd,
  onCaption,
  onRemove,
  onSetCover,
  emptyHint = 'Add photos anyone on the trip can see.',
}) {
  const photos = galleryPhotos(entity);
  const captureRef = useRef(null);
  const attachRef = useRef(null);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [captioningKey, setCaptioningKey] = useState(null);
  const [captionDraft, setCaptionDraft] = useState('');

  const keyOf = (p, i) => p.id || `${p.name || 'photo'}-${i}`;
  const canTouch = (p) => canManage || (currentUserId && p.authorId === currentUserId);

  function startCaption(p, i) {
    setCaptioningKey(keyOf(p, i));
    setCaptionDraft(p.caption || '');
  }

  function commitCaption(p) {
    onCaption?.(p, captionDraft.trim());
    setCaptioningKey(null);
    setCaptionDraft('');
  }

  return (
    <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 13px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: photos.length || canAdd ? 10 : 0 }}>
        <div style={{ fontSize: ts(13), fontWeight: 800, color: T.text }}>
          {title}
          {photos.length > 0 && (
            <span style={{ fontSize: ts(11), fontWeight: 700, color: T.textFaint, marginLeft: 6 }}>{photos.length}</span>
          )}
        </div>
        {canAdd && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => captureRef.current?.click()} disabled={busy} style={pillBtn(true, busy)}>
              <Ic d={ICONS.camera} size={13} color={busy ? T.textFaint : '#2A5C8E'} sw={1.9} />
              <span>Camera</span>
            </button>
            <button type="button" onClick={() => attachRef.current?.click()} disabled={busy} style={pillBtn(false, busy)}>
              <Ic d={ICONS.plus} size={13} color={busy ? T.textFaint : T.textSub} sw={2} />
              <span>Upload</span>
            </button>
          </div>
        )}
      </div>

      {/* multiple: the whole point — one pick, many photos */}
      <input ref={captureRef} type="file" accept={GALLERY_ACCEPT} capture="environment" multiple
             style={{ display: 'none' }}
             onChange={(e) => { onAdd?.(e.target.files); e.target.value = ''; }} />
      <input ref={attachRef} type="file" accept={GALLERY_ACCEPT} multiple
             style={{ display: 'none' }}
             onChange={(e) => { onAdd?.(e.target.files); e.target.value = ''; }} />

      {busy && (
        <div style={{ fontSize: ts(11.5), color: T.textFaint, marginBottom: 8 }}>Adding photos…</div>
      )}

      {photos.length === 0 && !busy && (
        <div style={{ fontSize: ts(11.5), color: T.textFaint, lineHeight: 1.45, textAlign: 'center', padding: '10px 0' }}>
          {canAdd ? emptyHint : 'No photos yet.'}
        </div>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {photos.map((p, i) => {
            const key = keyOf(p, i);
            const isCover = entity?.coverPhoto && p.id && entity.coverPhoto.id === p.id;
            return (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div onClick={() => setLightboxIdx(i)}
                     style={{ position: 'relative', borderRadius: 9, overflow: 'hidden', background: '#F0EDE8',
                              cursor: 'pointer', aspectRatio: '1' }}>
                  {isVideoRef(p) ? (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 18 }}>🎥</span>
                      <span style={{ fontSize: 8.5, color: T.textFaint, padding: '0 4px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{p.name}</span>
                    </div>
                  ) : (
                    <MediaThumb media={p} alt={p.caption || `Photo ${i + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  )}
                  {isCover && (
                    <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,.55)', color: 'white',
                                  borderRadius: 5, padding: '1px 5px', fontSize: 8.5, fontWeight: 700 }}>Cover</div>
                  )}
                  {p.caption && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                                  background: 'linear-gradient(transparent, rgba(0,0,0,.6))', color: 'white',
                                  fontSize: 9, padding: '10px 4px 3px', overflow: 'hidden',
                                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.caption}
                    </div>
                  )}
                </div>
                {canTouch(p) && (
                  <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                    <button type="button" onClick={() => startCaption(p, i)} style={microBtn}>
                      {p.caption ? 'Edit' : 'Caption'}
                    </button>
                    {onSetCover && !isCover && !isVideoRef(p) && (
                      <button type="button" onClick={() => onSetCover(p)} style={microBtn}>Cover</button>
                    )}
                    {onRemove && (
                      <button type="button" onClick={() => onRemove(p)} style={{ ...microBtn, color: '#8A1414' }}>Remove</button>
                    )}
                  </div>
                )}
                {captioningKey === key && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <textarea
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      placeholder="Describe this photo…"
                      rows={2}
                      autoFocus
                      style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 8, padding: '6px 7px',
                               fontSize: ts(11), fontFamily: F, background: T.bg, outline: 'none',
                               boxSizing: 'border-box', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" onClick={() => setCaptioningKey(null)} style={{ ...microBtn, flex: 1 }}>Cancel</button>
                      <button type="button" onClick={() => commitCaption(p)}
                              style={{ ...microBtn, flex: 1, color: 'white', background: '#2A5C8E', border: 'none' }}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lightboxIdx !== null && photos[lightboxIdx] && (
        <Lightbox
          photos={photos}
          index={lightboxIdx}
          onIndexChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

function Lightbox({ photos, index, onIndexChange, onClose }) {
  const [src, setSrc] = useState(null);
  const photo = photos[index];

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    async function load() {
      if (!photo || isVideoRef(photo)) { setSrc(null); return; }
      if (isLegacyMediaRef(photo)) { setSrc(photo.dataUrl || photo.thumbDataUrl); return; }
      if (!photo.id) { setSrc(null); return; }
      try {
        objectUrl = await createMediaObjectUrl(photo.id, { preferThumb: false });
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    }

    load();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo]);

  return (
    <div onClick={onClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.93)', zIndex: 1000,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {src ? (
        <img src={src} alt={photo.caption || `Photo ${index + 1}`}
             style={{ maxWidth: '100%', maxHeight: '74vh', objectFit: 'contain', borderRadius: 8 }}
             onClick={(e) => e.stopPropagation()} />
      ) : (
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 13 }}>
          {isVideoRef(photo) ? `🎥 ${photo.name || 'Video'}` : 'Preview unavailable'}
        </div>
      )}

      {photo.caption && (
        <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5, marginTop: 12, maxWidth: 520, textAlign: 'center', lineHeight: 1.5 }}>
          {photo.caption}
        </div>
      )}
      {photo.authorName && (
        <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 10.5, marginTop: 5 }}>
          Added by {photo.authorName}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 16, alignItems: 'center' }}>
        {index > 0 && (
          <div onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }} style={lightboxNav}>← Prev</div>
        )}
        <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 11 }}>{index + 1} / {photos.length}</span>
        {index < photos.length - 1 && (
          <div onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }} style={lightboxNav}>Next →</div>
        )}
      </div>
      <div style={{ marginTop: 10, color: 'rgba(255,255,255,.35)', fontSize: 10.5 }}>Tap anywhere to close</div>
    </div>
  );
}

function pillBtn(primary, busy) {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    background: busy ? T.bg : primary ? '#E4EFF8' : T.bg,
    border: `1px solid ${busy ? T.border : primary ? '#3A72A840' : T.border}`,
    borderRadius: 9, padding: '6px 10px',
    fontSize: ts(11), fontWeight: 700, fontFamily: F,
    color: busy ? T.textFaint : primary ? '#2A5C8E' : T.textSub,
    cursor: busy ? 'default' : 'pointer',
  };
}

const microBtn = {
  border: `1px solid ${T.border}`,
  background: T.bg,
  borderRadius: 6,
  padding: '3px 6px',
  fontSize: 9.5,
  fontWeight: 700,
  color: T.textSub,
  cursor: 'pointer',
  fontFamily: F,
};

const lightboxNav = {
  background: 'rgba(255,255,255,.15)',
  borderRadius: 20,
  padding: '8px 16px',
  cursor: 'pointer',
  color: 'white',
  fontSize: 12,
  fontWeight: 700,
};
