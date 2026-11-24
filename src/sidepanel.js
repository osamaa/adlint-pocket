// AdLint Pocket side panel.
import pack from './rules/rulepack.json';
import { checkCopy, groundAiFindings } from './engine/rules.js';
import { checkImageSpec, checkSafeZones } from './engine/image.js';
import { initFirebase, reviewCopy, reviewImage, deviceStatus, downloadDeviceModel, InferenceMode } from './engine/ai.js';

// Optional build-time defaults (from local.config.json, never committed). See build.mjs.
const BUILD_DEFAULTS = typeof __LOCAL_CONFIG__ !== 'undefined' ? __LOCAL_CONFIG__ : {};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let settings = { neverCloud: false, firebaseConfig: null, appCheckDebugToken: '', cloudModel: '' };
let nano = { text: 'unknown', image: 'unknown' };
let currentImage = null; // { file, bitmap, width, height, type, bytes, name, boxes }

// ---------- settings ----------
async function loadSettings() {
  const s = await chrome.storage.local.get(['settings']);
  settings = { ...settings, ...(s.settings || {}) };
  if (!settings.firebaseConfig && BUILD_DEFAULTS.firebase) settings.firebaseConfig = BUILD_DEFAULTS.firebase;
  // A token from your own build wins over an auto-generated one; one you typed in Settings wins over both.
  if (BUILD_DEFAULTS.appCheckDebugToken && settings.tokenSource !== 'user') {
    settings.appCheckDebugToken = BUILD_DEFAULTS.appCheckDebugToken;
    settings.tokenSource = 'build';
  }
  if (!settings.appCheckDebugToken) {
    settings.appCheckDebugToken = crypto.randomUUID();
    settings.tokenSource = 'auto';
  }
  if (!settings.cloudModel && BUILD_DEFAULTS.cloudModel) settings.cloudModel = BUILD_DEFAULTS.cloudModel;
  await chrome.storage.local.set({ settings });
  $('#s-never-cloud').checked = settings.neverCloud;
  $('#s-config').value = settings.firebaseConfig ? JSON.stringify(settings.firebaseConfig, null, 2) : '';
  $('#s-token').value = settings.appCheckDebugToken;
  $('#s-model').value = settings.cloudModel || '';
}

async function saveSettings() {
  const raw = $('#s-config').value.trim();
  let cfg = null;
  if (raw) {
    try {
      // Accept either pure JSON or the JS snippet the Firebase console shows.
      const obj = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      try {
        cfg = JSON.parse(obj);
      } catch {
        cfg = JSON.parse(obj.replace(/^\s*(\w+)\s*:/gm, '"$1":').replace(/'/g, '"').replace(/,\s*}/g, '}'));
      }
    } catch (e) {
      $('#save-msg').textContent = 'Config is not valid JSON.';
      return;
    }
  }
  const changed = JSON.stringify(cfg) !== JSON.stringify(settings.firebaseConfig) || $('#s-token').value.trim() !== settings.appCheckDebugToken;
  settings.firebaseConfig = cfg;
  if ($('#s-token').value.trim() !== settings.appCheckDebugToken) settings.tokenSource = 'user';
  settings.appCheckDebugToken = $('#s-token').value.trim();
  settings.cloudModel = $('#s-model').value.trim();
  settings.neverCloud = $('#s-never-cloud').checked;
  await chrome.storage.local.set({ settings });
  // Firebase and App Check debug mode are set up once per page: reload to apply a new project or token.
  if (changed) return location.reload();
  $('#save-msg').textContent = 'Saved.';
  setTimeout(() => ($('#save-msg').textContent = ''), 2000);
  refreshPills();
}

function ensureFirebase() {
  return initFirebase(settings.firebaseConfig, settings.appCheckDebugToken);
}

// ---------- status pills ----------
async function refreshPills() {
  nano.text = await deviceStatus('text');
  nano.image = await deviceStatus('image');
  const pd = $('#pill-device');
  pd.textContent = `Gemini Nano: ${label(nano.text)}`;
  pd.className = 'pill ' + (nano.text === 'available' ? 'ok' : 'bad');
  const pc = $('#pill-cloud');
  if (settings.neverCloud) {
    pc.textContent = 'Cloud: never (local only)';
    pc.className = 'pill off';
  } else if (!settings.firebaseConfig) {
    pc.textContent = 'Cloud: not set up';
    pc.className = 'pill bad';
  } else {
    pc.textContent = 'Cloud: only with your OK';
    pc.className = 'pill ok';
  }
  $('#s-nano-text').textContent = label(nano.text);
  $('#s-nano-image').textContent = label(nano.image);
  updateImageButtons();
}
const label = (s) => ({ available: 'ready on this device', downloadable: 'not downloaded yet', downloading: 'downloading', unavailable: 'not supported here', 'no-api': 'Prompt API missing' })[s] || s;

// ---------- tabs ----------
$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  }),
);

