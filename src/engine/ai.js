// AdLint Pocket: Firebase AI Logic in hybrid mode.
// Copy review: PREFER_ON_DEVICE (Gemini Nano in Chrome, falls back to cloud Gemini),
//              or ONLY_ON_DEVICE when "never send to cloud" is on.
// Image review: ONLY_ON_DEVICE (Nano multimodal) or ONLY_IN_CLOUD after an explicit consent click.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { rulesFor } from './rules.js';

export { InferenceMode, InferenceSource };

// Text-only on-device sessions: don't let "image input not supported" block plain copy checks.
const TEXT_ONLY = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const TEXT_AND_IMAGE = { expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const COPY_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          rule_id: { type: 'string' },
          field: { type: 'string' },
          quote: { type: 'string' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['rule_id', 'quote', 'why', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
};

const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    detected_text: { type: 'string' },
    text_coverage_percent: { type: 'number' },
    boxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['text', 'logo', 'face'] },
          label: { type: 'string' },
          x_min: { type: 'number' },
          y_min: { type: 'number' },
          x_max: { type: 'number' },
          y_max: { type: 'number' },
        },
        required: ['kind', 'label', 'x_min', 'y_min', 'x_max', 'y_max'],
      },
    },
    faces_cut_off: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['detected_text', 'text_coverage_percent', 'boxes', 'faces_cut_off', 'notes'],
};

// Same as the SDK's hybrid default; inCloudParams needs the model named explicitly.
export const DEFAULT_CLOUD_MODEL = 'gemini-3.5-flash-lite';
// If the cloud model is overloaded or missing, try the next one.
const CLOUD_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a request; on a cloud-side 5xx/429/404, retry with the next cloud model. */
async function withCloudFallback(mode, kind, cloudModel, request) {
  const chain = [...new Set([cloudModel || DEFAULT_CLOUD_MODEL, ...CLOUD_FALLBACKS])];
  let lastErr;
  const attempts = chain.flatMap((name) => [name, name]); // each model gets one retry
  for (const [i, name] of attempts.entries()) {
    if (i > 0) await sleep(1200);
    try {
      const result = await model(mode, kind, name).generateContent(request);
      const source = result.response.inferenceSource || InferenceSource.IN_CLOUD;
      return { result, source, cloudModel: source === InferenceSource.IN_CLOUD ? name : null };
    } catch (e) {
      lastErr = e;
      const retriable = /\[(500|502|503|504|429|404)|high demand|overloaded|not found|unavailable/i.test(String(e.message || e));
      if (mode === InferenceMode.ONLY_ON_DEVICE || !retriable) throw e;
      console.warn(`[AdLint Pocket] ${name} failed, trying the next cloud model`, e.message);
    }
  }
  throw lastErr;
}

let state = null; // { app, ai, key }
const cache = new Map();
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36).replace('-', 'n');

/** Set up Firebase + App Check once per config. */
export function initFirebase(firebaseConfig, appCheckDebugToken) {
  const key = JSON.stringify(firebaseConfig) + '|' + appCheckDebugToken;
  if (state && state.key === key) return state;
  if (cache.has(key)) return (state = cache.get(key));
  if (!firebaseConfig || !firebaseConfig.apiKey) throw new Error('No Firebase config yet. Open Settings and paste your Firebase web app config.');

  // App Check debug provider: Chrome extensions have no reCAPTCHA origin, so we use a debug token
  // (accepted by the contest rules). The token must be registered in Firebase console > App Check.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken || true;

  // One named app per config, so switching from the on-device-only placeholder to a real project works.
  const name = 'adlint-' + hash(key);
  const app = initializeApp(firebaseConfig, name);
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () => Promise.reject(new Error('Production attestation is not set up for the extension; using the App Check debug token.')),
    }),
    isTokenAutoRefreshEnabled: true,
  });
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  state = { app, ai, key };
  cache.set(key, state);
  return state;
}

function model(mode, kind, cloudModel) {
  if (!state) throw new Error('Firebase is not initialised.');
  const schema = kind === 'image' ? IMAGE_SCHEMA : COPY_SCHEMA;
  return getGenerativeModel(state.ai, {
    mode,
    onDeviceParams: {
      createOptions: kind === 'image' ? { ...TEXT_AND_IMAGE } : { ...TEXT_ONLY },
      promptOptions: { responseConstraint: schema },
    },
    inCloudParams: {
      model: cloudModel || DEFAULT_CLOUD_MODEL,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 },
    },
  });
}

