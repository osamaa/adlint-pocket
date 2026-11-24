**Check ads on your own laptop before launch.** Gemini Nano first, cloud only with your OK.

### Inspiration
I've worked in digital marketing for 22 years. Every agency has the same last-minute problem: an ad is about to go live, nobody is sure the headline fits, whether "clinically proven" will get it rejected, or whether the call-to-action sits under the Instagram buttons. And the ad is confidential until launch, so pasting it into a cloud chatbot is exactly what the client NDA forbids. I wanted the checker to come to the ad, on the laptop, instead of the ad going to the checker.

### What it does
AdLint Pocket is a Chrome side-panel extension that checks an ad for Facebook Feed, Instagram Stories and Google Search before launch.
- **Ad copy:** paste it, or select text on any page and right-click "Check with AdLint Pocket". A rule pack runs instantly in the browser: character limits per placement, Google's 3-15 headlines / 2-4 descriptions, all-caps and "!!", emoji, and risky claims ("guaranteed returns", "clear skin in 7 days", "the best", "today only"). Then Gemini Nano reviews the copy **on the device** for claims the keywords miss ("acne gone forever" is an implied cure) and suggests a compliant rewrite.
- **Ad image:** drop it in (or try the bundled sample ad). The extension checks size, ratio and file type per placement, draws the safe zones (Stories: 14% top, 35% bottom, 6% sides), and runs an AI check that finds text, logos and faces and where they sit. The AI only reports positions; the extension applies each platform's exact margins. Text found in the image goes through the same copy rules.
- **Results** come as a fix / check / info / pass list. Every item shows the reason and a **link to the official source** (Meta Ads Guide and Advertising Standards, Google Ads policies, US FTC, UK ASA). Every AI finding must cite a sourced rule, and domain rules (loans, investments, income) only count when the ad is about that domain; anything else is dropped and counted. No source, no rule. Labelled "guidance, not legal advice".
- **Never send to the cloud** switch for the strictest clients.

### How we built it (how Firebase AI Logic is used)
- All model calls go through the **Firebase AI Logic web SDK** (`firebase/ai` v13) with `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode, onDeviceParams, inCloudParams })`.
- **Copy review:** `InferenceMode.PREFER_ON_DEVICE`. If Gemini Nano is ready, it runs on the device. If not, the extension asks first, and only then lets the SDK fall back to Gemini in the cloud. With the privacy switch on, it uses `ONLY_ON_DEVICE`.
- **Image check:** `ONLY_ON_DEVICE` with Nano's image input, or `ONLY_IN_CLOUD` behind an explicit consent box ("Yes, send this image").
- **One JSON schema for both worlds:** `onDeviceParams.promptOptions.responseConstraint` on-device and `inCloudParams.generationConfig.responseJsonSchema` in the cloud, so the UI renders the same structured findings wherever they came from.
- **Where it ran is visible:** each AI result shows a badge from `response.inferenceSource` (on_device / in_cloud) with its latency.
- **Nano setup in-app:** a button calls `model.initializeDeviceModel()` with a progress bar.
- **Cloud resilience:** per-request timeout (`generateContent(request, { timeout })`) and a fallback list of Gemini Flash models when one is overloaded; the badge names the model that answered.
- **App Check is on.** Chrome extensions have no reCAPTCHA origin, so the extension uses an App Check debug token, registered in the Firebase console (allowed by the contest rules).
- Plain JavaScript, Manifest V3, bundled with esbuild. A rule engine with unit tests (`npm test`) enforces that every rule has an official source URL.

### Challenges we ran into
- On-device inference is single-turn and ignores system instructions, so all instructions live in the prompt, and the schema keeps Nano's answers parseable.
- `PREFER_ON_DEVICE` silently falls back to the cloud, which is the wrong default for confidential ads. We check Nano's availability first and put a consent step in front of any fallback.
- Keeping the AI honest: the on-device model sometimes picks a plausible-sounding but wrong rule (a "guaranteed loan approval" rule for a skincare ad). The model can only cite rules from the sourced pack, and a deterministic check drops domain rules that don't fit the ad.
- Gemini Nano on our test Mac mini takes about a minute per review. The rule pack answers in milliseconds, so the user is never waiting on the model to see the hard failures.
- Cloud models returned "high demand" errors during testing, so cloud calls retry with a timeout and step through other Gemini Flash models.
- App Check in an extension: no web origin for reCAPTCHA, so a debug token with a placeholder custom provider.

### Accomplishments that we're proud of
- A hybrid split that maps to a real agency rule: the deterministic checks and the AI review both stay on the laptop; the cloud is opt-in per action.
- 32 rules, each opened and checked against its official page.
- Spatial checks done right: the model finds the text, the code applies the platform's exact safe-zone numbers.

### What we learned
On-device models are good enough for a focused review job when you give them a short rule list and a strict schema, and the cloud is best saved for the heavy, optional step.

### What's next for AdLint Pocket
More placements (TikTok, YouTube, LinkedIn), regional rule packs (UAE, KSA), Arabic copy, and the same rule-pack format in the AdLint web app.

### Built during the contest
Everything in the repo was written during the submission period (from 24 Nov 2026): the extension, the Firebase AI Logic hybrid layer, the rule engine, the 32-rule pack, the image engine and the tests. Built with AI coding assistants, as the rules allow.

### Pre-existing work
Placement-spec structure (ratio, size and safe-zone margins as top/bottom/left/right fractions) adapted from my earlier open-source project AdLint (github.com/osamaa/adlint-agent, Oct 2026, a Python/OpenCV service). Numbers re-checked against the current Meta and Google guides. No AdLint code is included.

*Guidance, not legal advice. All examples use made-up brands.*
