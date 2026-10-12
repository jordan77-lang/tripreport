import { useEffect, useState } from 'react';
import { createMediaObjectUrl } from '../lib/mediaStore';

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
    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{media?.name || 'Voice note'}</div>
    {source ? <audio controls preload="metadata" src={source} aria-label={media?.name || 'Voice note'} style={{ width: '100%' }} />
      : <p style={{ fontSize: 12 }}>{failed ? 'Audio is not available on this phone yet.' : 'Loading audio…'}</p>}
  </div>;
}
