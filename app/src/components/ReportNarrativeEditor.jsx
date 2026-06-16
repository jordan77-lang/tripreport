import { useMemo } from 'react';
import { MediaThumb } from './MediaThumb';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { collectTripPhotos } from '../lib/tripPhotos';
import { parseNarrativeSegments, serializeNarrativeSegments } from '../lib/recapNarrative';

export function ReportNarrativeEditor({ value, onChange, onBlurSave, trip }) {
  const segments = useMemo(() => parseNarrativeSegments(value), [value]);
  const photoById = useMemo(
    () => new Map(collectTripPhotos(trip).map((p) => [p.id, p])),
    [trip],
  );

  function updateSegment(index, nextSegment) {
    const next = segments.map((seg, i) => (i === index ? nextSegment : seg));
    onChange(serializeNarrativeSegments(next));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {segments.map((seg, index) => {
        if (seg.type === 'photo') {
          const photo = seg.photoId ? photoById.get(seg.photoId) : null;
          return (
            <PhotoPlaceholderCard
              key={`photo-${index}-${seg.photoId || seg.caption}`}
              photo={photo}
              caption={seg.caption}
            />
          );
        }

        return (
          <textarea
            key={`text-${index}`}
            value={seg.content}
            onChange={(e) => updateSegment(index, { type: 'text', content: e.target.value })}
            onBlur={() => onBlurSave?.()}
            placeholder={index === 0 ? 'Generate a draft with AI, or write your trip story here…' : 'Continue your report…'}
            rows={Math.max(4, Math.min(14, seg.content.split('\n').length + 1))}
            style={{
              width: '100%',
              minHeight: 88,
              border: `1.5px solid ${T.border}`,
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: ts(15),
              lineHeight: 1.55,
              fontFamily: F,
              color: T.text,
              background: T.card,
              boxSizing: 'border-box',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        );
      })}
    </div>
  );
}

function PhotoPlaceholderCard({ photo, caption }) {
  return (
    <div
      style={{
        border: `1.5px dashed ${T.accent}`,
        borderRadius: 12,
        padding: 12,
        background: T.accentLight,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 8,
          overflow: 'hidden',
          flexShrink: 0,
          background: T.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {photo?.media ? (
          <MediaThumb
            media={photo.media}
            alt={caption}
            preferThumb
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: ts(22) }} aria-hidden>🖼</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ts(11), fontWeight: 800, color: T.accent, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
          Photo placeholder
        </div>
        <div style={{ fontSize: ts(14), fontWeight: 600, color: T.text, lineHeight: 1.4 }}>
          {caption}
        </div>
        <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 4, lineHeight: 1.35 }}>
          Embedded in the Word download at this spot in the story.
        </div>
      </div>
    </div>
  );
}
