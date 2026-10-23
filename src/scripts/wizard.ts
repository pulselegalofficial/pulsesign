import { ApiError, api, fill, h, isEmail, strings, toast } from './ui';
import { renderPdf, type RenderedPage } from './pdfview';

type FieldType = 'sig' | 'initial' | 'name' | 'date';
interface Field {
  id: string;
  signer: number;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Signer {
  name: string;
  email: string;
}
interface DocData {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  pages: number;
  sequential: boolean;
  subject: string;
  message: string;
  expiryDays: number;
}

const t = strings();
const config = JSON.parse(document.getElementById('wizard-config')!.textContent!) as {
  id: string | null;
  me: { name: string; email: string };
  org: string;
};

/** Default field sizes: width as a fraction of page width, height in the same unit. */
const SIZE: Record<FieldType, { w: number; h: number }> = {
  sig: { w: 0.3, h: 0.09 },
  initial: { w: 0.14, h: 0.065 },
  date: { w: 0.22, h: 0.055 },
  name: { w: 0.34, h: 0.055 },
};
const TYPE_LABEL: Record<FieldType, string> = { sig: t.fSig, initial: t.fInitial, date: t.fDate, name: t.fName };
const COLORS = [
  { bg: '#CFE7D8', b: '#00412F', dot: '#7FC29C' },
  { bg: '#FFE3CC', b: '#FF7A12', dot: '#FFB27A' },
  { bg: '#E2E4F6', b: '#4B57A6', dot: '#9DA5DE' },
  { bg: '#F4E0EE', b: '#9A3D80', dot: '#D79CC6' },
];
const color = (i: number) => COLORS[i % COLORS.length];
const STEP_TITLES = [t.ws1, t.ws2, t.ws3, t.ws4];
const STEP_SUBS = [t.wsSub1, t.wsSub2, t.wsSub3, t.wsSub4];

const state = {
  step: 0,
  doc: null as DocData | null,
  signers: [] as Signer[],
  fields: [] as Field[],
  armed: null as { type: FieldType; signer: number } | null,
  selected: null as string | null,
  pages: [] as RenderedPage[],
  pdfLoadedFor: '' as string,
  busy: false,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const uid = () => Math.random().toString(36).slice(2, 10);

// ─────────────── Persistence ───────────────

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<void> = Promise.resolve();
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 600);
}
let sent = false;
function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!state.doc || sent) return Promise.resolve();
  const d = state.doc;
  const body = {
    title: d.title,
    sequential: d.sequential,
    subject: d.subject,
    message: d.message,
    expiryDays: d.expiryDays,
    signers: state.signers,
    fields: state.fields.map(({ id: _id, ...f }) => f),
  };
  savePromise = savePromise.then(() =>
    api(`/api/docs/${d.id}`, { method: 'PUT', json: body }).then(
      () => undefined,
      () => toast(t.errGeneric, true)
    )
  );
  return savePromise;
}

async function load(id: string) {
  const data = await api<{ doc: DocData; signers: Signer[]; fields: Omit<Field, 'id'>[] }>(`/api/docs/${id}`);
  state.doc = data.doc;
  state.signers = data.signers.length ? data.signers : [{ name: '', email: '' }];
  state.fields = data.fields.map((f) => ({ ...f, id: uid() }));
  if (!state.doc.subject) state.doc.subject = fill(t.defSubject, { title: state.doc.title });
  if (!state.doc.message) state.doc.message = t.defMsg;
}

// ─────────────── Validation ───────────────

const signersOk = () =>
  state.signers.length > 0 &&
  state.signers.every((s) => s.name.trim() && isEmail(s.email.trim())) &&
  new Set(state.signers.map((s) => s.email.trim().toLowerCase())).size === state.signers.length;
const allHaveSig = () => state.signers.every((_, i) => state.fields.some((f) => f.signer === i && f.type === 'sig'));
const stepOk = (i: number) => [!!state.doc, signersOk(), allHaveSig(), true][i];
const canReach = (i: number) => [0, 1, 2, 3].slice(0, i).every(stepOk);

