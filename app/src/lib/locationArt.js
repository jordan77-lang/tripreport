import { LOCATION_TYPES, canonicalLocationType } from './locationTypes';
import putIn from '../assets/put-in.png';
import takeOut from '../assets/take-out.png';
import scout from '../assets/scout.png';
import hike from '../assets/hike.png';
import campsite from '../assets/campsite.png';
import interest from '../assets/interest.png';
import shopping from '../assets/cart.png';
import hotel from '../assets/hotel.png';
import meeting from '../assets/meeting.png';
import custom from '../assets/place.png';
import comment from '../assets/comment.png';
import star from '../assets/star.png';
import compass from '../assets/compass.png';
import microphone from '../assets/microphone.png';
import trailMap from '../assets/trail-map.png';

/** Artwork for a place type. Stored locations keep their emoji; screens look the art up from the type. */
const ART = {
  'put-in': putIn,
  'take-out': takeOut,
  scout,
  hike,
  camp: campsite,
  campsite,
  interest,
  shopping,
  hotel,
  meeting,
  custom,
};

const LEGACY_ICON = {
  camp: '⛺',
  campsite: '⛺',
  'point-of-interest': '🏛',
  'hiking-location': '🥾',
  'rapid-scout': '👀',
};

export const commentArt = comment;
export const starArt = star;
export const compassArt = compass;
export const microphoneArt = microphone;
export const trailMapArt = trailMap;

export function locationTypeArt(typeId) {
  return ART[canonicalLocationType(typeId)] || ART[typeId] || null;
}

function typeIcon(typeId) {
  const canonical = canonicalLocationType(typeId);
  return LOCATION_TYPES.find((t) => t.id === canonical)?.icon
    || LEGACY_ICON[typeId]
    || LEGACY_ICON[canonical]
    || null;
}

/** Image for a saved place, unless someone picked a custom emoji for it. */
export function locationDisplayArt(location) {
  if (!location) return null;
  const icon = location.icon;
  const expected = typeIcon(location.type);
  const usesTypeArt = !icon || icon === '📍' || icon === expected;
  if (!usesTypeArt) return null;
  return locationTypeArt(location.type);
}

/** Map pin symbol: the place artwork, or the stored emoji when it was customized. */
export function locationMapSymbol(location) {
  return locationDisplayArt(location) || location?.icon || '📍';
}

export function isImageSymbol(symbol) {
  return typeof symbol === 'string' && /(?:^data:image\/|\.(?:png|webp|jpe?g|gif|svg)(?:[?#]|$))/i.test(symbol);
}