/** What Chrome says about Gemini Nano on this machine: available | downloadable | downloading | unavailable | no-api */
export async function deviceStatus(kind = 'text') {
  if (typeof self.LanguageModel === 'undefined') return 'no-api';
  try {
    return await self.LanguageModel.availability(kind === 'image' ? TEXT_AND_IMAGE : TEXT_ONLY);
  } catch (e) {
    return 'unavailable';
  }
}

/** Start the Nano download (must follow a user click). Uses the SDK's initializeDeviceModel. */
export async function downloadDeviceModel(onProgress) {
  const m = model(InferenceMode.PREFER_ON_DEVICE, 'copy');
  await m.initializeDeviceModel(onProgress);
  return deviceStatus('text');
}

function copyPrompt(pack, ad, platformIds, alreadyFound = []) {
  const rules = rulesFor(pack, platformIds)
    .filter((r) => r.type === 'claim')
    .map((r) => `- ${r.id}: ${r.title}`)
    .join('\n');
  const fields = ['primary_text', 'headline', 'description', 'path']
    .filter((f) => (ad[f] || '').trim())
    .map((f) => `${f}:\n${ad[f].trim()}`)
    .join('\n\n');
  const known = alreadyFound.length
    ? `\nALREADY FLAGGED BY THE KEYWORD CHECK (do not repeat these):\n${alreadyFound.map((f) => `- ${f.rule_id}: "${f.match || ''}"`).join('\n')}\n`
    : '';
  return `You are an ad compliance reviewer. A keyword check already ran. Your job: find claims it missed because they are implied or reworded (for example "acne gone forever" implies a cure; "never comes back" implies a guaranteed result).
Use only rule ids from the list. Pick the rule that matches the meaning; skip anything that does not clearly match a rule. Return at most 4 findings, the most serious first. An empty list is fine.

RULES
${rules}
${known}
AD COPY
${fields}

For each finding: rule_id, field, quote (exact words from the ad), why (one short sentence), fix (a rewrite of that phrase that removes the claim; never add a new claim, guarantee or number). Then a one-sentence summary.`;
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
}

/**
 * AI copy review through Firebase AI Logic.
 * @param mode InferenceMode.PREFER_ON_DEVICE or ONLY_ON_DEVICE
 * @returns {Promise<{data, source, ms}>} source is 'on_device' | 'in_cloud'
 */
export async function reviewCopy(pack, ad, platformIds, mode, cloudModel, alreadyFound = []) {
  const t0 = performance.now();
  const { result, source, cloudModel: used } = await withCloudFallback(mode, 'copy', cloudModel, copyPrompt(pack, ad, platformIds, alreadyFound));
  return { data: parseJson(result.response.text()), source, model: used, ms: Math.round(performance.now() - t0) };
}

/** Read an image file into an inline-data part (JPEG/PNG; anything else is converted to JPEG). */
export async function fileToPart(file, maxSide = 1536) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { inlineData: { data: btoa(bin), mimeType: 'image/jpeg' } };
}

const IMAGE_PROMPT = `You check an ad image before launch. Look at the image and report:
- detected_text: all text you can read in the image, in reading order.
- text_coverage_percent: rough share of the image area covered by text (0-100).
- boxes: every block of text, every logo and every face, each with kind, a short label and its bounding box as x_min, y_min, x_max, y_max on a 0-1000 scale where 0,0 is the top-left corner.
- faces_cut_off: true if any face is cropped by the image edge.
- notes: one or two short sentences on anything a media buyer should fix (crop, legibility, clutter).`;

/**
 * AI image review. mode is ONLY_ON_DEVICE or ONLY_IN_CLOUD (cloud only after consent).
 */
export async function reviewImage(file, mode, cloudModel) {
  const t0 = performance.now();
  const part = await fileToPart(file);
  const { result, source, cloudModel: used } = await withCloudFallback(mode, 'image', cloudModel, [IMAGE_PROMPT, part]);
  return { data: parseJson(result.response.text()), source, model: used, ms: Math.round(performance.now() - t0) };
}