// ─────────────── Rendering ───────────────

function renderSteps() {
  document.querySelectorAll<HTMLElement>('#steps .step').forEach((el, i) => {
    el.classList.toggle('reached', i <= state.step);
    el.classList.toggle('current', i === state.step);
    el.classList.toggle('done', i < state.step || (i !== state.step && canReach(i) && i < state.step));
    el.querySelector('.dot')!.textContent = i < state.step ? '✓' : String(i + 1);
    const btn = el.querySelector('button')!;
    btn.disabled = !(i < state.step || (i > state.step && canReach(i)));
    if (i > state.step && canReach(i)) el.classList.add('done');
  });
  $('wiz-title').textContent = STEP_TITLES[state.step];
  $('wiz-sub').textContent = STEP_SUBS[state.step];
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = Number(p.dataset.pane) !== state.step));
}

function renderActionBar() {
  const s = state.step;
  const msgs = [
    state.doc ? state.doc.fileName : t.needFile,
    signersOk() ? `${state.signers.length} ${t.signersN} · ${state.doc?.sequential ? t.seqOn : t.seqOff}` : t.needSigners,
    allHaveSig() ? `${state.fields.length} ${t.fieldsUnit}` : t.needSig,
    t.readySend,
  ];
  const status = $('ab-status');
  status.textContent = msgs[s];
  status.classList.toggle('warn', !stepOk(s));
  const back = $<HTMLButtonElement>('back-btn');
  back.hidden = s === 0;
  const next = $<HTMLButtonElement>('next-btn');
  next.textContent = state.busy ? (s === 3 ? t.sending : t.saving) : s === 3 ? t.send : t.next;
  next.className = s === 3 ? 'btn btn-pulse' : 'btn';
  next.disabled = !stepOk(s) || state.busy;
}

function renderUpload() {
  const d = state.doc;
  $('drop').hidden = !!d;
  $('file-card').hidden = !d;
  if (!d) return;
  $('file-name').textContent = d.fileName;
  $('file-info').textContent = `${d.pages} ${t.pagesUnit} · ${formatSize(d.fileSize)}`;
  const title = $<HTMLInputElement>('doc-title');
  if (document.activeElement !== title) title.value = d.title;
}

function formatSize(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderSigners() {
  const seq = state.doc?.sequential ?? true;
  $('signer-count').textContent = `${state.signers.length} ${t.signersN}`;
  $('seq-sub').textContent = seq ? t.seqOrderSub : t.seqOffSub;
  $<HTMLInputElement>('seq').checked = seq;
  const wrap = $('signer-rows');
  const focused = document.activeElement as HTMLInputElement | null;
  const focusKey = focused?.dataset.key;
  const caret = focused?.selectionStart;
  wrap.replaceChildren(
    ...state.signers.map((s, i) => {
      const emailBad = !!s.email && !isEmail(s.email.trim());
      const name = h('input', { class: 'input', value: s.name, maxlength: 200, autocomplete: 'off', 'data-key': `n${i}`, 'aria-label': t.fullName });
      const email = h('input', { class: `input${emailBad ? ' invalid' : ''}`, value: s.email, type: 'email', maxlength: 254, autocomplete: 'off', 'data-key': `e${i}`, 'aria-label': t.email });
      name.addEventListener('input', () => {
        s.name = name.value;
        changed(false);
      });
      email.addEventListener('input', () => {
        s.email = email.value;
        email.classList.toggle('invalid', !!email.value && !isEmail(email.value.trim()));
        changed(false);
      });
      const up = h('button', { type: 'button', title: t.moveUp, 'aria-label': t.moveUp, disabled: i === 0 }, '▲');
      const down = h('button', { type: 'button', title: t.moveDown, 'aria-label': t.moveDown, disabled: i === state.signers.length - 1 }, '▼');
      const rm = h('button', { type: 'button', class: 'rm', title: t.remove, 'aria-label': t.remove, disabled: state.signers.length < 2 }, '×');
      up.addEventListener('click', () => move(i, -1));
      down.addEventListener('click', () => move(i, 1));
      rm.addEventListener('click', () => removeSigner(i));
      return h(
        'div',
        { class: 'signer-row' },
        h('span', { class: 'num-dot', style: `background:${color(i).dot}` }, seq ? String(i + 1) : '•'),
        h('div', { class: 'field f-name' }, h('label', { text: t.fullName }), name),
        h('div', { class: 'field f-email' }, h('label', { text: t.email }), email),
        h('div', { class: 'ctl' }, up, down, rm)
      );
    })
  );
  if (focusKey) {
    const el = wrap.querySelector<HTMLInputElement>(`[data-key="${focusKey}"]`);
    if (el) {
      el.focus();
      if (caret != null) el.setSelectionRange(caret, caret);
    }
  }
  $<HTMLButtonElement>('add-me').disabled = state.signers.some((s) => s.email.trim().toLowerCase() === config.me.email);
  $<HTMLButtonElement>('add-signer').disabled = state.signers.length >= 10;
}

function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= state.signers.length) return;
  [state.signers[i], state.signers[j]] = [state.signers[j], state.signers[i]];
  state.fields.forEach((f) => (f.signer = f.signer === i ? j : f.signer === j ? i : f.signer));
  changed();
}

