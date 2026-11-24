# AdLint Pocket

**Check an ad on your own laptop before you launch it.**
A Chrome extension that reviews ad copy and ad images for Facebook Feed, Instagram Stories and Google Search ads. It runs on-device first with Gemini Nano through **Firebase AI Logic hybrid inference**, and only uses Gemini in the cloud after you say yes.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) (Web/Chrome).

> Guidance, not legal advice. Platform policies change: every result links to the official page it comes from, so check it before launch.

## Why hybrid

Agencies and in-house teams hold ads that are confidential until launch day: a new product, a price, a client's campaign. Pasting them into a cloud chatbot to "check the copy" is exactly what an NDA forbids.

AdLint Pocket splits the job:

| Step | Where it runs | Why |
|---|---|---|
| Rule pack: character limits, asset counts, risky claims, editorial rules | In the extension (plain JavaScript) | Instant, deterministic, every rule has a source |
| AI copy review: implied claims the keywords miss, plus a compliant rewrite | **Gemini Nano on this device** via Firebase AI Logic (`PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` when "never send to cloud" is on) | The copy never leaves the laptop |
| Cloud fallback for the copy review | Gemini via Firebase AI Logic | Only if Nano isn't ready **and** you click "Yes, send the copy" |
| Image spec: size, ratio, file type, file size | In the extension | No model needed |
| AI image check: text, logos, faces, where they sit | Gemini Nano with image input (`ONLY_ON_DEVICE`) or, after a consent click, Gemini in the cloud (`ONLY_IN_CLOUD`) | Heavy vision work goes to the cloud only when you choose |
| Safe-zone verdict | In the extension | The model only reports *where* things are; the extension applies each platform's exact margins |

Every AI finding has to cite a rule id from the pack. Findings that don't match a sourced rule are dropped and counted, and domain rules (loans, investments, income claims) are only accepted when the ad is actually about that domain. **No source, no rule.**

## Features

