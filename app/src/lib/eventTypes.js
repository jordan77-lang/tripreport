import { ICONS } from '../tokens';
import { mediaCaptureLabel } from './featureFlags';

export const EVENT_CAPTURE_TYPES = [
  { type: 'video', label: mediaCaptureLabel('Photo / Video'), icon: ICONS.camera, col: '#C05050' },
  { type: 'food', label: 'Meal', icon: ICONS.fork, col: '#B06030' },
  { type: 'wildlife', label: 'Wildlife', icon: ICONS.leaf, col: '#4A7A34' },
  { type: 'weather', label: 'Weather', icon: ICONS.compass, col: '#517EA3' },
  { type: 'gauge', label: 'River flow', icon: ICONS.gauge, col: '#2A5C8E' },
  { type: 'custom-event', label: 'Custom', icon: ICONS.plus, col: '#2C5F3E' },
];

export const EVENT_SYMBOLS = {
  food: '🍴',
  wildlife: '🦌',
  gauge: '📈',
  weather: '⛅',
  note: '📝',
  video: '📷',
  'custom-event': '✨',
};

export const EVENT_COLORS = {
  food: '#B06030',
  wildlife: '#4A7A34',
  gauge: '#2A5C8E',
  weather: '#517EA3',
  note: '#6B6763',
  video: '#C05050',
  'custom-event': '#2C5F3E',
};

export function defaultEventName(type) {
  const map = {
    food: 'Meal',
    wildlife: 'Wildlife sighting',
    gauge: 'River flow',
    weather: 'Weather',
    note: 'Note',
    video: 'Photo',
    'custom-event': 'Custom event',
  };
  return map[type] || 'Event';
}
