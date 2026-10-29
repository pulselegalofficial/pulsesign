import { ApiError, api, strings, toast } from './ui';
import type { RenderedPage } from './pdfview';

type FieldType = 'sig' | 'initial' | 'name' | 'date' | 'stamp';
interface SField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG data URL for sig/initial/stamp, display text for name/date. */
  val: string | null;
}

/** A field another signer has already filled; shown read-only. */
interface OtherField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  signer: string;
  text: string | null;
}
interface CoSigner {
  name: string;
  me: boolean;
  signed: boolean;
  signedAt: number | null;
}
interface FieldsResponse {
  fields: Omit<SField, 'val'>[];
  others: OtherField[];
  signers: CoSigner[];
}

/** How often the signing page checks whether someone else has signed. */
const POLL_MS = 20_000;

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
  /** The company seal: one image for every seal field, plus what the signer states. */
  let stampImg: string | null = null;
  let stampEntity = '';
  let stampAuthority = false;
  let sheetFor: number | null = null;
  let busy = false;
  let others: OtherField[] = [];
  let coSigners: CoSigner[] = [];
  let pollTimer: number | undefined;

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
      const data = await api<FieldsResponse>(`${base}/fields`);
      others = data.others || [];
      coSigners = data.signers || [];
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
      paintCoSigners();
      startPolling();
      if (active >= 0) setTimeout(() => scrollToField(active), 300);
    } catch (e) {
      console.error(e);
      $('sign-pages').textContent = t.errGeneric;
    }
  }

  const isImg = (f: { type: FieldType }) => f.type === 'sig' || f.type === 'initial' || f.type === 'stamp';
  const fieldName = (type: FieldType) =>
    type === 'sig' ? t.fSig : type === 'initial' ? t.fInitial : type === 'stamp' ? t.fStamp : type === 'date' ? t.fDate : t.fName;
  const fillIn = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

  /** What other signers have already put on the page; not interactive. */
  function otherEl(o: OtherField) {
    const el = document.createElement('div');
    el.className = o.type === 'stamp' ? 'ofld stamp' : 'ofld';
    el.style.cssText = `left:${o.x * 100}%;top:${o.y * 100}%;width:${o.w * 100}%;height:${o.h * 100}%`;
    const by = fillIn(t.coSignedBy, { name: o.signer });
    el.title = `${fieldName(o.type)} · ${by}`;
    if (isImg(o)) {
      const img = document.createElement('img');
      img.src = `${base}/field-image/${encodeURIComponent(o.id)}`;
      img.alt = el.title;
      el.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.className = 'txt';
      s.textContent = o.text || '';
      el.appendChild(s);
    }
    const tag = document.createElement('span');
    tag.className = 'otag';
    tag.textContent = o.signer;
    el.appendChild(tag);
    return el;
  }

  function paintCoSigners() {
    const box = $('co-signers');
    if (!box) return;
    // Nothing to show when this signer is the only one.
    box.hidden = coSigners.length < 2;
    box.replaceChildren(
      ...coSigners.map((c) => {
        const chip = document.createElement('span');
        chip.className = `co-chip${c.signed ? ' done' : ''}${c.me ? ' me' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'co-dot';
        dot.textContent = c.signed ? '✓' : '';
        chip.appendChild(dot);
        const name = document.createElement('span');
        name.className = 'co-name';
        name.textContent = c.me ? `${c.name} (${t.coYou})` : c.name;
        chip.appendChild(name);
        const st = document.createElement('span');
        st.className = 'co-st';
        st.textContent = c.signed ? t.coSigned : t.coPending;
        chip.appendChild(st);
        return chip;
      })
    );
  }

  /** Picks up signatures added by others while this page is open. */
  function startPolling() {
    if (pollTimer || coSigners.length < 2) return;
    pollTimer = window.setInterval(async () => {
      if (document.hidden || busy || !coSigners.some((c) => !c.me && !c.signed)) return;
      try {
        const data = await api<FieldsResponse>(`${base}/fields`);
        // Same order every time (by signing position).
        const fresh = (data.signers || []).filter((c, i) => c.signed && !c.me && !coSigners[i]?.signed);
        coSigners = data.signers || coSigners;
        others = data.others || others;
        paintCoSigners();
        if (fresh.length) {
          paintFields();
          for (const c of fresh) toast(fillIn(t.coJustSigned, { name: c.name }));
        }
      } catch {
        // The link may have been revoked or the page left open too long; stop quietly.
        window.clearInterval(pollTimer);
      }
    }, POLL_MS);
  }

  function paintFields() {
    for (const p of pages) {
      p.layer.replaceChildren(
        ...others.filter((o) => o.page === p.num).map(otherEl),
        ...fields
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.page === p.num)
          .map(({ f, i }) => {
            const el = document.createElement('button');
            el.type = 'button';
            el.id = `fld-${f.id}`;
            el.className = `sfld${f.val ? ' filled' : ''}${i === active && !f.val ? ' active' : ''}${f.type === 'stamp' ? ' stamp' : ''}`;
            el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`;
            const label = fieldName(f.type);
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
                flag.textContent = f.type === 'stamp' ? t.stampHint : isImg(f) ? t.here : t.hereFill;
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
    $('sb-label').textContent = all ? t.allDone : `${t.fieldOf} ${Math.max(active, 0) + 1} ${t.of} ${total} · ${af ? fieldName(af.type) : ''}`;
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
    if (f.type === 'stamp') {
      if (stampImg && !(f.val && fromTap)) setVal(i, stampImg);
      else openStampSheet(i);
      return;
    }
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
      const sealing = fields.some((f) => f.type === 'stamp');
      await api(`${base}/submit`, {
        method: 'POST',
        json: { images, ...(sealing ? { stamp: { entity: stampEntity, authority: stampAuthority } } : {}) },
      });
      window.clearInterval(pollTimer);
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

  // ─── Company seal ───
  //
  // The signer uploads a photo or scan of the seal. The paper is made
  // transparent here in the browser (nothing heavy runs on the server): each
  // pixel's darkness becomes its opacity, and the colour is either recovered
  // from the photo or replaced with a clean red or blue ink.
  const stampSheet = $('stamp-sheet');
  const stampFile = $<HTMLInputElement>('stamp-file');
  const stampPreview = $<HTMLCanvasElement>('stamp-preview');
  const stampClean = $<HTMLInputElement>('stamp-clean');
  const stampEntityInput = $<HTMLInputElement>('stamp-entity');
  const stampAuthBox = $<HTMLInputElement>('stamp-authority');
  const INKS: Record<string, [number, number, number] | null> = { original: null, red: [196, 30, 45], blue: [28, 58, 160] };
  let stampFor: number | null = null;
  let stampSource: HTMLCanvasElement | null = null;
  let ink = 'original';

  function openStampSheet(i: number) {
    stampFor = i;
    stampEntityInput.value = stampEntity;
    stampAuthBox.checked = stampAuthority;
    stampSheet.hidden = false;
  }
  stampSheet.addEventListener('click', (e) => {
    if (e.target === stampSheet || (e.target as HTMLElement).closest('[data-close]')) {
      stampSheet.hidden = true;
      stampFor = null;
    }
  });

  /** Paper → transparent, ink → opaque. Returns a new canvas. */
  function cleanStamp(src: HTMLCanvasElement): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    // Pixels lighter than `hi` count as paper; darker than `lo` as full ink.
    const hi = 248 - Number(stampClean.value) * 1.1;
    const lo = Math.max(0, hi - 110);
    const tint = INKS[ink];
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      // Use the darkest channel too, so saturated red ink is not mistaken for paper.
      const lum = Math.min(0.299 * r + 0.587 * g + 0.114 * b, Math.min(r, g, b) + 60);
      let a = lum >= hi ? 0 : lum <= lo ? 1 : (hi - lum) / (hi - lo);
      a *= d[p + 3] / 255;
      if (tint) {
        d[p] = tint[0];
        d[p + 1] = tint[1];
        d[p + 2] = tint[2];
      } else if (a > 0) {
        // Undo the white paper showing through: c = a·ink + (1−a)·255.
        d[p] = Math.max(0, Math.min(255, (r - 255 * (1 - a)) / a));
        d[p + 1] = Math.max(0, Math.min(255, (g - 255 * (1 - a)) / a));
        d[p + 2] = Math.max(0, Math.min(255, (b - 255 * (1 - a)) / a));
      }
      d[p + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  function paintStamp() {
    if (!stampSource) return;
    const cleaned = cleanStamp(stampSource);
    stampPreview.width = cleaned.width;
    stampPreview.height = cleaned.height;
    const ctx = stampPreview.getContext('2d')!;
    ctx.clearRect(0, 0, cleaned.width, cleaned.height);
    ctx.drawImage(cleaned, 0, 0);
  }

  stampFile.addEventListener('change', () => {
    const file = stampFile.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Seals are small on the page; 900 px is plenty and keeps the PNG light.
        const img = new Image();
        img.src = String(reader.result);
        await img.decode();
        const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        stampSource = c;
        $('stamp-empty').hidden = true;
        stampPreview.hidden = false;
        $('stamp-tools').hidden = false;
        paintStamp();
      } catch {
        toast(t.stampNeedImage, true);
      }
    };
    reader.readAsDataURL(file);
  });
  stampSheet.querySelectorAll<HTMLButtonElement>('[data-ink]').forEach((b) =>
    b.addEventListener('click', () => {
      ink = b.dataset.ink!;
      stampSheet.querySelectorAll('[data-ink]').forEach((x) => x.classList.toggle('on', x === b));
      paintStamp();
    })
  );
  stampClean.addEventListener('input', paintStamp);

  $('adopt-stamp').addEventListener('click', () => {
    if (stampFor === null) return;
    const entity = stampEntityInput.value.trim();
    if (!stampSource && !stampImg) return toast(t.stampNeedImage, true);
    if (!entity) return toast(t.stampNeedEntity, true);
    if (!stampAuthBox.checked) return toast(t.stampNeedAuthority, true);
    const data = stampSource ? trimmedPng(cleanStamp(stampSource)) : stampImg;
    if (!data) return toast(t.stampNeedImage, true);
    stampImg = data;
    stampEntity = entity;
    stampAuthority = true;
    // One seal per signer: a new image replaces it in every seal field.
    fields.forEach((x) => {
      if (x.type === 'stamp' && x.val) x.val = data;
    });
    const i = stampFor;
    stampSheet.hidden = true;
    stampFor = null;
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
