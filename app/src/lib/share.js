export async function shareEntity({ title, text }) {
  const payload = {
    title: title || 'TripReport',
    text: text || '',
  };

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share(payload);
      return true;
    } catch {
      return false;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${payload.title}\n${payload.text}`.trim());
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
