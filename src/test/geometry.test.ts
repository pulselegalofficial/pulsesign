import { describe, expect, it } from 'vitest';
import { MIN_FIELD, clampField, displayedToPdf, fitContain, normalizeRotation, placeField, resizeField } from '../lib/geometry';

const box = { x: 0, y: 0, width: 600, height: 800 };

describe('displayedToPdf', () => {
  it('maps corners of an unrotated page (y flips)', () => {
    expect(displayedToPdf(0, 0, box, 0)).toEqual({ x: 0, y: 800 });
    expect(displayedToPdf(1, 1, box, 0)).toEqual({ x: 600, y: 0 });
  });

  it('honours a crop box offset', () => {
    expect(displayedToPdf(0, 1, { x: 10, y: 20, width: 100, height: 200 }, 0)).toEqual({ x: 10, y: 20 });
  });

  it('maps the displayed top-left corner for each rotation', () => {
    // Rotating clockwise moves this page corner to the displayed top-left.
    expect(displayedToPdf(0, 0, box, 90)).toEqual({ x: 0, y: 0 });
    expect(displayedToPdf(0, 0, box, 180)).toEqual({ x: 600, y: 0 });
    expect(displayedToPdf(0, 0, box, 270)).toEqual({ x: 600, y: 800 });
  });

  it('normalises odd rotation values', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });
});

describe('placeField', () => {
  const field = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

  it('anchors at the displayed bottom-left corner on an upright page', () => {
    const p = placeField(field, box, 0);
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(800 - 0.25 * 800);
    expect(p.width).toBeCloseTo(180);
    expect(p.height).toBeCloseTo(40);
    expect(p.rotate).toBe(0);
  });

  it('swaps axes on a sideways page', () => {
    // Displayed size of a 90° page is 800 wide by 600 high.
    const p = placeField(field, box, 90);
    expect(p.width).toBeCloseTo(0.3 * 800);
    expect(p.height).toBeCloseTo(0.05 * 600);
    expect(p.rotate).toBe(90);
    expect(p.x).toBeCloseTo(0.25 * 600);
    expect(p.y).toBeCloseTo(0.1 * 800);
  });
});

describe('fitContain', () => {
  it('fits a wide image into a box and centres it', () => {
    const f = fitContain(400, 100, 200, 100);
    expect(f).toEqual({ dx: 0, dy: 25, width: 200, height: 50 });
  });
});

describe('clampField', () => {
  it('keeps a field on the page', () => {
    expect(clampField({ x: 0.9, y: -0.2, w: 0.3, h: 0.1 })).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.1 });
  });
});

describe('resizeField', () => {
  const f = { x: 0.2, y: 0.3, w: 0.3, h: 0.1 };

  it('follows the dragged corner freely without a ratio', () => {
    const r = resizeField(f, 0.7, 0.5);
    expect(r.w).toBeCloseTo(0.5);
    expect(r.h).toBeCloseTo(0.2);
  });

  it('never shrinks below the minimum, even when dragged past the origin', () => {
    expect(resizeField(f, 0, 0)).toEqual(MIN_FIELD);
  });

  it('stops at the page edge', () => {
    const r = resizeField(f, 2, 2);
    expect(r.w).toBeCloseTo(0.8);
    expect(r.h).toBeCloseTo(0.7);
  });

  it('keeps the shape locked with a ratio, driven by the larger drag', () => {
    const r = resizeField(f, 0.5, 0.6, f.h / f.w); // height tripled, width unchanged
    expect(r.h / r.w).toBeCloseTo(f.h / f.w);
    expect(r.w).toBeCloseTo(0.8); // would be 0.9, clipped by the right edge
  });

  it('locked shape respects both edges and minimums', () => {
    const sq = { x: 0.1, y: 0.8, w: 0.1, h: 0.1 };
    const big = resizeField(sq, 1, 1, 1);
    expect(big.h).toBeCloseTo(0.2);
    expect(big.w).toBeCloseTo(0.2);
    const tiny = resizeField(sq, 0, 0, 1);
    expect(tiny.w).toBeCloseTo(MIN_FIELD.w);
    expect(tiny.h).toBeCloseTo(MIN_FIELD.w);
  });
});