- Side panel with three tabs: **Ad copy**, **Ad image**, **Settings**.
- Paste copy, or select text on any web page and right-click **Check with AdLint Pocket**.
- Pick placements: Facebook Feed, Instagram Stories, Google Search (responsive search ad).
- Results as a fix / check / info / pass list. Each item shows what was found, the words that triggered it, the reason, the placements it applies to, a **Source** link, and for AI findings a suggested rewrite.
- A badge on every run shows where it ran: *On this device · rule pack*, *On this device · Gemini Nano*, or *Cloud · Gemini via Firebase* (read from the SDK's `inferenceSource`).
- Drop an ad image (or click **Try the sample ad**): instant spec check per placement, a safe-zone overlay (Stories: 14% top, 35% bottom, 6% sides; Google image assets: central 80%), then an AI check on-device or in the cloud. Text found in the image goes through the same sourced copy rules.
- **Never send anything to the cloud** switch. When it's on, AI calls use `ONLY_ON_DEVICE` and the cloud buttons are disabled.
- Status pills: Gemini Nano state on this machine, and the cloud state (never / only with your OK / not set up).
- A **Download / prepare Gemini Nano** button that calls the SDK's `initializeDeviceModel()` with a progress bar.

## How Firebase AI Logic is used

All model calls go through the Firebase AI Logic web SDK (`firebase/ai`, v13). See [`src/engine/ai.js`](src/engine/ai.js):

```js
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';

initializeAppCheck(app, { provider: new CustomProvider({...}), isTokenAutoRefreshEnabled: true }); // debug token, see below
const ai = getAI(app, { backend: new GoogleAIBackend() });

const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,            // or ONLY_ON_DEVICE / ONLY_IN_CLOUD
  onDeviceParams: {
    createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }] },
    promptOptions: { responseConstraint: COPY_SCHEMA },  // structured JSON on-device
  },
  inCloudParams: {
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: COPY_SCHEMA },
  },
});
const result = await model.generateContent(prompt);
result.response.inferenceSource; // 'on_device' | 'in_cloud' -> shown as a badge
```

- **Copy review:** `PREFER_ON_DEVICE` (Nano first, cloud fallback only after consent) or `ONLY_ON_DEVICE` with the privacy switch on.
- **Image check:** `ONLY_ON_DEVICE` (Nano multimodal) or `ONLY_IN_CLOUD` behind the consent box.
- **Same JSON schema both ways:** `responseConstraint` on-device, `responseJsonSchema` in the cloud, so the UI doesn't care where it ran.
- **Cloud resilience:** if the cloud model is overloaded, the extension retries and steps through a short list of Gemini Flash models; the badge names the model that answered.
- **App Check** is on. Chrome extensions have no reCAPTCHA origin, so the extension uses an App Check **debug token** (accepted by the contest rules), registered in the Firebase console. The `CustomProvider` is a placeholder for a future production attestation.

## Setup

Requirements: Chrome 139+ on desktop (macOS, Windows, Linux or ChromeOS) with enough free disk space for Gemini Nano.

**Quickest (no build):** download [`release/adlint-pocket-extension.zip`](release/adlint-pocket-extension.zip), unzip it, then `chrome://extensions` > Developer mode > **Load unpacked** > pick the unzipped folder. Skip to step 2 below.

**From source** (Node 20+):

```bash
git clone https://github.com/osamaa/adlint-pocket.git
cd adlint-pocket
npm install
npm test        # rule engine tests
npm run build   # writes dist/
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `dist/`.
2. Click the AdLint Pocket toolbar icon: the side panel opens.
3. **Gemini Nano:** open Settings and click **Download / prepare Gemini Nano**. If the pill says "Prompt API missing", enable `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome, and check `chrome://on-device-internals`.
4. The rule pack and on-device AI work with no Firebase project. For the **cloud fallback**, set up your own (free Spark plan is enough):
   - Firebase console > create a project > add a **Web app** > copy its config.
   - **AI Logic** > Get started > **Gemini Developer API**.
   - **App Check** > Apps > your web app > **Manage debug tokens** > add the token shown in AdLint Pocket's Settings.
   - Paste the config into Settings > **Save**.
   - Optional: put the same values in `local.config.json` (see `local.config.example.json`, git-ignored) so your own build is pre-filled.

### Try it in 60 seconds

1. Ad copy tab > **Load example** > **Check copy**: the rule pack flags the lengths and claims, then Gemini Nano adds findings and rewrites.
2. **Example 2** has no obvious keywords ("acne gone forever", "dermatologists are amazed"). The rule pack finds little; the on-device AI review catches the implied cure claim against the FTC health-claims rule.
3. Ad image tab > **Try the sample ad** (or drop `demo/glowberry-story.png`, a made-up brand): spec check, safe-zone overlay, then the AI check on-device or, after the consent box, in the cloud.
4. Open `demo/landing.html` in Chrome, select the ad text, right-click > **Check with AdLint Pocket**: the side panel opens and checks it.
5. Settings > turn on **Never send anything to the cloud**: cloud buttons go grey and AI calls run `ONLY_ON_DEVICE`.

## Rule pack

[`src/rules/rulepack.json`](src/rules/rulepack.json): 32 rules across 3 placements, each with `id`, `platforms`, `field`, `type` (`limit`, `count`, `claim`, `image`), `severity`, a plain-English `reason` and a `source` URL. Sources used: Meta Ads Guide, Meta Advertising Standards and Community Standards (fraud and scams), Google Ads Help (responsive search ads, image assets) and Google Ads policies (editorial, misrepresentation / unreliable claims), US FTC "Advertising FAQs: A Guide for Small Business", UK ASA/CAP Code section 3. Sources were opened and checked on 24 Nov 2026. A test fails if any rule lacks an official source URL.

All examples use made-up brands (Glowberry Skin Lab, Glowberry Night Oil).

## Privacy

- No analytics, no server of our own. Settings live in `chrome.storage.local`.
- Nothing goes to the cloud unless "never send" is off **and** you click a consent button.
- No API keys or secrets are in this repo. Your Firebase config and App Check debug token stay in your browser (or your git-ignored `local.config.json`).

## Built during the contest (Nov 2026)

Everything in this repository was written during the #BuildHybridAI submission period (from 24 Nov 2026):

- The Chrome MV3 extension: side panel UI, context-menu hand-off, settings, consent flows.
- The Firebase AI Logic hybrid layer: on-device / cloud model setup, shared JSON schema, App Check with a debug token, Nano download flow, inference-source badges.
- The rule engine (limits per placement, Google asset counts, CJK double-width counting, claim patterns, AI-finding grounding) and its tests.
- The rule pack with 32 sourced rules for Facebook Feed, Instagram Stories and Google Search.
- The image engine: spec checks, safe-zone geometry, model boxes drawn on the preview, OCR text run through the copy rules.

Tested on a Mac mini (Apple silicon, Chrome 158) with Gemini Nano available on-device: rule pack, on-device copy review, on-device image review and the consented cloud image review (App Check enforced) all ran end to end. On that machine Nano takes about a minute per review; the rule pack is instant.

Built with AI coding assistants (Claude Code), as the rules allow.

## Pre-existing work

- **Placement specs, adapted from [AdLint](https://github.com/osamaa/adlint-agent)** (Osama Romoh, Oct 2026, `adlint/placements.py`): the idea of a placement as a target ratio and size plus unsafe margins as top/bottom/left/right fractions, and the safe-zone overlay. The numbers were re-checked against Meta's and Google's current guides on 24 Nov 2026 and updated (for example, Stories bottom margin 35% instead of AdLint's 20%). No AdLint code is included; AdLint is a Python/OpenCV service, this is a new JavaScript extension.
- Open-source libraries: Firebase JS SDK (Apache-2.0), esbuild (MIT).

## License

MIT, see [LICENSE](LICENSE).