// ---------- copy tab ----------
const selected = (name) => $$(`input[name=${name}]:checked`).map((i) => i.value);

function updateFieldVisibility() {
  const p = selected('platform');
  $$('.field').forEach((f) => {
    const k = f.dataset.for;
    const show = k === 'meta' ? p.some((x) => x.startsWith('meta_')) : p.includes(k);
    f.classList.toggle('hidden', !show);
  });
}
$$('input[name=platform]').forEach((i) => i.addEventListener('change', updateFieldVisibility));

function updateCounts() {
  $$('[data-count]').forEach((el) => {
    const v = $('#' + el.dataset.count).value;
    el.textContent = v ? `${[...v].length} chars` : '';
  });
}
['#f-primary', '#f-meta-headline'].forEach((s) => $(s).addEventListener('input', updateCounts));

function readAd() {
  return {
    primary: $('#f-primary').value,
    metaHeadline: $('#f-meta-headline').value,
    gHeadlines: $('#f-g-headlines').value,
    gDescriptions: $('#f-g-descriptions').value,
    gPaths: $('#f-g-paths').value,
  };
}
// Meta and Google name their fields differently; map the form to each platform's fields.
const adFor = (a) => (pid) =>
  pid === 'google_search_rsa'
    ? { headline: a.gHeadlines, description: a.gDescriptions, path: a.gPaths }
    : { primary_text: a.primary, headline: pid === 'meta_facebook_feed' ? a.metaHeadline : '' };

// What the AI reviewer sees (only the fields for the chosen placements).
function adForAi(a, platforms) {
  const out = {};
  if (platforms.some((p) => p.startsWith('meta_'))) {
    out.primary_text = a.primary;
    if (platforms.includes('meta_facebook_feed')) out.headline = a.metaHeadline;
  }
  if (platforms.includes('google_search_rsa')) {
    out.headline = [out.headline, a.gHeadlines].filter(Boolean).join('\n');
    out.description = a.gDescriptions;
    out.path = a.gPaths;
  }
  return out;
}

const EXAMPLES = [
  {
    primary: 'Tired of your ugly skin? Glowberry Skin Lab\'s miracle serum is clinically proven to give you clear skin in 7 days, guaranteed! The best serum in Dubai. Today only: FREE shipping on every order, so grab yours before it sells out.',
    metaHeadline: 'Clear skin in 7 days, guaranteed',
    gHeadlines: 'GLOWBERRY Serum Sale!!\nClear Skin in 7 Days\nThe #1 Serum in Dubai\nShop Glowberry Skin Lab',
    gDescriptions: 'Our miracle serum is clinically proven to clear acne fast. Free shipping today only, so order now.\nDermatologist-tested formula with a 30-day return policy.',
    gPaths: 'serum\nclear-skin-in-7-days',
  },
  {
    primary: 'Say goodbye to breakouts for good. Dermatologists can\'t believe what one drop of Glowberry Night Oil does to stubborn acne. Your friends will finally stop staring at your face.',
    metaHeadline: 'Acne gone. Forever.',
    gHeadlines: 'Glowberry Night Oil\nAcne Gone For Good\nLoved by 10,000 Users',
    gDescriptions: 'One drop a night and stubborn acne never comes back. Dermatologists are amazed.\nVegan, cruelty-free, made in small batches.',
    gPaths: 'night-oil',
  },
];
function loadExample(i) {
  const e = EXAMPLES[i];
  $('#f-primary').value = e.primary;
  $('#f-meta-headline').value = e.metaHeadline;
  $('#f-g-headlines').value = e.gHeadlines;
  $('#f-g-descriptions').value = e.gDescriptions;
  $('#f-g-paths').value = e.gPaths;
  updateCounts();
}
$('#btn-example').addEventListener('click', () => loadExample(0));
$('#btn-example2').addEventListener('click', () => loadExample(1));
$('#btn-clear').addEventListener('click', () => {
  ['#f-primary', '#f-meta-headline', '#f-g-headlines', '#f-g-descriptions', '#f-g-paths'].forEach((s) => ($(s).value = ''));
  $('#results-copy').innerHTML = '';
  updateCounts();
});

