// The legacy build is transpiled for older browsers (iOS 15/16 Safari, older
// Android WebViews, LINE's in-app browser), which signers often use.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export interface RenderedPage {
  /** 1-based page number. */
  num: number;
  /** Wrapper with position:relative; overlays go in `layer`. */
  el: HTMLDivElement;
  layer: HTMLDivElement;
  /** Displayed width / height (after /Rotate). */
  aspect: number;
}

/**
 * Renders every page of a PDF into `container`, each as a canvas with an
 * absolutely-positioned overlay layer on top. Pages are re-rendered sharper
 * when the container is resized; overlays use percentages so they follow.
 */
export async function renderPdf(url: string, container: HTMLElement): Promise<RenderedPage[]> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  container.replaceChildren();
  const pages: RenderedPage[] = [];
  const drawers: (() => Promise<void>)[] = [];

  for (let num = 1; num <= pdf.numPages; num++) {
    const page = await pdf.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.page = String(num);
    el.style.aspectRatio = `${base.width} / ${base.height}`;
    const canvas = document.createElement('canvas');
    const layer = document.createElement('div');
    layer.className = 'layer';
    el.appendChild(canvas);
    el.appendChild(layer);
    container.appendChild(el);
    pages.push({ num, el, layer, aspect: base.width / base.height });

    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let renderedWidth = 0;
    const draw = async () => {
      const cssWidth = el.clientWidth || container.clientWidth;
      if (!cssWidth || Math.abs(cssWidth - renderedWidth) < 2) return;
      renderedWidth = cssWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const ctx = canvas.getContext('2d')!;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task?.cancel();
      task = page.render({ canvasContext: ctx, viewport }) as unknown as { cancel(): void; promise: Promise<void> };
      try {
        await task.promise;
      } catch {
        /* cancelled by a newer render */
      }
    };
    drawers.push(draw);
  }

  // Draw the first pages right away, the rest when they scroll into view.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) drawers[Number((e.target as HTMLElement).dataset.page) - 1]();
      }
    },
    { rootMargin: '600px 0px' }
  );
  pages.forEach((p) => io.observe(p.el));
  await Promise.all(drawers.slice(0, 2).map((d) => d()));

  let resizeTimer: ReturnType<typeof setTimeout>;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      pages.forEach((p, i) => {
        const r = p.el.getBoundingClientRect();
        if (r.bottom > -800 && r.top < window.innerHeight + 800) drawers[i]();
      });
    }, 150);
  }).observe(container);

  return pages;
}
