import { describe, expect, it } from 'vitest';
import { clampField, displayedToPdf, fitContain, normalizeRotation, placeField } from '../lib/geometry';

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
