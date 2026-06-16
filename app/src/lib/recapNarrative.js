import { collectTripPhotos, listTripDays } from './tripPhotos';

/** `[Photo: id:abc|Caption here]` — stable id for docx export; caption shown in draft UI. */
export const PHOTO_LINE_RE = /^\[Photo:\s*(?:id:([^|\]]+)\|)?([^\]]*)\]\s*$/i;

export function photoCaption(photo) {
  const parts = [photo.caption, photo.locationName, photo.eventName].filter(Boolean);
  return parts[0] || 'Trip photo';
}

export function formatPhotoPlaceholder(photo) {
  const caption = photoCaption(photo);
  return `[Photo: id:${photo.id}|${caption}]`;
}

export function parseNarrativeSegments(text) {
  const segments = [];
  const lines = String(text || '').split('\n');
  let textBuffer = [];

  function flushText() {
    if (!textBuffer.length) return;
    segments.push({ type: 'text', content: textBuffer.join('\n') });
    textBuffer = [];
  }

  for (const line of lines) {
    const m = line.match(PHOTO_LINE_RE);
    if (m) {
      flushText();
      segments.push({
        type: 'photo',
        photoId: m[1]?.trim() || null,
        caption: (m[2] || '').trim() || 'Trip photo',
      });
    } else {
      textBuffer.push(line);
    }
  }
  flushText();

  if (!segments.length) {
    segments.push({ type: 'text', content: '' });
  }
  return segments;
}

export function serializeNarrativeSegments(segments) {
  return segments.map((seg) => {
    if (seg.type === 'photo') {
      const cap = seg.caption || 'Trip photo';
      return seg.photoId ? `[Photo: id:${seg.photoId}|${cap}]` : `[Photo: ${cap}]`;
    }
    return seg.content;
  }).join('\n');
}

export function hasPhotoPlaceholders(text) {
  return /\[Photo:/i.test(String(text || ''));
}

/** Insert photo placeholders in capture order, interleaved within each day section. */
export function weaveChronologicalPhotoPlaceholders(trip, narrativeText) {
  const photos = [...collectTripPhotos(trip)].sort((a, b) => {
    const ta = new Date(a.at || 0).getTime() || 0;
    const tb = new Date(b.at || 0).getTime() || 0;
    return ta - tb;
  });
  if (!photos.length) return narrativeText || '';
  if (/\[Photo:\s*id:/i.test(narrativeText || '')) return narrativeText;

  const tripDays = listTripDays(trip);
  const sections = splitNarrativeSections(narrativeText || '');
  const hasDaySections = sections.some((s) => s.heading && /^Day \d/i.test(s.heading));

  if (!hasDaySections) {
    return weavePhotosThroughParagraphs(narrativeText || '', photos);
  }

  const usedIds = new Set();
  const out = [];

  function remainingPhotos() {
    return photos.filter((p) => !usedIds.has(p.id));
  }

  function markUsed(list) {
    for (const p of list) usedIds.add(p.id);
  }

  for (const sec of sections) {
    if (sec.heading === 'Closing') {
      for (const p of remainingPhotos()) {
        out.push(formatPhotoPlaceholder(p));
        usedIds.add(p.id);
      }
    }

    if (sec.heading && /^Day \d/i.test(sec.heading)) {
      const dayKey = inferDayKeyFromHeading(sec.heading, tripDays);
      const dayPhotos = photos.filter((p) => p.day === dayKey && !usedIds.has(p.id));
      const lines = [sec.heading];
      if (sec.body) {
        lines.push(interleavePhotosInBody(sec.body, dayPhotos, usedIds));
      } else if (dayPhotos.length) {
        markUsed(dayPhotos);
        lines.push(dayPhotos.map(formatPhotoPlaceholder).join('\n\n'));
      }
      out.push(lines.filter(Boolean).join('\n\n'));
      continue;
    }

    out.push(sec.full);
  }

  const leftover = remainingPhotos();
  if (leftover.length) {
    markUsed(leftover);
    out.push(leftover.map(formatPhotoPlaceholder).join('\n\n'));
  }

  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function ensurePhotoPlaceholders(trip, narrativeText) {
  if (!narrativeText?.trim()) return narrativeText || '';
  if (hasPhotoPlaceholders(narrativeText) && /\[Photo:\s*id:/i.test(narrativeText)) {
    return narrativeText;
  }
  return weaveChronologicalPhotoPlaceholders(trip, narrativeText);
}

export function findPhotoForPlaceholder(allPhotos, { photoId, caption }, usedPhotoIds) {
  if (photoId) {
    const byId = allPhotos.find((p) => p.id === photoId);
    if (byId) return byId;
  }

  const q = (caption || '').trim().toLowerCase();
  const candidates = allPhotos.filter((p) => !usedPhotoIds.has(p.id));

  if (q) {
    const exact = candidates.find((p) => photoCaption(p).toLowerCase() === q);
    if (exact) return exact;

    const partial = candidates.find((p) => {
      const cap = photoCaption(p).toLowerCase();
      return cap.includes(q) || q.includes(cap);
    });
    if (partial) return partial;
  }

  return candidates[0] || null;
}

function splitNarrativeSections(text) {
  const blocks = String(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const first = lines[0]?.trim() || '';
    const isHeading = isSectionHeading(first, lines.length);
    return {
      heading: isHeading ? first : null,
      body: isHeading ? lines.slice(1).join('\n').trim() : '',
      full: block,
    };
  });
}

function isSectionHeading(first, lineCount) {
  if (first === 'Summary' || first === 'Closing') return true;
  if (/^Day \d/i.test(first)) return true;
  return false;
}

function inferDayKeyFromHeading(heading, tripDays) {
  const m = heading.match(/^Day\s+(\d+)/i);
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  return tripDays[idx] || null;
}

function interleavePhotosInBody(bodyText, dayPhotos, usedIds) {
  if (!dayPhotos.length) return bodyText;

  const paras = bodyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) {
    for (const p of dayPhotos) usedIds.add(p.id);
    return dayPhotos.map(formatPhotoPlaceholder).join('\n\n');
  }

  const parts = [];
  let photoIdx = 0;

  for (let i = 0; i < paras.length; i++) {
    parts.push(paras[i]);
    if (photoIdx < dayPhotos.length) {
      parts.push(formatPhotoPlaceholder(dayPhotos[photoIdx]));
      usedIds.add(dayPhotos[photoIdx].id);
      photoIdx += 1;
    }
  }

  while (photoIdx < dayPhotos.length) {
    parts.push(formatPhotoPlaceholder(dayPhotos[photoIdx]));
    usedIds.add(dayPhotos[photoIdx].id);
    photoIdx += 1;
  }

  return parts.join('\n\n');
}

function weavePhotosThroughParagraphs(text, photos) {
  if (!photos.length) return text;
  const usedIds = new Set();
  const closingMatch = text.match(/\n\nClosing(\n|$)/i);
  if (closingMatch && closingMatch.index != null) {
    const intro = text.slice(0, closingMatch.index).trim();
    const closing = text.slice(closingMatch.index).trim();
    const body = interleavePhotosInBody(intro, photos, usedIds);
    return `${body}\n\n${closing}`.replace(/\n{3,}/g, '\n\n').trim();
  }
  return interleavePhotosInBody(text, photos, usedIds);
}