function removeSigner(i: number) {
  if (state.signers.length < 2) return;
  state.signers.splice(i, 1);
  state.fields = state.fields.filter((f) => f.signer !== i).map((f) => (f.signer > i ? { ...f, signer: f.signer - 1 } : f));
  changed();
}

function renderPlacePanel() {
  const isMobile = matchMedia('(max-width: 900px)').matches;
  document.querySelector('.how2')!.textContent = isMobile ? t.placeHow2M : t.placeHow2D;
  const seq = state.doc?.sequential ?? true;
  $('place-signers').replaceChildren(
    ...state.signers.map((s, i) => {
      const c = color(i);
      const mine = state.fields.filter((f) => f.signer === i);
      const hasSig = mine.some((f) => f.type === 'sig');
      const parts = (['sig', 'initial', 'name', 'date'] as FieldType[])
        .map((k) => {
          const n = mine.filter((f) => f.type === k).length;
          return n ? `${TYPE_LABEL[k]} ${n}` : null;
        })
        .filter(Boolean);
      const status = !mine.length ? t.noFields : parts.join(' · ') + (hasSig ? '' : ` · ${t.noSig}`);
      const armedHere = state.armed?.signer === i;
      const tools = (['sig', 'initial', 'name', 'date'] as FieldType[]).map((k) => {
        const on = armedHere && state.armed!.type === k;
        const b = h('button', { type: 'button', style: on ? `background:${c.bg};border-color:${c.b}` : undefined, 'aria-pressed': on ? 'true' : 'false' }, `+ ${TYPE_LABEL[k]}`);
        b.addEventListener('click', () => {
          state.armed = on ? null : { type: k, signer: i };
          state.selected = null;
          renderPlace();
        });
        return b;
      });
      return h(
        'div',
        { class: 'ps-card', style: armedHere ? `border-color:${c.b}` : undefined },
        h(
          'div',
          { class: 'ps-head' },
          h('span', { class: 'num-dot', style: `background:${c.dot}` }, seq ? String(i + 1) : '•'),
          h('div', { style: 'min-width:0' }, h('strong', { text: s.name || s.email || `#${i + 1}` }), h('span', { class: 'ps-status', style: hasSig ? 'color:var(--muted)' : 'color:var(--peach-ink);font-weight:600', text: status }))
        ),
        h('div', { class: 'ps-tools' }, ...tools)
      );
    })
  );
  const armed = $('armed');
  armed.hidden = !state.armed;
  $('pages').classList.toggle('arming', !!state.armed);
  if (state.armed) {
    const s = state.signers[state.armed.signer];
    (armed.querySelector('.armed-dot') as HTMLElement).style.background = color(state.armed.signer).dot;
    $('armed-label').textContent = `${t.placing}: ${TYPE_LABEL[state.armed.type]} ${t.placingFor} ${s?.name || ''} — ${isMobile ? t.placeHow2M : t.clickDoc}`;
  }
}

