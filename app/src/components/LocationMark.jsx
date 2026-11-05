import { locationDisplayArt, locationTypeArt } from '../lib/locationArt';

export function ArtImg({ src, size = 18, style }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ objectFit: 'contain', flexShrink: 0, display: 'block', ...style }}
    />
  );
}

/** Place artwork for a type chip or a saved location. A custom emoji still shows as text. */
export function LocationMark({ location, type, icon, size = 28 }) {
  const art = location ? locationDisplayArt(location) : locationTypeArt(type);
  if (art) return <ArtImg src={art} size={size} />;
  return (
    <span aria-hidden="true" style={{ fontSize: Math.max(12, Math.round(size * 0.62)), lineHeight: 1 }}>
      {location?.icon || icon || '📍'}
    </span>
  );
}
