import reminderHand from '../assets/reminder-hand.png';

/** Index finger with a red string tied around it — the classic "don't forget" reminder. */
export function ReminderFinger({ size = 26 }) {
  return (
    <img src={reminderHand} alt="" aria-hidden="true" width={size} height={size}
      style={{ flexShrink: 0, objectFit: 'contain' }} />
  );
}