let pendingCloudCopy = null;

$('#btn-check').addEventListener('click', async () => {
  const platforms = selected('platform');
  const a = readAd();
  const out = $('#results-copy');
  $('#consent-copy').hidden = true;
  if (!platforms.length) return (out.innerHTML = '<div class="error">Pick at least one placement.</div>');

  // 1) Rule pack: instant, local, deterministic.
  const t0 = performance.now();
  const res = checkCopy(pack, adFor(a), platforms);
  const ms = Math.max(1, Math.round(performance.now() - t0));
  out.innerHTML = '';
  out.append(runHeader('Rule pack', 'rules', `${ms} ms · ${pack.rules.length} rules with sources`));
  out.append(renderFindings(res.findings, res.passed));

  // 2) AI review through Firebase AI Logic (hybrid).
  const aiBox = document.createElement('div');
  out.append(aiBox);
  const aiAd = adForAi(a, platforms);
  if (!Object.values(aiAd).some((v) => (v || '').trim())) return;

  const status = await deviceStatus('text');
  if (status === 'available') {
    return runCopyAi(aiBox, aiAd, platforms, settings.neverCloud ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE, res.findings);
  }
  if (settings.neverCloud) {
    aiBox.innerHTML = `<div class="note">AI review skipped: Gemini Nano is ${esc(label(status))}, and "never send to cloud" is on. The rule pack results above are complete.</div>`;
    return;
  }
  if (!settings.firebaseConfig) {
    aiBox.innerHTML = `<div class="note">AI review skipped: Gemini Nano is ${esc(label(status))} and no Firebase project is set up for the cloud fallback (Settings).</div>`;
    return;
  }
  // Ask before falling back to the cloud.
  $('#consent-copy-status').textContent = label(status);
  $('#consent-copy').hidden = false;
  pendingCloudCopy = { aiBox, aiAd, platforms, found: res.findings };
});

$('#btn-copy-cloud-yes').addEventListener('click', () => {
  $('#consent-copy').hidden = true;
  if (!pendingCloudCopy) return;
  const { aiBox, aiAd, platforms, found } = pendingCloudCopy;
  pendingCloudCopy = null;
  // PREFER_ON_DEVICE: the SDK sees Nano isn't available and falls back to Gemini in the cloud.
  runCopyAi(aiBox, aiAd, platforms, InferenceMode.PREFER_ON_DEVICE, found);
});
$('#btn-copy-cloud-no').addEventListener('click', () => {
  $('#consent-copy').hidden = true;
  if (pendingCloudCopy) pendingCloudCopy.aiBox.innerHTML = '<div class="note">AI review skipped: kept local. The rule pack results above are complete.</div>';
  pendingCloudCopy = null;
});

