// AdLint Pocket: image checks that run locally (pure geometry, no model).

/** Placement spec check: file type, file size, minimum size, aspect ratio. */
export function checkImageSpec(pack, img, platformIds) {
  // img: { width, height, type, bytes, name }
  const rule = pack.rules.find((r) => r.id === 'image-spec');
  const findings = [];
  const passed = [];
  for (const pid of platformIds) {
    const spec = pack.platforms[pid]?.image;
    if (!spec) continue;
    const problems = [];
    if (!spec.types.includes(img.type)) problems.push(`File type ${img.type || 'unknown'}; ${spec.label} takes ${spec.types.map((t) => t.split('/')[1].toUpperCase()).join(' or ')}`);
    if (img.bytes > spec.max_bytes) problems.push(`File is ${(img.bytes / 1048576).toFixed(1)} MB; max ${(spec.max_bytes / 1048576).toFixed(0)} MB`);
    if (img.width < spec.min_width) problems.push(`Width ${img.width}px; minimum ${spec.min_width}px`);
    if (spec.min_height && img.height < spec.min_height) problems.push(`Height ${img.height}px; minimum ${spec.min_height}px`);
    const ratio = img.width / img.height;
    const best = spec.ratios
      .map((r) => ({ ...r, off: Math.abs(ratio / (r.w / r.h) - 1) }))
      .sort((a, b) => a.off - b.off)[0];
    if (best.off > best.tolerance) {
      problems.push(`Ratio ${ratioLabel(img.width, img.height)} (${ratio.toFixed(2)}); ${spec.label} wants ${spec.ratios.map((r) => r.name).join(' or ')} (recommended ${spec.recommended})`);
    }
    const base = { rule_id: rule.id, title: rule.title, reason: rule.reason, source: spec.source, origin: 'local', platforms: [pid], field: 'image' };
    if (problems.length) {
      for (const p of problems) findings.push({ ...base, severity: rule.severity, detail: p, excerpt: img.name || '' });
    } else {
      passed.push({ rule_id: rule.id, platform: pid, title: `${spec.label}: ${img.width}x${img.height} fits ${best.name}`, source: spec.source });
    }
  }
  return { findings, passed };
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}
function ratioLabel(w, h) {
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  return a <= 50 && b <= 50 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
}

/**
 * Safe-zone check. The model only reports where text/logos are (boxes in 0-1000 units);
 * the rule itself (which margins are unsafe) is applied here with the platform's exact numbers.
 */
export function checkSafeZones(pack, boxes, platformIds) {
  const findings = [];
  const passed = [];
  for (const pid of platformIds) {
    const spec = pack.platforms[pid]?.image;
    const zone = spec?.safe_zone;
    if (!zone) continue;
    const rule = pack.rules.find((r) => r.id === zone.rule);
    const bad = [];
    for (const b of boxes || []) {
      const x0 = b.x_min / 1000, y0 = b.y_min / 1000, x1 = b.x_max / 1000, y1 = b.y_max / 1000;
      const where = [];
      if (y0 < zone.top) where.push(`top ${Math.round(zone.top * 100)}%`);
      if (y1 > 1 - zone.bottom) where.push(`bottom ${Math.round(zone.bottom * 100)}%`);
      if (x0 < zone.left) where.push(`left ${Math.round(zone.left * 100)}%`);
      if (x1 > 1 - zone.right) where.push(`right ${Math.round(zone.right * 100)}%`);
      if (where.length) bad.push(`${b.kind || 'text'} "${(b.label || '').slice(0, 40)}" sits in the ${where.join(', ')}`);
    }
    if (bad.length) {
      for (const d of bad) findings.push({ rule_id: rule.id, severity: rule.severity, title: rule.title, reason: rule.reason, source: rule.source, origin: 'ai+local', platforms: [pid], field: 'image', detail: d, excerpt: '' });
    } else {
      passed.push({ rule_id: rule.id, platform: pid, title: rule.title, source: rule.source });
    }
  }
  return { findings, passed };
}
