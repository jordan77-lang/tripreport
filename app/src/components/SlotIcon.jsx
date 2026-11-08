import skillet from '../assets/skillet.png';
import meal from '../assets/meal.png';
import happyHour from '../assets/happy-hour.png';
import dessert from '../assets/dessert.png';
import { normalizeMealSlot } from '../lib/mealSlots';

const SLOT_ICONS = { breakfast: skillet, lunch: meal, 'happy-hour': happyHour, dinner: meal, dessert };

export function SlotIcon({ slot, size = 18 }) {
  return <img src={SLOT_ICONS[normalizeMealSlot(slot)] || meal} alt="" aria-hidden="true" width={size} height={size} style={{ verticalAlign: 'middle', marginRight: 4, objectFit: 'contain' }} />;
}