async function runCopyAi(box, aiAd, platforms, mode, found = []) {
  box.innerHTML = `<div class="run"><span class="spinner"></span> AI review (${mode === InferenceMode.ONLY_ON_DEVICE ? 'on this device only' : 'on-device first'})…</div>`;
  try {
    ensureFirebaseIfPossible();
    const r = await reviewCopy(pack, aiAd, platforms, mode, settings.cloudModel, found);
    const grounded = groundAiFindings(pack, platforms, r.data.findings, Object.values(aiAd).join('\n'));
    const dropped = grounded.dropped;
    // Don't repeat what the rule pack already showed (same rule on the same words).
    const seen = new Set(found.map((f) => `${f.rule_id}|${(f.match || '').toLowerCase().trim()}`));
    const kept = grounded.kept.filter((f) => !seen.has(`${f.rule_id}|${f.excerpt.toLowerCase().trim()}`));
    box.innerHTML = '';
    box.append(runHeader('AI review', r.source, `${r.ms} ms · ${sourceLabel(r.source, r.model)}${dropped.length ? ` · ${dropped.length} finding(s) dropped: no matching sourced rule for this ad` : ''}`));
    if (r.data.summary) {
      const s = document.createElement('div');
      s.className = 'note';
      s.textContent = r.data.summary;
      box.append(s);
    }
    box.append(renderFindings(kept, [], true));
    console.log('[AdLint Pocket] AI review', { inferenceSource: r.source, raw: r.data, dropped });
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="error">AI review failed: ${esc(e.message || e)}</div>`;
  }
}

// On-device inference still goes through the Firebase AI Logic SDK, which needs an initialised app.
// With no config yet, use a placeholder app that can only run ONLY_ON_DEVICE requests.
function ensureFirebaseIfPossible() {
  if (settings.firebaseConfig) return ensureFirebase();
  return initFirebase({ apiKey: 'on-device-only', projectId: 'adlint-pocket-local', appId: '1:0:web:0' }, settings.appCheckDebugToken);
}

const sourceLabel = (s, m) => (s === 'on_device' ? 'Gemini Nano, on this device' : s === 'in_cloud' ? `${m || 'Gemini'} in the cloud via Firebase` : s);

function runHeader(title, kind, text) {
  const d = document.createElement('div');
  d.className = 'run';
  const badge = kind === 'rules' ? 'On this device · rule pack' : kind === 'on_device' ? 'On this device · Gemini Nano' : kind === 'in_cloud' ? 'Cloud · Gemini via Firebase' : kind;
  d.innerHTML = `<b>${esc(title)}</b><span class="badge ${esc(kind)}">${esc(badge)}</span><span>${esc(text)}</span>`;
  return d;
}

const PLAT = (p) => pack.platforms[p]?.label.replace(/^(Meta|Google): /, '') || p;

function renderFindings(findings, passed, isAi = false) {
  const wrap = document.createElement('div');
  const n = (sev) => findings.filter((f) => f.severity === sev).length;
  if (!isAi) {
    wrap.innerHTML = `<div class="summary"><span><b style="color:var(--fail)">${n('fail')}</b>fix</span><span><b style="color:var(--warn)">${n('warn')}</b>check</span><span><b style="color:var(--info)">${n('info')}</b>info</span><span><b style="color:var(--pass)">${passed.length}</b>passed</span></div>`;
  }
  if (!findings.length) {
    const ok = document.createElement('div');
    ok.className = 'item pass';
    ok.innerHTML = `<div class="top"><span class="title">${isAi ? 'No extra problems found by the AI' : 'No problems found'}</span><span class="sev">pass</span></div>`;
    wrap.append(ok);
  }
  const order = { fail: 0, warn: 1, info: 2 };
  for (const f of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    const el = document.createElement('div');
    el.className = `item ${f.severity}`;
    const excerpt = f.excerpt ? highlight(f.excerpt, f.match) : '';
    el.innerHTML = `
      <div class="top"><span class="title">${esc(f.title)}</span><span class="sev">${{ fail: 'Fix', warn: 'Check', info: 'Info' }[f.severity]}</span></div>
      ${f.detail ? `<div class="detail">${esc(f.detail)}</div>` : ''}
      ${excerpt ? `<div class="excerpt">“${excerpt}”</div>` : ''}
      ${f.fix ? `<div class="fix">Suggested fix: ${esc(f.fix)}</div>` : ''}
      <div class="reason">${esc(f.reason)}</div>
      <div class="meta"><span>${esc((f.platforms || []).map(PLAT).join(', '))}${f.field && f.field !== 'any' ? ' · ' + esc(f.field.replace('_', ' ')) : ''}</span>
      <a href="${esc(f.source)}" target="_blank" rel="noopener">Source</a><span>${esc(f.rule_id)}</span></div>`;
    wrap.append(el);
  }
  if (passed.length) {
    const d = document.createElement('details');
    d.className = 'passed';
    d.innerHTML = `<summary>${passed.length} checks passed</summary><ul>${passed
      .map((p) => `<li>${esc(PLAT(p.platform))}: ${esc(p.title.replace(/^(.)/, (c) => c))} — <a href="${esc(p.source)}" target="_blank">source</a></li>`)
      .join('')}</ul>`;
    wrap.append(d);
  }
  return wrap;
}

function highlight(text, match) {
  const t = esc(text.length > 220 ? text.slice(0, 220) + '…' : text);
  if (!match) return t;
  const m = esc(match.trim());
  const i = t.toLowerCase().indexOf(m.toLowerCase());
  return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + m.length) + '</mark>' + t.slice(i + m.length);
}

// ---------- context menu hand-off ----------
async function takePending() {
  const { pendingText } = await chrome.storage.session.get('pendingText');
  if (pendingText) {
    await chrome.storage.session.remove('pendingText');
    $$('.tabs button')[0].click();
    $('#f-primary').value = pendingText;
    updateCounts();
    $('#btn-check').click();
  }
}
chrome.storage.session.onChanged.addListener((c) => c.pendingText?.newValue && takePending());

// ---------- image tab ----------
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadImage(e.dataTransfer.files[0]));
$('#f-image').addEventListener('change', (e) => e.target.files[0] && loadImage(e.target.files[0]));
$$('input[name=iplatform]').forEach((i) => i.addEventListener('change', () => currentImage && runLocalImage()));
$('#overlay-platform').addEventListener('change', drawPreview);
$('#btn-sample-img').addEventListener('click', async () => {
  const blob = await (await fetch(chrome.runtime.getURL('samples/glowberry-story.png'))).blob();
  loadImage(new File([blob], 'glowberry-story.png', { type: 'image/png' }));
});

async function loadImage(file) {
  const bitmap = await createImageBitmap(file);
  currentImage = { file, bitmap, width: bitmap.width, height: bitmap.height, type: file.type, bytes: file.size, name: file.name, boxes: null };
  $('#drop-text').textContent = `${file.name} · ${bitmap.width}×${bitmap.height} · ${(file.size / 1024).toFixed(0)} KB`;
  $('#preview-wrap').hidden = false;
  runLocalImage();
}

function runLocalImage() {
  const platforms = selected('iplatform');
  const sel = $('#overlay-platform');
  const prev = sel.value;
  sel.innerHTML = '<option value="">None</option>' + platforms.filter((p) => pack.platforms[p].image.safe_zone).map((p) => `<option value="${p}">${esc(PLAT(p))}</option>`).join('');
  sel.value = platforms.includes(prev) ? prev : platforms.find((p) => pack.platforms[p].image.safe_zone) || '';
  $('#overlay-pick').hidden = false;
  drawPreview();
  const t0 = performance.now();
  const r = checkImageSpec(pack, currentImage, platforms);
  const out = $('#results-image');
  out.innerHTML = '';
  out.append(runHeader('Placement specs', 'rules', `${Math.max(1, Math.round(performance.now() - t0))} ms · size, ratio, file type`));
  out.append(renderFindings(r.findings, r.passed));
  const aiBox = document.createElement('div');
  aiBox.id = 'image-ai';
  out.append(aiBox);
  if (currentImage.ai) showImageAi(currentImage.ai);
  updateImageButtons();
}

function drawPreview() {
  if (!currentImage) return;
  const c = $('#preview');
  const { bitmap } = currentImage;
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  const pid = $('#overlay-platform').value;
  const z = pid && pack.platforms[pid].image.safe_zone;
  if (z) {
    g.fillStyle = 'rgba(255, 60, 60, 0.38)';
    g.fillRect(0, 0, c.width, c.height * z.top);
    g.fillRect(0, c.height * (1 - z.bottom), c.width, c.height * z.bottom);
    g.fillRect(0, c.height * z.top, c.width * z.left, c.height * (1 - z.top - z.bottom));
    g.fillRect(c.width * (1 - z.right), c.height * z.top, c.width * z.right, c.height * (1 - z.top - z.bottom));
    g.setLineDash([8, 6]);
    g.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    g.lineWidth = 2;
    g.strokeRect(c.width * z.left, c.height * z.top, c.width * (1 - z.left - z.right), c.height * (1 - z.top - z.bottom));
    g.setLineDash([]);
  }
  for (const b of currentImage.boxes || []) {
    g.strokeStyle = b.kind === 'face' ? '#4ade80' : b.kind === 'logo' ? '#7c9cff' : '#ffd166';
    g.lineWidth = 2;
    g.strokeRect((b.x_min / 1000) * c.width, (b.y_min / 1000) * c.height, ((b.x_max - b.x_min) / 1000) * c.width, ((b.y_max - b.y_min) / 1000) * c.height);
  }
}

function updateImageButtons() {
  const has = !!currentImage;
  const dev = $('#btn-img-device');
  dev.disabled = !has || nano.image !== 'available';
  dev.title = nano.image === 'available' ? 'Runs Gemini Nano with image input, on this device' : `Gemini Nano image input: ${label(nano.image)}`;
  const cloud = $('#btn-img-cloud');
  cloud.disabled = !has || settings.neverCloud || !settings.firebaseConfig;
  cloud.title = settings.neverCloud ? '"Never send to cloud" is on' : !settings.firebaseConfig ? 'Set up Firebase in Settings first' : 'Asks before sending';
}

$('#btn-img-device').addEventListener('click', () => runImageAi(InferenceMode.ONLY_ON_DEVICE));
$('#btn-img-cloud').addEventListener('click', () => ($('#consent-image').hidden = false));
$('#btn-img-cloud-no').addEventListener('click', () => ($('#consent-image').hidden = true));
$('#btn-img-cloud-yes').addEventListener('click', () => {
  $('#consent-image').hidden = true;
  if (settings.neverCloud) return; // belt and braces
  runImageAi(InferenceMode.ONLY_IN_CLOUD);
});

async function runImageAi(mode) {
  const box = $('#image-ai');
  box.innerHTML = `<div class="run"><span class="spinner"></span> ${mode === InferenceMode.ONLY_IN_CLOUD ? 'Sending the image to Gemini in the cloud…' : 'Gemini Nano is looking at the image on this device…'}</div>`;
  try {
    ensureFirebaseIfPossible();
    const r = await reviewImage(currentImage.file, mode, settings.cloudModel);
    currentImage.ai = r;
    currentImage.boxes = r.data.boxes || [];
    drawPreview();
    showImageAi(r);
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="error">Image check failed: ${esc(e.message || e)}</div>`;
  }
}

