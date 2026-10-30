import { ICONS } from '../tokens';
import campsiteImg from '../assets/campsite.png';
import photoImg from '../assets/photo.png';
import weatherImg from '../assets/weather.png';
import riverFlowImg from '../assets/river-flow.png';
import riverFeatureImg from '../assets/river-feature.png';
import wildlifeImg from '../assets/wildlife.png';
import mealImg from '../assets/meal.png';
import expenseImg from '../assets/expense.png';
import customImg from '../assets/custom.png';

export const EVENT_CAPTURE_TYPES = [
  { type: 'campsite', label: 'Campsite', icon: ICONS.tent, img: campsiteImg, col: '#B8702E' },
  { type: 'photo', label: 'Photo', icon: ICONS.camera, img: photoImg, col: '#2C5F3E' },
  { type: 'weather', label: 'Weather', icon: ICONS.compass, img: weatherImg, col: '#517EA3' },
  { type: 'gauge', label: 'River Flow', icon: ICONS.gauge, img: riverFlowImg, col: '#2A5C8E' },
  { type: 'river-feature', label: 'River Feature', icon: ICONS.drop, img: riverFeatureImg, col: '#3A72A8' },
  { type: 'wildlife', label: 'Wildlife', icon: ICONS.leaf, img: wildlifeImg, col: '#4A7A34' },
  { type: 'food', label: 'Meal', icon: ICONS.fork, img: mealImg, col: '#B06030' },
  { type: 'expense', label: 'Expense', icon: ICONS.expense, img: expenseImg, col: '#2A5C8E' },
  { type: 'custom-event', label: 'Custom', icon: ICONS.plus, img: customImg, col: '#2C5F3E' },
];

export function eventTypesForTrip() {
  return EVENT_CAPTURE_TYPES;
}

export const EVENT_SYMBOLS = {
  campsite: '⛺',
  food: '🍴',
  wildlife: '🦌',
  gauge: '📈',
  'river-feature': '💧',
  weather: '⛅',
  note: '📝',
  video: '📷',
  expense: '💵',
  'custom-event': '✨',
};

export const EVENT_COLORS = {
  campsite: '#B8702E',
  food: '#B06030',
  wildlife: '#4A7A34',
  gauge: '#2A5C8E',
  'river-feature': '#3A72A8',
  weather: '#517EA3',
  note: '#6B6763',
  video: '#C05050',
  expense: '#2A5C8E',
  'custom-event': '#2C5F3E',
};

export function defaultEventName(type) {
  const map = {
    campsite: 'Campsite',
    food: 'Meal',
    wildlife: 'Wildlife sighting',
    gauge: 'River Flow',
    'river-feature': 'River Feature',
    weather: 'Weather',
    note: 'Note',
    video: 'Photo',
    expense: 'Expense',
    'custom-event': 'Custom',
  };
  return map[type] || 'Event';
}
