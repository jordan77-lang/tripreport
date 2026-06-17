export const LOCATION_TYPES = [
  { id: 'campsite', icon: '⛺', label: 'Campsite' },
  { id: 'river-feature', icon: '🌊', label: 'River' },
  { id: 'amazing-find', icon: '✨', label: 'Find' },
  { id: 'hiking-location', icon: '🥾', label: 'Hike' },
  { id: 'point-of-interest', icon: '📍', label: 'POI' },
  { id: 'custom', icon: '📌', label: 'Other' },
];

export function locationTypeLabel(id) {
  return LOCATION_TYPES.find((t) => t.id === id)?.label || id;
}
