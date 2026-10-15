/** Every stop on a trip, from the drive there through the take-out. */
export const LOCATION_TYPES = [
  { id: 'put-in', icon: '🟢', label: 'Put-in' },
  { id: 'take-out', icon: '🔴', label: 'Take-out' },
  { id: 'scout', icon: '👀', label: 'Scout' },
  { id: 'hike', icon: '🥾', label: 'Hike' },
  { id: 'campsite', icon: '⛺', label: 'Camp' },
  { id: 'interest', icon: '🏛', label: 'Interest' },
  { id: 'shopping', icon: '🛒', label: 'Shop' },
  { id: 'hotel', icon: '🏨', label: 'Hotel' },
  { id: 'meeting', icon: '🗒', label: 'Meeting' },
  { id: 'custom', icon: '📌', label: 'Other' },
];

/** Older pins keep their ids. The picker and the label use the current type. */
const LEGACY_TYPE = {
  'rapid-scout': 'scout',
  'hiking-location': 'hike',
  'point-of-interest': 'interest',
};

const LEGACY_LABEL = {
  'river-feature': 'River',
  'amazing-find': 'Find',
};

export function canonicalLocationType(id) {
  return LEGACY_TYPE[id] || id || 'interest';
}

export function locationTypeLabel(id) {
  if (LEGACY_LABEL[id]) return LEGACY_LABEL[id];
  const canonical = canonicalLocationType(id);
  return LOCATION_TYPES.find((t) => t.id === canonical)?.label || id || 'Place';
}

/** A new pin is a place. Camp, scout, and river access are choices on the form. */
export function defaultLocationKind() {
  return LOCATION_TYPES.find((t) => t.id === 'interest');
}
