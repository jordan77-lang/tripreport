import { useEffect, useState } from 'react';
import { createMediaObjectUrl } from '../lib/mediaStore';
import { microphoneArt } from '../lib/locationArt';
import { ArtImg } from './LocationMark';
import { ts } from '../lib/textScale';

export function AudioAttachment({ media }) {
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);
  const id = media?.id;
  useEffect(() => {
    let disposed = false;
    let url;
    createMediaObjectUrl(id, { preferThumb: false }).then(value => {
      if (disposed) { if (value) URL.revokeObjectURL(value); return; }
      url = value;
      setSource(value);
      setFailed(!value);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return <div style={{ maxWidth: '100%', width: 240 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: ts(13) }}>
      <ArtImg src={microphoneArt} size={18} />
      <span style={{ overflowWrap: 'anywhere' }}>{media?.name || 'Voice note'}</span>
    </div>
    {source ? <audio controls preload="metadata" src={source} aria-label={media?.name || 'Voice note'} style={{ width: '100%' }} />
      : <p style={{ fontSize: ts(12) }}>{failed ? 'Audio is not available on this phone yet.' : 'Loading audio…'}</p>}
  </div>;
}
