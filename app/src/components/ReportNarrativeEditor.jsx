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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {segments.map((seg, index) => {
        if (seg.type === 'photo') {
          const photo = seg.photoId ? photoById.get(seg.photoId) : null;
          return (
            <InlinePhotoBlock
              key={`photo-${index}-${seg.photoId || seg.caption}`}
              photo={photo}
              caption={seg.caption}
              onCaptionChange={(caption) => updateSegment(index, { ...seg, caption })}
              onBlur={() => onBlurSave?.()}
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
            rows={Math.max(4, Math.min(16, seg.content.split('\n').length + 1))}
            style={{
              width: '100%',
              minHeight: 96,
              border: 'none',
              borderBottom: `1px solid ${T.border}`,
              padding: '14px 0',
              fontSize: ts(16),
              lineHeight: 1.65,
              fontFamily: F,
              color: T.text,
              background: 'transparent',
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

function InlinePhotoBlock({ photo, caption, onCaptionChange, onBlur }) {
  return (
    <figure style={{ margin: '16px 0', padding: 0 }}>
      <div style={{
        borderRadius: 10,
        overflow: 'hidden',
        background: '#F0EDE8',
        border: `1px solid ${T.border}`,
      }}>
        {photo?.media ? (
          <MediaThumb
            media={photo.media}
            alt={caption}
            style={{ width: '100%', maxHeight: 360, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            minHeight: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.textFaint,
            fontSize: ts(13),
            padding: 20,
            textAlign: 'center',
          }}>
            Photo will appear here in your Word download
          </div>
        )}
      </div>
      <figcaption style={{ marginTop: 8 }}>
        <input
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Photo caption — part of your story"
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            fontSize: ts(14),
            fontStyle: 'italic',
            lineHeight: 1.5,
            color: T.textSub,
            fontFamily: F,
            outline: 'none',
            padding: 0,
          }}
        />
      </figcaption>
    </figure>
  );
}
