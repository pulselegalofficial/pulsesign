import { ApiError, api, strings, toast } from './ui';
import type { RenderedPage } from './pdfview';

type FieldType = 'sig' | 'initial' | 'name' | 'date';
interface SField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG data URL for sig/initial, display text for name/date. */
  val: string | null;
}

const configEl = document.getElementById('signer-config');
if (configEl) void main(JSON.parse(configEl.textContent!));

async function main(cfg: { token: string; step: string; signerName: string; initials: string; today: string; email: string }) {
  const t = strings();
  const base = `/api/sign/${cfg.token}`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const steps = ['otp', 'consent', 'review'];
  let fields: SField[] = [];
  let pages: RenderedPage[] = [];
  let active = 0;
  let sigImg: string | null = null;
  let initImg: string | null = null;
  let sheetFor: number | null = null;
  let busy = false;

  function show(step: string) {
    document.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => (el.hidden = el.dataset.step !== step));
    const idx = steps.indexOf(step);
    $('stepper').hidden = idx < 0;
    document.querySelectorAll<HTMLElement>('.sstep').forEach((el, i) => el.classList.toggle('on', i <= idx));
    $('signbar').hidden = step !== 'review';
    window.scrollTo({ top: 0 });
    if (step === 'otp') setTimeout(() => $('otp-input').focus(), 50);
    if (step === 'review') void loadReview();
  }

  const errText = (e: unknown) => (e instanceof ApiError && t[e.code] ? t[e.code] : t.errGeneric);

  // ─── Landing / OTP ───
  $('start').addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await api<{ verified: boolean }>(`${base}/start`, { method: 'POST' });
      show(r.verified ? 'consent' : 'otp');
    } catch (err) {
      // A code sent moments ago is still valid; go and enter it.
      if (err instanceof ApiError && err.code === 'otpWait') show('otp');
      else toast(errText(err), true);
    } finally {
      b.disabled = false;
    }
  });

  const otpInput = $<HTMLInputElement>('otp-input');
  const boxes = [...document.querySelectorAll<HTMLElement>('.otp .box')];
  const paintOtp = () => {
    otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
    const v = otpInput.value;
    boxes.forEach((b, i) => {
      b.textContent = v[i] || '';
      b.classList.toggle('cur', i === v.length && document.activeElement === otpInput);
    });
    $<HTMLButtonElement>('verify-otp').disabled = v.length !== 6;
    $('otp-error').hidden = true;
  };
  otpInput.addEventListener('input', () => {
    paintOtp();
    if (otpInput.value.length === 6) void verify();
  });
  otpInput.addEventListener('focus', paintOtp);
  otpInput.addEventListener('blur', paintOtp);
  async function verify() {
    if (busy) return;
    busy = true;
    $<HTMLButtonElement>('verify-otp').disabled = true;
    try {
      await api(`${base}/verify`, { method: 'POST', json: { code: otpInput.value } });
      show('consent');
    } catch (e) {
      $('otp-error').textContent = errText(e);
      $('otp-error').hidden = false;
      otpInput.value = '';
      paintOtp();
      $('otp-error').hidden = false;
    } finally {
      busy = false;
    }
  }
  $('verify-otp').addEventListener('click', () => void verify());
  $('resend').addEventListener('click', async () => {
    try {
      await api(`${base}/start`, { method: 'POST' });
      toast(t.codeToast);
    } catch (e) {
      toast(errText(e), true);
    }
  });

  // ─── Consent ───
  const consentBox = $<HTMLInputElement>('consent-box');
  consentBox.addEventListener('change', () => ($<HTMLButtonElement>('consent-next').disabled = !consentBox.checked));
  $('consent-next').addEventListener('click', async (e) => {
    if (!consentBox.checked) return;
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await api(`${base}/consent`, { method: 'POST' });
      show('review');
    } catch (err) {
      toast(errText(err), true);
      b.disabled = false;
    }
  });

  // ─── Review & fill ───
  async function loadReview() {
    if (pages.length) return;
    try {
      const data = await api<{ fields: Omit<SField, 'val'>[] }>(`${base}/fields`);
      fields = data.fields
        .map((f) => ({ ...f, val: null as string | null }))
        .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
      for (const f of fields) {
        if (f.type === 'name') f.val = cfg.signerName;
      }
      const { renderPdf } = await import('./pdfview');
      pages = await renderPdf(`${base}/file`, $('sign-pages'));
      active = fields.findIndex((f) => !f.val);
      paintFields();
      paintBar();
      if (active >= 0) setTimeout(() => scrollToField(active), 300);
    } catch (e) {
      console.error(e);
      $('sign-pages').textContent = t.errGeneric;
    }
  }

  const isImg = (f: SField) => f.type === 'sig' || f.type === 'initial';

  function paintFields() {
    for (const p of pages) {
      p.layer.replaceChildren(
        ...fields
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.page === p.num)
          .map(({ f, i }) => {
            const el = document.createElement('button');
            el.type = 'button';
            el.id = `fld-${f.id}`;
            el.className = `sfld${f.val ? ' filled' : ''}${i === active && !f.val ? ' active' : ''}`;
            el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`;
            const label = f.type === 'sig' ? t.fSig : f.type === 'initial' ? t.fInitial : f.type === 'date' ? t.fDate : t.fName;
            el.setAttribute('aria-label', label);
            if (f.val && isImg(f)) {
              const img = document.createElement('img');
              img.src = f.val;
              img.alt = label;
              el.appendChild(img);
            } else if (f.val) {
              const s = document.createElement('span');
              s.className = 'txt';
              s.textContent = f.val;
              el.appendChild(s);
            } else {
              el.appendChild(document.createTextNode(label));
              if (i === active) {
                const flag = document.createElement('span');
                flag.className = 'flag';
                flag.textContent = isImg(f) ? t.here : t.hereFill;
                el.appendChild(flag);
              }
            }
            el.addEventListener('click', () => fill(i, true));
            return el;
          })
      );
    }
  }

  function paintBar() {
    const total = fields.length;
    const done = fields.filter((f) => f.val).length;
    const all = done === total;
    const af = fields[active];
    const name = (f: SField) => (f.type === 'sig' ? t.fSig : f.type === 'initial' ? t.fInitial : f.type === 'date' ? t.fDate : t.fName);
    $('sb-label').textContent = all ? t.allDone : `${t.fieldOf} ${Math.max(active, 0) + 1} ${t.of} ${total} · ${af ? name(af) : ''}`;
    $('sb-fill').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
    const btn = $<HTMLButtonElement>('sb-action');
    btn.textContent = busy ? t.submitting : all ? t.finish : af && isImg(af) ? t.tapToSign : t.tapToFill;
    btn.className = `btn btn-lg ${all ? 'btn-pulse' : ''}`;
    btn.disabled = busy;
  }

  function scrollToField(i: number) {
    const f = fields[i];
    const el = f && document.getElementById(`fld-${f.id}`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.35, behavior: 'smooth' });
  }

  function setVal(i: number, val: string | null) {
    fields[i].val = val;
    active = fields.findIndex((f) => !f.val);
    paintFields();
    paintBar();
    if (active >= 0) scrollToField(active);
  }

  function fill(i: number, fromTap: boolean) {
    const f = fields[i];
    if (!f) return;
    if (f.val && fromTap) {
      // Tapping a filled signature lets the signer redo it.
      if (isImg(f)) openSheet(i);
      return;
    }
    if (isImg(f)) {
      const img = f.type === 'sig' ? sigImg : initImg;
      if (img) setVal(i, img);
      else openSheet(i);
    } else {
      setVal(i, f.type === 'name' ? cfg.signerName : cfg.today);
    }
  }

  $('sb-action').addEventListener('click', async () => {
    if (busy) return;
    if (fields.some((f) => !f.val)) {
      fill(active >= 0 ? active : fields.findIndex((f) => !f.val), false);
      return;
    }
    busy = true;
    paintBar();
    try {
      const images: Record<string, string> = {};
      for (const f of fields) if (isImg(f) && f.val) images[f.id] = f.val;
      await api(`${base}/submit`, { method: 'POST', json: { images } });
      location.reload();
    } catch (e) {
      busy = false;
      paintBar();
      toast(errText(e), true);
    }
  });

  // ─── Signature sheet ───
  const sheet = $('sig-sheet');
  const pad = $<HTMLCanvasElement>('pad');
  let tab: 'draw' | 'type' | 'upload' = 'draw';
  let drawn = false;
  let uploadSrc: string | null = null;

  function openSheet(i: number) {
    sheetFor = i;
    const f = fields[i];
    $('sheet-title').textContent = f.type === 'initial' ? t.yourInitial : t.yourSig;
    $<HTMLInputElement>('typed').value = f.type === 'initial' ? cfg.initials : cfg.signerName;
    paintTyped();
    sheet.hidden = false;
    setTab('draw');
  }
  function closeSheet() {
    sheet.hidden = true;
    sheetFor = null;
  }
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || (e.target as HTMLElement).closest('[data-close]')) closeSheet();
  });

  function setTab(next: typeof tab) {
    tab = next;
    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    sheet.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (tab === 'draw') requestAnimationFrame(setupPad);
  }
  sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as typeof tab)));

  function setupPad() {
    const r = pad.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    pad.width = Math.round(r.width * dpr);
    pad.height = Math.round(r.height * dpr);
    const ctx = pad.getContext('2d')!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6 * dpr;
    ctx.strokeStyle = '#12261D';
    drawn = false;
  }
  let drawing = false;
  let last: [number, number] | null = null;
  const pos = (e: PointerEvent): [number, number] => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height];
  };
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    last = pos(e);
    const ctx = pad.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(last[0] + 0.1, last[1] + 0.1);
    ctx.stroke();
    drawn = true;
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing || !last) return;
    const p = pos(e);
    const ctx = pad.getContext('2d')!;
    // Smooth with a quadratic curve through the midpoint.
    const mid: [number, number] = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
    ctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid[0], mid[1]);
    last = p;
  });
  const stop = () => {
    drawing = false;
    last = null;
  };
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointercancel', stop);
  $('pad-clear').addEventListener('click', () => {
    pad.getContext('2d')!.clearRect(0, 0, pad.width, pad.height);
    drawn = false;
  });

  const typed = $<HTMLInputElement>('typed');
  const paintTyped = () => ($('typed-preview').textContent = typed.value || ' ');
  typed.addEventListener('input', paintTyped);

  $<HTMLInputElement>('sig-file').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      uploadSrc = String(reader.result);
      const img = $<HTMLImageElement>('sig-file-preview');
      img.src = uploadSrc;
      img.hidden = false;
      $('sig-file-empty').hidden = true;
    };
    reader.readAsDataURL(file);
  });

  /** Crops transparent / white margins so the signature fills its box on the PDF. */
  function trimmedPng(src: HTMLCanvasElement): string {
    const ctx = src.getContext('2d')!;
    const { width, height } = src;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        const white = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
        if (a > 10 && !white) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return '';
    const pad = Math.round(Math.max(width, height) * 0.02);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const scale = Math.min(1, 1200 / Math.max(w, h));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    out.getContext('2d')!.drawImage(src, minX, minY, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  async function imageToCanvas(src: string): Promise<HTMLCanvasElement> {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  $('adopt').addEventListener('click', async () => {
    if (sheetFor === null) return;
    let data = '';
    if (tab === 'draw') {
      if (!drawn) return toast(t.drawFirst, true);
      data = trimmedPng(pad);
    } else if (tab === 'type') {
      const text = typed.value.trim();
      if (!text) return toast(t.typeFirst, true);
      try {
        await document.fonts.load('96px Sriracha', text);
      } catch {
        /* fall back to the default cursive font */
      }
      const c = document.createElement('canvas');
      c.width = 1400;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#12261D';
      ctx.font = '120px Sriracha, cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 700, 160, 1340);
      data = trimmedPng(c);
    } else {
      if (!uploadSrc) return toast(t.uploadFirst, true);
      data = trimmedPng(await imageToCanvas(uploadSrc)) || '';
    }
    if (!data) return toast(tab === 'draw' ? t.drawFirst : t.uploadFirst, true);
    const f = fields[sheetFor];
    if (f.type === 'sig') sigImg = data;
    else initImg = data;
    // Redoing a signature replaces it everywhere it was already applied.
    fields.forEach((x) => {
      if (x.type === f.type && x.val) x.val = data;
    });
    const i = sheetFor;
    closeSheet();
    setVal(i, data);
  });

  // ─── Decline ───
  const decline = $('decline-sheet');
  let reason: string | null = null;
  const note = $<HTMLTextAreaElement>('decline-note');
  const declineOk = () => ($<HTMLButtonElement>('confirm-decline').disabled = !reason && !note.value.trim());
  document.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => (decline.hidden = false)));
  decline.addEventListener('click', (e) => {
    if (e.target === decline || (e.target as HTMLElement).closest('[data-close]')) decline.hidden = true;
  });
  decline.querySelectorAll<HTMLButtonElement>('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => {
      reason = reason === b.dataset.reason ? null : b.dataset.reason!;
      decline.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.reason === reason));
      declineOk();
    })
  );
  note.addEventListener('input', declineOk);
  $('confirm-decline').addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await api(`${base}/decline`, { method: 'POST', json: { reason: [reason, note.value.trim()].filter(Boolean).join(' · ') } });
      location.reload();
    } catch (err) {
      toast(errText(err), true);
      b.disabled = false;
    }
  });

  window.addEventListener('resize', () => paintFields());
  show(cfg.step);
}
