// AdLint Pocket: deterministic rule engine.
// Runs fully in the browser (or Node for tests). No network, no model.
// Every finding carries the rule's official source URL.

const CJK = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-｠￠-￦]/u;

/** Character count the way the platform counts it. */
export function charCount(text, platformId) {
  let n = 0;
  for (const ch of text) {
    // Google counts Chinese, Japanese and Korean characters as 2 (same source page as the RSA limits).
    n += platformId === 'google_search_rsa' && CJK.test(ch) ? 2 : 1;
  }
  return n;
}

/** Split a field into its assets: multi fields are one asset per line. */
export function assetsOf(ad, fieldId, fieldDef) {
  const raw = (ad[fieldId] || '').replace(/\r/g, '');
  if (!fieldDef.multi) return raw.trim() ? [raw.trim()] : [];
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function compile(rule) {
  if (!rule._re) {
    const flags = rule.flags || 'giu';
    rule._re = (rule.patterns || []).map((p) => new RegExp(p, flags));
  }
  return rule._re;
}

function finding(rule, extra) {
  return {
    rule_id: rule.id,
    severity: rule.severity,
    title: rule.title,
    reason: rule.reason,
    source: rule.source,
    origin: 'rules',
    ...extra,
  };
}

/**
 * Check ad copy against the pack.
 * @param {object} pack   the rule pack JSON
 * @param {object|function} ad  { primary_text, headline, description, path }, or pid => that object
 *                        (Meta and Google use different headline fields, so the UI passes a function)
 * @param {string[]} platformIds
 * @returns {{findings: object[], passed: object[], checkedFields: object[]}}
 */
export function checkCopy(pack, ad, platformIds) {
  const findings = [];
  const passed = [];
  const checkedFields = [];

  for (const pid of platformIds) {
    const platform = pack.platforms[pid];
    if (!platform) continue;
    const rules = pack.rules.filter((r) => r.platforms.includes(pid) && r.type !== 'image');

    // Collect this platform's text assets.
    const assets = [];
    const adP = typeof ad === 'function' ? ad(pid) : ad;
    for (const [fid, fdef] of Object.entries(platform.fields)) {
      for (const [i, text] of assetsOf(adP, fid, fdef).entries()) {
        assets.push({ field: fid, fieldLabel: fdef.label, index: i, text });
      }
    }
    checkedFields.push({ platform: pid, count: assets.length });
    if (!assets.length) continue;

    for (const rule of rules) {
      const hits = [];
      if (rule.type === 'limit') {
        for (const a of assets.filter((x) => x.field === rule.field)) {
          const n = charCount(a.text, pid);
          if (n > rule.max) {
            hits.push({ field: a.field, excerpt: a.text, detail: `${n} characters, limit ${rule.max} (${n - rule.max} over)` });
          }
        }
      } else if (rule.type === 'count') {
        for (const [fid, [min, max]] of Object.entries(rule.counts)) {
          const n = assets.filter((x) => x.field === fid).length;
          if (n < min || n > max) {
            hits.push({ field: fid, excerpt: '', detail: `${n} ${fid}${n === 1 ? '' : 's'}, needs ${min} to ${max}` });
          }
        }
      } else if (rule.type === 'claim') {
        const pool = rule.field === 'any' ? assets : assets.filter((x) => x.field === rule.field);
        for (const a of pool) {
          for (const re of compile(rule)) {
            re.lastIndex = 0;
            const m = re.exec(a.text);
            if (m) {
              hits.push({ field: a.field, excerpt: a.text, match: m[0], detail: `Found "${m[0].trim()}"` });
              break;
            }
          }
        }
      }
      if (hits.length) {
        for (const h of hits) findings.push(finding(rule, { platform: pid, ...h }));
      } else {
        passed.push({ rule_id: rule.id, platform: pid, title: rule.title, source: rule.source });
      }
    }
  }
  return { findings: mergeSamePlatformHits(findings), passed, checkedFields };
}

// The same rule firing on the same text for several platforms shows once, listing the platforms.
function mergeSamePlatformHits(findings) {
  const out = new Map();
  for (const f of findings) {
    const key = `${f.rule_id}|${f.field}|${f.excerpt}|${f.detail}`;
    if (out.has(key)) out.get(key).platforms.push(f.platform);
    else out.set(key, { ...f, platforms: [f.platform] });
  }
  return [...out.values()];
}

/** Rules the AI reviewer may cite for these platforms (copy rules only). */
export function rulesFor(pack, platformIds) {
  return pack.rules.filter((r) => r.type !== 'image' && r.platforms.some((p) => platformIds.includes(p)));
}

/**
 * Keep only AI findings that cite a real rule for the chosen platforms.
 * "No source, no rule": anything else is dropped.
 */
export function groundAiFindings(pack, platformIds, aiFindings) {
  const allowed = new Map(rulesFor(pack, platformIds).map((r) => [r.id, r]));
  const kept = [];
  const dropped = [];
  for (const f of aiFindings || []) {
    const rule = allowed.get(f.rule_id);
    if (!rule) {
      dropped.push(f);
      continue;
    }
    kept.push({
      rule_id: rule.id,
      severity: rule.severity === 'info' ? 'info' : 'warn',
      title: rule.title,
      reason: rule.reason,
      source: rule.source,
      origin: 'ai',
      field: f.field || 'any',
      excerpt: f.quote || '',
      detail: f.why || '',
      fix: f.fix || '',
      platforms: rule.platforms.filter((p) => platformIds.includes(p)),
    });
  }
  return { kept, dropped };
}
