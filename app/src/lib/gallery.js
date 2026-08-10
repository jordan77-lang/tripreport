// Shared media gallery helpers.
//
// Locations, events, and entries all carry a `photos[]` array of media refs.
// Each ref is what createPhotoMediaFromFile returns, plus per-image authorship
// and caption fields, so the same grid/lightbox works everywhere.
//
// Legacy shape: locations and events used to hold a single `coverPhoto`. That
// field is still read (and still written as a denormalised "first photo" so old
// clients and the recap/report path keep working) but new media goes to photos[].

import { createPhotoMediaFromFile } from './media';
import { VIDEO_ENABLED } from './featureFlags';

/** Media kinds a gallery accepts. Video is gated by the field-test flag. */
export const GALLERY_ACCEPT = VIDEO_ENABLED ? 'image/*,video/*' : 'image/*';

export function isVideoRef(ref) {
  return Boolean(ref?.mime?.startsWith('video/') || ref?.type?.startsWith('video/'));
}

/**
 * Every photo attached to an entity, oldest first, with the legacy coverPhoto
 * folded in when it is not already represented in photos[].
 */
export function galleryPhotos(entity) {
  if (!entity) return [];
  const photos = Array.isArray(entity.photos) ? entity.photos.filter(Boolean) : [];
  const cover = entity.coverPhoto;
  const coverIsListed = !cover
    || photos.some((p) => (cover.id && p.id === cover.id)
      || (!cover.id && p.thumbDataUrl && p.thumbDataUrl === cover.thumbDataUrl));

  const all = coverIsListed ? photos : [{ ...cover, legacyCover: true }, ...photos];
  return all.filter(hasRenderableMedia);
}

export function galleryCount(entity) {
  return galleryPhotos(entity).length;
}

/** The image that represents this entity in lists and on maps. */
export function galleryCover(entity) {
  if (!entity) return null;
  if (entity.coverPhoto && hasRenderableMedia(entity.coverPhoto)) return entity.coverPhoto;
  return galleryPhotos(entity)[0] || null;
}

function hasRenderableMedia(ref) {
  return Boolean(ref && (ref.id || ref.thumbDataUrl || ref.dataUrl));
}

/**
 * Turn picked files into media refs, stamped with who added them and when.
 * Non-image files (video, when enabled) are stored as plain metadata refs the
 * same way EntryForm has always handled them.
 */
export async function createGalleryPhotos(files, { tripId, authorId = null, authorName = null } = {}) {
  const list = Array.from(files || []);
  if (!list.length || !tripId) return [];

  const now = Date.now();
  const created = await Promise.all(list.map(async (file) => {
    const base = {
      caption: '',
      authorId: authorId || null,
      authorName: authorName || null,
      addedAt: now,
    };
    if (file.type?.startsWith('image/')) {
      try {
        const ref = await createPhotoMediaFromFile(file, tripId);
        return { ...ref, ...base };
      } catch {
        return null;
      }
    }
    // Video / other: keep the metadata so the ref is visible and syncable.
    return { ...base, name: file.name, size: file.size, mime: file.type, type: file.type };
  }));

  return created.filter(Boolean);
}

/**
 * Append refs to an entity's photos[], keeping coverPhoto pointing at the first
 * image so existing list/map/recap code keeps rendering something.
 */
export function appendPhotosPatch(entity, newRefs) {
  const refs = (newRefs || []).filter(Boolean);
  if (!refs.length) return null;
  const existing = Array.isArray(entity?.photos) ? entity.photos : [];
  const photos = [...existing, ...refs];
  const patch = { photos };
  if (!entity?.coverPhoto) {
    const firstImage = photos.find((p) => !isVideoRef(p)) || photos[0];
    if (firstImage) patch.coverPhoto = firstImage;
  }
  return patch;
}

/** Patch that removes one photo by id (or index for legacy refs without ids). */
export function removePhotoPatch(entity, target) {
  const photos = Array.isArray(entity?.photos) ? entity.photos : [];
  const next = photos.filter((p) => (target.id ? p.id !== target.id : p !== target));

  const patch = { photos: next };
  const coverRemoved = entity?.coverPhoto
    && ((target.id && entity.coverPhoto.id === target.id) || entity.coverPhoto === target);
  if (coverRemoved) {
    patch.coverPhoto = next.find((p) => !isVideoRef(p)) || next[0] || null;
  }
  return patch;
}

/** Patch that sets the caption on one photo. */
export function captionPhotoPatch(entity, target, caption) {
  const photos = Array.isArray(entity?.photos) ? entity.photos : [];
  const next = photos.map((p) => {
    const isTarget = target.id ? p.id === target.id : p === target;
    return isTarget ? { ...p, caption } : p;
  });
  const patch = { photos: next };
  if (entity?.coverPhoto && target.id && entity.coverPhoto.id === target.id) {
    patch.coverPhoto = { ...entity.coverPhoto, caption };
  }
  return patch;
}

/** Patch that promotes a photo to the entity's cover. */
export function setCoverPatch(entity, target) {
  const photos = galleryPhotos(entity);
  const found = photos.find((p) => (target.id ? p.id === target.id : p === target));
  if (!found) return null;
  // A legacy cover being re-promoted also gets folded into photos[].
  const listed = Array.isArray(entity?.photos) ? entity.photos : [];
  const alreadyListed = listed.some((p) => (found.id ? p.id === found.id : p === found));
  return {
    coverPhoto: found,
    photos: alreadyListed ? listed : [found, ...listed],
  };
}