function renderFields() {
  for (const p of state.pages) {
    p.layer.replaceChildren(
      ...state.fields
        .filter((f) => f.page === p.num)
        .map((f) => {
          const c = color(f.signer);
          const sel = state.selected === f.id;
          const el = h(
            'div',
            {
              class: `fld${sel ? ' sel' : ''}`,
              style: `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;background:${c.bg}cc;border-color:${c.b};${sel ? `box-shadow:0 0 0 3px ${c.dot}` : ''}`,
              'data-id': f.id,
              tabindex: 0,
            },
            h('span', { text: `${TYPE_LABEL[f.type]} · ${(state.signers[f.signer]?.name || '?').split(' ')[0]}` })
          );
          const x = h('button', { class: 'x', type: 'button', 'aria-label': t.remove }, '×');
          x.addEventListener('pointerdown', (e) => e.stopPropagation());
          x.addEventListener('click', (e) => {
            e.stopPropagation();
            state.fields = state.fields.filter((q) => q.id !== f.id);
            state.selected = null;
            changed();
          });
          el.appendChild(x);
          el.addEventListener('pointerdown', (e) => startDrag(e, f, p));
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              state.fields = state.fields.filter((q) => q.id !== f.id);
              changed();
            }
          });
          return el;
        })
    );
  }
}