function showImageAi(r) {
  const box = $('#image-ai');
  const platforms = selected('iplatform');
  box.innerHTML = '';
  box.append(runHeader('AI image check', r.source, `${r.ms} ms · ${sourceLabel(r.source, r.model)}`));
  // Safe zones: the model found the boxes, local code applies the platform's exact margins.
  const sz = checkSafeZones(pack, r.data.boxes, platforms);
  // Text inside the image goes through the same sourced copy rules.
  const txt = (r.data.detected_text || '').trim();
  const copy = txt ? checkCopy(pack, () => ({ primary_text: txt, headline: '', description: txt, path: '' }), platforms) : { findings: [], passed: [] };
  const textFindings = copy.findings
    .filter((f) => !/length|count/.test(f.rule_id))
    .map((f) => ({ ...f, title: 'Image text: ' + f.title }));
  box.append(renderFindings([...sz.findings, ...textFindings], sz.passed));
  const notes = document.createElement('div');
  notes.className = 'note';
  notes.innerHTML = `<b>AI observations</b> (not rules, no source):<br>Text in image: “${esc(txt.slice(0, 200) || 'none')}”<br>Text covers about ${esc(Math.round(r.data.text_coverage_percent ?? 0))}% of the image · Faces cut off: ${r.data.faces_cut_off ? 'yes' : 'no'}<br>${esc(r.data.notes || '')}`;
  box.append(notes);
}

// ---------- settings tab ----------
$('#btn-save').addEventListener('click', saveSettings);
$('#s-never-cloud').addEventListener('change', saveSettings);
$('#btn-download').addEventListener('click', async () => {
  const p = $('#dl-progress');
  p.hidden = false;
  try {
    ensureFirebaseIfPossible();
    await downloadDeviceModel((v) => (p.value = v));
  } catch (e) {
    console.error(e);
    $('#s-nano-text').textContent = 'error: ' + (e.message || e);
  }
  setTimeout(refreshPills, 1500);
});

// ---------- start ----------
(async () => {
  $('#s-pack').textContent = `${pack.name}, version ${pack.version}: ${pack.rules.length} rules across ${Object.keys(pack.platforms).length} placements.`;
  await loadSettings();
  updateFieldVisibility();
  await refreshPills();
  await takePending();
})();
