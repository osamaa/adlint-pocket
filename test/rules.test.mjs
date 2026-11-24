// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCopy, charCount, groundAiFindings } from '../src/engine/rules.js';
import { checkImageSpec, checkSafeZones } from '../src/engine/image.js';

const pack = JSON.parse(readFileSync(new URL('../src/rules/rulepack.json', import.meta.url)));
const ALL = Object.keys(pack.platforms);
const ids = (r) => new Set(r.findings.map((f) => f.rule_id));

test('every rule has an official source URL (no source, no rule)', () => {
  for (const r of pack.rules) {
    if (r.source_from === 'placement') continue;
    assert.match(r.source, /^https:\/\/(www\.facebook\.com|transparency\.meta\.com|support\.google\.com|www\.ftc\.gov|www\.asa\.org\.uk)\//, r.id);
  }
  for (const p of Object.values(pack.platforms)) assert.match(p.image.source, /^https:\/\//);
});

test('each platform has about 10+ copy rules', () => {
  for (const pid of ALL) {
    const n = pack.rules.filter((r) => r.platforms.includes(pid) && r.type !== 'image').length;
    assert.ok(n >= 10, `${pid} has ${n}`);
  }
});

test('all patterns compile', () => {
  for (const r of pack.rules) for (const p of r.patterns || []) new RegExp(p, r.flags || 'giu');
});

test('Google RSA limits and counts', () => {
  const ad = { headline: 'Short one\nThis headline is far too long for Google', description: 'ok', path: 'this-path-is-way-too-long' };
  const r = checkCopy(pack, ad, ['google_search_rsa']);
  const s = ids(r);
  assert.ok(s.has('google-rsa-headline-length'));
  assert.ok(s.has('google-rsa-path-length'));
  assert.ok(s.has('google-rsa-asset-count')); // 2 headlines, 1 description
});

test('CJK counts double for Google', () => {
  assert.equal(charCount('日本', 'google_search_rsa'), 4);
  assert.equal(charCount('日本', 'meta_facebook_feed'), 2);
});

test('risky claims are caught with the matched words', () => {
  const ad = { primary_text: 'Tired of your ugly skin? Miracle serum, clinically proven. Guaranteed returns of 20%! Are you in debt? Today only.' };
  const r = checkCopy(pack, ad, ['meta_facebook_feed']);
  const s = ids(r);
  for (const id of ['meta-negative-self-perception', 'meta-health-sensational', 'ftc-claim-substantiation', 'meta-guaranteed-investment-returns', 'meta-personal-attributes', 'asa-false-urgency']) assert.ok(s.has(id), id);
});

test('Google editorial: caps, punctuation, emoji, spacing', () => {
  const ad = { headline: 'GLOWBERRY Sale!!\nF R E E gift\nBig sale 🎉', description: 'One\nTwo', path: '' };
  const s = ids(checkCopy(pack, ad, ['google_search_rsa']));
  for (const id of ['google-excessive-capitalization', 'google-repeated-punctuation', 'google-no-emoji', 'google-gimmicky-spacing']) assert.ok(s.has(id), id);
});

test('clean copy passes', () => {
  const ad = { primary_text: 'Glowberry Night Oil is a light, vegan face oil made in small batches. See ingredients and reviews on our site.', headline: 'Meet Glowberry Night Oil' };
  const r = checkCopy(pack, ad, ['meta_facebook_feed']);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings.map((f) => f.rule_id)));
});

test('abbreviations are not flagged as caps', () => {
  const ad = { headline: 'Ships across the UAE\nFAQ and Help\nBuy Now', description: 'One\nTwo', path: '' };
  assert.ok(!ids(checkCopy(pack, ad, ['google_search_rsa'])).has('google-excessive-capitalization'));
});

test('AI findings without a real rule are dropped', () => {
  const { kept, dropped } = groundAiFindings(pack, ['meta_facebook_feed'], [
    { rule_id: 'ftc-health-claims-evidence', quote: 'acne gone forever', why: 'implied cure', fix: 'Helps reduce breakouts' },
    { rule_id: 'made-up-rule', quote: 'x', why: 'y', fix: 'z' },
    { rule_id: 'google-no-emoji', quote: 'x', why: 'not this platform', fix: 'z' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 2);
  assert.match(kept[0].source, /ftc\.gov/);
});

test('image spec: ratio and size', () => {
  const r = checkImageSpec(pack, { width: 1080, height: 1080, type: 'image/png', bytes: 500000 }, ['meta_facebook_feed', 'meta_instagram_stories', 'google_search_rsa']);
  const plats = r.findings.flatMap((f) => f.platforms);
  assert.ok(plats.includes('meta_facebook_feed')); // wants 4:5
  assert.ok(plats.includes('meta_instagram_stories')); // wants 9:16
  assert.ok(r.passed.some((p) => p.platform === 'google_search_rsa')); // 1:1 is fine
  const ok = checkImageSpec(pack, { width: 1440, height: 2560, type: 'image/jpeg', bytes: 900000 }, ['meta_instagram_stories']);
  assert.equal(ok.findings.length, 0);
});

test('safe zones use the platform numbers', () => {
  const boxes = [
    { kind: 'text', label: 'SALE', x_min: 100, y_min: 20, x_max: 900, y_max: 100 }, // top 14%
    { kind: 'logo', label: 'logo', x_min: 400, y_min: 400, x_max: 600, y_max: 500 }, // safe
  ];
  const r = checkSafeZones(pack, boxes, ['meta_instagram_stories']);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].detail, /top 14%/);
});

test('domain rules need domain words in the ad', () => {
  const f = [{ rule_id: 'meta-guaranteed-loan-approval', quote: 'Acne gone for good', why: 'x', fix: 'y' }];
  assert.equal(groundAiFindings(pack, ['meta_facebook_feed'], f, 'Acne gone for good. Night oil.').kept.length, 0);
  assert.equal(groundAiFindings(pack, ['meta_facebook_feed'], f, 'Guaranteed loan approval today').kept.length, 1);
});
