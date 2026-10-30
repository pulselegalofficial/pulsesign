/**
 * Field rectangles are stored as fractions (0..1) of the page *as displayed*:
 * origin top-left, y down, after the page's /Rotate is applied, exactly as
 * pdf.js shows it in the editor. PDF drawing happens in unrotated user space:
 * origin bottom-left, y up. This converts between the two.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  /** Anchor in PDF user space: the field's displayed bottom-left corner. */
  x: number;
  y: number;
  /** Size in points, along the displayed axes. */
  width: number;
  height: number;
  /** Counter-clockwise degrees to draw with, so content appears upright. */
  rotate: number;
}

export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** Maps a displayed point (u right, v down; fractions) to PDF user space. */
export function displayedToPdf(u: number, v: number, box: Box, rotation: number): { x: number; y: number } {
  const { x: x0, y: y0, width: W, height: H } = box;
  switch (normalizeRotation(rotation)) {
    case 0:
      return { x: x0 + u * W, y: y0 + (1 - v) * H };
    case 90:
      return { x: x0 + v * W, y: y0 + u * H };
    case 180:
      return { x: x0 + (1 - u) * W, y: y0 + v * H };
    case 270:
      return { x: x0 + (1 - v) * W, y: y0 + (1 - u) * H };
  }
}

export function placeField(
  field: { x: number; y: number; w: number; h: number },
  box: Box,
  rotation: number
): Placement {
  const r = normalizeRotation(rotation);
  const sideways = r === 90 || r === 270;
  const displayedW = sideways ? box.height : box.width;
  const displayedH = sideways ? box.width : box.height;
  const anchor = displayedToPdf(field.x, field.y + field.h, box, r);
  return { x: anchor.x, y: anchor.y, width: field.w * displayedW, height: field.h * displayedH, rotate: r };
}

/** Largest size with the given aspect ratio that fits in the box, centred. */
export function fitContain(
  contentW: number,
  contentH: number,
  boxW: number,
  boxH: number
): { dx: number; dy: number; width: number; height: number } {
  const scale = Math.min(boxW / contentW, boxH / contentH);
  const width = contentW * scale;
  const height = contentH * scale;
  return { dx: (boxW - width) / 2, dy: (boxH - height) / 2, width, height };
}

/** Clamp a field so it stays on the page and has a sensible minimum size. */
export function clampField<T extends { x: number; y: number; w: number; h: number }>(f: T): T {
  const w = Math.min(Math.max(f.w, 0.02), 1);
  const h = Math.min(Math.max(f.h, 0.01), 1);
  return { ...f, w, h, x: Math.min(Math.max(f.x, 0), 1 - w), y: Math.min(Math.max(f.y, 0), 1 - h) };
}

/** Smallest a field can be resized to in the editor (fractions of the page). */
export const MIN_FIELD = { w: 0.04, h: 0.02 };

/**
 * New size for a field whose bottom-right corner is dragged to (right, bottom),
 * keeping its top-left corner fixed and the whole field on the page.
 * With `ratio` (h / w, in page fractions) the shape is locked and the axis
 * dragged further, relative to the current size, drives the scale.
 */
export function resizeField(
  f: { x: number; y: number; w: number; h: number },
  right: number,
  bottom: number,
  ratio?: number
): { w: number; h: number } {
  const maxW = 1 - f.x;
  const maxH = 1 - f.y;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (!ratio) {
    return { w: clamp(right - f.x, MIN_FIELD.w, maxW), h: clamp(bottom - f.y, MIN_FIELD.h, maxH) };
  }
  const scale = Math.max((right - f.x) / f.w, (bottom - f.y) / f.h);
  let w = f.w * scale;
  // Keep both axes within [min, max] while holding the ratio.
  const lo = Math.max(MIN_FIELD.w, MIN_FIELD.h / ratio);
  const hi = Math.min(maxW, maxH / ratio);
  w = clamp(w, lo, hi);
  return { w, h: w * ratio };
}