function startDrag(e: PointerEvent, f: Field, p: RenderedPage) {
  if (e.button > 0) return;
  e.stopPropagation();
  e.preventDefault();
  const r = p.el.getBoundingClientRect();
  const ox = (e.clientX - r.left) / r.width - f.x;
  const oy = (e.clientY - r.top) / r.height - f.y;
  const el = e.currentTarget as HTMLElement;
  state.selected = f.id;
  state.armed = null;
  renderPlacePanel();
  document.querySelectorAll('.fld.sel').forEach((x) => x !== el && x.classList.remove('sel'));
  el.classList.add('sel');
  let moved = false;
  const mv = (ev: PointerEvent) => {
    moved = true;
    f.x = Math.max(0, Math.min(1 - f.w, (ev.clientX - r.left) / r.width - ox));
    f.y = Math.max(0, Math.min(1 - f.h, (ev.clientY - r.top) / r.height - oy));
    el.style.left = `${f.x * 100}%`;
    el.style.top = `${f.y * 100}%`;
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (moved) scheduleSave();
    renderFields();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function onPageDown(e: PointerEvent, p: RenderedPage) {
  if (e.button > 0) return;
  if (!state.armed) {
    if (state.selected) {
      state.selected = null;
      renderFields();
    }
    return;
  }
  const r = p.el.getBoundingClientRect();
  const { type, signer } = state.armed;
  const w = SIZE[type].w;
  const hh = SIZE[type].h * p.aspect; // height is specified relative to page width
  const x = Math.max(0, Math.min(1 - w, (e.clientX - r.left) / r.width - w / 2));
  const y = Math.max(0, Math.min(1 - hh, (e.clientY - r.top) / r.height - hh / 2));
  const f: Field = { id: uid(), signer, type, page: p.num, x, y, w, h: hh };
  state.fields.push(f);
  state.selected = f.id;
  state.armed = null;
  changed();
}

async function renderPlace() {
  renderPlacePanel();
  if (state.doc && state.pdfLoadedFor !== `${state.doc.id}:${state.doc.fileSize}:${state.doc.pages}`) {
    state.pdfLoadedFor = `${state.doc.id}:${state.doc.fileSize}:${state.doc.pages}`;
    $('pages').replaceChildren(h('div', { class: 'pdf-loading', text: t.loadingPdf }));
    try {
      state.pages = await renderPdf(`/api/docs/${state.doc.id}/file?v=${Date.now()}`, $('pages'));
      state.pages.forEach((p) => p.el.addEventListener('pointerdown', (e) => onPageDown(e, p)));
    } catch (e) {
      console.error(e);
      state.pdfLoadedFor = '';
      $('pages').replaceChildren(h('div', { class: 'pdf-loading', text: t.errGeneric }));
    }
  }
  renderFields();
}

function renderReview() {
  const d = state.doc!;
  $('sum-file').textContent = d.fileName;
  $('sum-seq').textContent = `${state.signers.length} ${t.signersN} · ${d.sequential ? t.seqOn : t.seqOff}`;
  $('sum-signers').replaceChildren(
    ...state.signers.map((s, i) => {
      const n = state.fields.filter((f) => f.signer === i).length;
      return h(
        'div',
        { class: 'sum-signer' },
        h('span', { class: 'num-dot', style: `background:${color(i).dot}` }, d.sequential ? String(i + 1) : '•'),
        h('div', { class: 'who' }, h('strong', { text: s.name }), h('span', { class: 'small muted', text: s.email })),
        h('span', { class: 'small muted', text: `${n} ${t.fieldsUnit}` })
      );
    })
  );
  const subject = $<HTMLInputElement>('subject');
  const message = $<HTMLTextAreaElement>('message');
  if (document.activeElement !== subject) subject.value = d.subject;
  if (document.activeElement !== message) message.value = d.message;
  document.querySelectorAll<HTMLButtonElement>('#expiry button').forEach((b) => b.classList.toggle('on', Number(b.dataset.days) === d.expiryDays));
  renderPreview();
}

function renderPreview() {
  const d = state.doc!;
  $('pv-to').textContent = d.sequential ? state.signers[0]?.email || '—' : state.signers.map((s) => s.email).join(', ');
  $('pv-subject').textContent = d.subject || fill(t.defSubject, { title: d.title });
  $('pv-msg').textContent = d.message;
  $('pv-expiry').textContent = fill(t.expiryNote, { days: d.expiryDays });
}

function render() {
  renderSteps();
  renderActionBar();
  if (state.step === 0) renderUpload();
  if (state.step === 1) renderSigners();
  if (state.step === 2) void renderPlace();
  if (state.step === 3) renderReview();
}

function changed(rerender = true) {
  scheduleSave();
  if (rerender) render();
  else {
    renderActionBar();
    renderSteps();
    if (state.step === 1) {
      $('signer-count').textContent = `${state.signers.length} ${t.signersN}`;
      $<HTMLButtonElement>('add-me').disabled = state.signers.some((s) => s.email.trim().toLowerCase() === config.me.email);
    }
  }
}

function go(step: number) {
  if (step < 0 || step > 3) return;
  if (step > state.step && !canReach(step)) return;
  state.step = step;
  state.armed = null;
  state.selected = null;
  history.replaceState(null, '', `/new?id=${state.doc?.id ?? ''}&step=${step + 1}`);
  render();
  window.scrollTo({ top: 0 });
}

// ─────────────── Upload ───────────────

async function upload(file: File, replace: boolean) {
  const msg = $('upload-msg');
  const fail = (text: string) => {
    if (replace) toast(text, true);
    else {
      msg.textContent = text;
      msg.style.color = 'var(--danger)';
      msg.hidden = false;
    }
  };
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return fail(t.errNotPdf);
  if (file.size > 25 * 1024 * 1024) return fail(t.errTooLarge);
  msg.textContent = t.uploading;
  msg.style.color = '';
  msg.hidden = false;
  state.busy = true;
  renderActionBar();
  try {
    const form = new FormData();
    form.append('file', file);
    if (replace && state.doc) {
      await saveNow();
      await api(`/api/docs/${state.doc.id}/file`, { method: 'POST', body: form });
      await load(state.doc.id);
    } else {
      const { id } = await api<{ id: string }>('/api/docs', { method: 'POST', body: form });
      await load(id);
      history.replaceState(null, '', `/new?id=${id}&step=1`);
    }
    msg.hidden = true;
  } catch (e) {
    fail(e instanceof ApiError && t[e.code] ? t[e.code] : t.errGeneric);
  } finally {
    state.busy = false;
    render();
  }
}

// ─────────────── Wiring ───────────────

function wire() {
  const input = $<HTMLInputElement>('file-input');
  input.addEventListener('change', () => input.files?.[0] && upload(input.files[0], false));
  const replace = $<HTMLInputElement>('replace-input');
  replace.addEventListener('change', () => replace.files?.[0] && upload(replace.files[0], true));
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) upload(f, false);
  });
  $<HTMLInputElement>('doc-title').addEventListener('input', (e) => {
    if (!state.doc) return;
    const v = (e.target as HTMLInputElement).value;
    const oldDefault = fill(t.defSubject, { title: state.doc.title });
    if (state.doc.subject === oldDefault) state.doc.subject = fill(t.defSubject, { title: v });
    state.doc.title = v;
    changed(false);
  });
  $('delete-draft').addEventListener('click', async () => {
    if (!state.doc || !confirm(t.deleteDraftConfirm)) return;
    clearTimeout(saveTimer);
    await api(`/api/docs/${state.doc.id}`, { method: 'DELETE' }).catch(() => null);
    location.href = '/';
  });

  $<HTMLInputElement>('seq').addEventListener('change', (e) => {
    if (!state.doc) return;
    state.doc.sequential = (e.target as HTMLInputElement).checked;
    changed();
  });
  $('add-signer').addEventListener('click', () => {
    state.signers.push({ name: '', email: '' });
    changed();
    const rows = document.querySelectorAll<HTMLInputElement>('#signer-rows .f-name input');
    rows[rows.length - 1]?.focus();
  });
  $('add-me').addEventListener('click', () => {
    const empty = state.signers.findIndex((s) => !s.name.trim() && !s.email.trim());
    const me = { name: config.me.name, email: config.me.email };
    if (empty >= 0) state.signers[empty] = me;
    else state.signers.push(me);
    changed();
  });

  $('disarm').addEventListener('click', () => {
    state.armed = null;
    renderPlacePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.armed) {
      state.armed = null;
      renderPlacePanel();
    }
  });

  $<HTMLInputElement>('subject').addEventListener('input', (e) => {
    state.doc!.subject = (e.target as HTMLInputElement).value;
    renderPreview();
    scheduleSave();
  });
  $<HTMLTextAreaElement>('message').addEventListener('input', (e) => {
    state.doc!.message = (e.target as HTMLTextAreaElement).value;
    renderPreview();
    scheduleSave();
  });
  document.querySelectorAll<HTMLButtonElement>('#expiry button').forEach((b) =>
    b.addEventListener('click', () => {
      state.doc!.expiryDays = Number(b.dataset.days);
      changed();
    })
  );
  document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));
  document.querySelectorAll<HTMLElement>('#steps .step').forEach((el, i) => el.querySelector('button')!.addEventListener('click', () => go(i)));

  $('back-btn').addEventListener('click', () => go(state.step - 1));
  $('next-btn').addEventListener('click', async () => {
    if (!stepOk(state.step) || state.busy) return;
    if (state.step < 3) {
      if (state.step === 1) {
        state.signers.forEach((s) => {
          s.name = s.name.trim();
          s.email = s.email.trim().toLowerCase();
        });
        scheduleSave();
      }
      go(state.step + 1);
      return;
    }
    state.busy = true;
    renderActionBar();
    try {
      await saveNow();
      await api(`/api/docs/${state.doc!.id}/send`, { method: 'POST' });
      sent = true;
      location.href = `/docs/${state.doc!.id}?sent=1`;
    } catch (e) {
      toast(e instanceof ApiError && t[e.code] ? t[e.code] : t.errGeneric, true);
      state.busy = false;
      renderActionBar();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (saveTimer) void saveNow();
  });
}

async function init() {
  wire();
  if (config.id) {
    try {
      await load(config.id);
    } catch {
      location.href = '/';
      return;
    }
    const step = Number(new URLSearchParams(location.search).get('step')) - 1;
    state.step = step >= 0 && step <= 3 && canReach(step) ? step : 1;
  }
  render();
}

void init();
