import { useEffect, useState } from 'react';
import { MediaThumb } from './MediaThumb';
import { createMediaObjectUrl, isLegacyMediaRef } from '../lib/mediaStore';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

/** Fullscreen photo slideshow with prev/next. */
export function PhotoSlideshow({ photos = [], startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [src, setSrc] = useState(null);
  const current = photos[index];

  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex, photos]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    async function load() {
      if (!current?.media) {
        setSrc(null);
        return;
      }
      if (isLegacyMediaRef(current.media)) {
        setSrc(current.media.dataUrl || current.media.thumbDataUrl);
        return;
      }
      if (!current.media.id) {
        setSrc(null);
        return;
      }
      try {
        objectUrl = await createMediaObjectUrl(current.media.id, { preferThumb: false });
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current]);

  if (!photos.length) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.94)', zIndex: 2000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: F,
      }}
    >
      <button type="button" onClick={onClose}
        style={{ position: 'absolute', top: 14, right: 14, border: 'none', background: 'rgba(255,255,255,.15)', color: 'white', borderRadius: 10, padding: '8px 12px', fontSize: ts(14), fontWeight: 700, cursor: 'pointer' }}>
        Close
      </button>

      {src ? (
        <img src={src} alt={current?.caption || 'Trip photo'}
          style={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: 8 }}
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: ts(14) }}>Loading photo…</div>
      )}

      {current?.caption && (
        <div style={{ color: 'rgba(255,255,255,.75)', fontSize: ts(13), marginTop: 12, maxWidth: '88%', textAlign: 'center', lineHeight: 1.45 }}>
          {current.caption}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button type="button" onClick={() => setIndex((i) => i - 1)}
            style={{ border: 'none', background: 'rgba(255,255,255,.15)', color: 'white', borderRadius: 10, padding: '10px 16px', fontSize: ts(14), fontWeight: 700, cursor: 'pointer' }}>
            ← Prev
          </button>
        )}
        <span style={{ color: 'rgba(255,255,255,.55)', fontSize: ts(13) }}>{index + 1} / {photos.length}</span>
        {index < photos.length - 1 && (
          <button type="button" onClick={() => setIndex((i) => i + 1)}
            style={{ border: 'none', background: 'rgba(255,255,255,.15)', color: 'white', borderRadius: 10, padding: '10px 16px', fontSize: ts(14), fontWeight: 700, cursor: 'pointer' }}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

export function PhotoGrid({ photos = [], onPhotoClick }) {
  if (!photos.length) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 0', color: T.textFaint, fontSize: ts(14) }}>
        No photos for this view.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
      {photos.map((p, i) => (
        <button key={p.id || i} type="button" onClick={() => onPhotoClick?.(i)}
          style={{ border: 'none', padding: 0, borderRadius: 10, overflow: 'hidden', background: '#F0EDE8', cursor: 'pointer', aspectRatio: '1' }}>
          <MediaThumb media={p.media} alt={p.caption || 'Photo'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </button>
      ))}
    </div>
  );
}
