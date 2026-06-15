import { useEffect, useState } from 'react';
import { createMediaObjectUrl, isLegacyMediaRef } from '../lib/mediaStore';

/**
 * Renders a photo from local IndexedDB (or legacy base64 thumb).
 * Never fetches from Supabase for display — cloud is sync-only.
 */
export function MediaThumb({ media, alt = '', style, preferThumb = true, className }) {
  const [src, setSrc] = useState(() => {
    if (!media) return null;
    if (isLegacyMediaRef(media)) return media.thumbDataUrl || media.dataUrl;
    return null;
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    async function load() {
      if (!media) {
        setSrc(null);
        return;
      }
      if (isLegacyMediaRef(media)) {
        setSrc(media.thumbDataUrl || media.dataUrl);
        return;
      }
      if (!media.id) {
        setSrc(null);
        return;
      }
      try {
        objectUrl = await createMediaObjectUrl(media.id, { preferThumb });
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
  }, [media?.id, media?.thumbDataUrl, media?.dataUrl, preferThumb]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
    />
  );
}
