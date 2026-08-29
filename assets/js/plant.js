/* ==========================================================================
   FundSprout — Plant & Life Tree Rendering Engine
   Generates parametric SVG illustrations for 7 growth stages, tuned per
   plant type, with a "health" factor (0–1) controlling leaf color/density
   independent of growth stage (used by the dashboard Life Tree).
   ========================================================================== */

const STAGE_NAMES = ['Seed', 'Sprout', 'Young Plant', 'Healthy Plant', 'Growing Tree', 'Large Tree', 'Blooming Tree'];
const STAGE_DESCRIPTIONS = [
  'Just getting started. Add savings to help it sprout.',
  'A tiny sprout has broken through — keep it up.',
  'Growing steadily with its first true leaves.',
  'Healthy and thriving with a fuller canopy.',
  'Reaching upward — a real tree is taking shape.',
  'Tall and strong, almost at full bloom.',
  'In full bloom — this goal is thriving.'
];

const TYPE_PALETTE = {
  Tree:      { leaf: '#22C55E', leafDark: '#16A34A', trunk: '#8B5E3C', flower: '#FBBF24' },
  Flower:    { leaf: '#34D399', leafDark: '#10B981', trunk: '#7A9B57', flower: '#F472B6' },
  Bonsai:    { leaf: '#4ADE80', leafDark: '#15803D', trunk: '#6B4226', flower: '#FDE68A' },
  Fern:      { leaf: '#2DD4BF', leafDark: '#0D9488', trunk: '#5B7553', flower: '#A7F3D0' },
  Succulent: { leaf: '#65D6AD', leafDark: '#0EA5A5', trunk: '#7A6A53', flower: '#FBCFE8' },
  Cactus:    { leaf: '#4ADE80', leafDark: '#22C55E', trunk: '#6B8E23', flower: '#F87171' },
  Bamboo:    { leaf: '#86EFAC', leafDark: '#22C55E', trunk: '#A3A847', flower: '#FDE047' },
  Sunflower: { leaf: '#4ADE80', leafDark: '#16A34A', trunk: '#8B7536', flower: '#FBBF24' }
};

function stageInfo(stage) {
  const s = Utils.clamp(stage, 0, 6);
  return { name: STAGE_NAMES[s], description: STAGE_DESCRIPTIONS[s] };
}

/**
 * Compute a growth stage index (0-6) from a percentage 0-100.
 */
function stageFromPercent(pct) {
  pct = Utils.clamp(pct, 0, 100);
  if (pct <= 0) return 0;
  if (pct < 15) return 1;
  if (pct < 35) return 2;
  if (pct < 55) return 3;
  if (pct < 75) return 4;
  if (pct < 100) return 5;
  return 6;
}

function leafPath(cx, cy, w, h, rot, color, animate, delay) {
  const cls = animate ? 'leaf-sway' : '';
  const style = delay ? `style="animation-delay:${delay}ms"` : '';
  return `<g class="${cls}" ${style} transform="translate(${cx},${cy}) rotate(${rot})">
    <path d="M0,0 C ${w * 0.5},-${h * 0.55} ${w},-${h * 0.3} 0,-${h} C -${w},-${h * 0.3} -${w * 0.5},-${h * 0.55} 0,0 Z" fill="${color}" opacity="0.95"/>
    <path d="M0,-${h * 0.08} L0,-${h * 0.92}" stroke="rgba(0,0,0,0.12)" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;
}

function flowerBloom(cx, cy, color, scale = 1, delay = 0) {
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const angle = (360 / 5) * i;
    petals.push(`<ellipse cx="0" cy="-${6 * scale}" rx="${3.2 * scale}" ry="${5.4 * scale}" fill="${color}" transform="rotate(${angle})" />`);
  }
  return `<g class="bloom" style="animation-delay:${delay}ms" transform="translate(${cx},${cy})">
    ${petals.join('')}
    <circle r="${2.6 * scale}" fill="#FDE68A"/>
  </g>`;
}

/**
 * Renders full SVG markup for a plant/tree at a given stage.
 * @param {object} opts { stage(0-6), type, health(0-1), animate(bool), size }
 */
function renderPlant({ stage = 0, type = 'Tree', health = 1, animate = true, id = '' } = {}) {
  stage = Utils.clamp(stage, 0, 6);
  health = Utils.clamp(health, 0, 1);
  const pal = TYPE_PALETTE[type] || TYPE_PALETTE.Tree;
  // Interpolate leaf color between dull (low health) and vivid (full health)
  const leafColor = health > 0.55 ? pal.leaf : (health > 0.25 ? mixColor(pal.leaf, '#8B8F86', 0.45) : mixColor(pal.leaf, '#6B6F66', 0.7));
  const leafDark = health > 0.55 ? pal.leafDark : mixColor(pal.leafDark, '#5B5F56', 0.4);
  const trunkColor = pal.trunk;
  const swayCls = animate ? 'sway-group' : '';

  // Ground/pot
  const pot = `
    <ellipse cx="60" cy="152" rx="30" ry="6" fill="rgba(0,0,0,0.18)"/>
    <path d="M35,116 L85,116 L79,150 A20,7 0 0 1 41,150 Z" fill="#2A2E38"/>
    <path d="M35,116 L85,116 L83,124 L37,124 Z" fill="#363B47"/>
  `;

  let content = '';

  if (stage === 0) {
    // Seed — a small seed resting in soil
    content = `
      <ellipse cx="60" cy="112" rx="9" ry="7" fill="${trunkColor}" />
      <ellipse cx="57" cy="109" rx="3" ry="2" fill="rgba(255,255,255,0.25)" />
    `;
  } else if (stage === 1) {
    // Sprout — thin stem with two tiny cotyledon leaves
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C60,104 60,98 60,92" stroke="${leafDark}" stroke-width="3" stroke-linecap="round" fill="none"/>
        ${leafPath(60, 96, 9, 14, -35, leafColor, animate, 0)}
        ${leafPath(60, 96, 9, 14, 35, leafColor, animate, 150)}
      </g>
    `;
  } else if (stage === 2) {
    // Young plant — small stem, 4 leaves
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C59,100 61,84 60,72" stroke="${leafDark}" stroke-width="4" stroke-linecap="round" fill="none"/>
        ${leafPath(60, 100, 11, 17, -40, leafColor, animate, 0)}
        ${leafPath(60, 100, 11, 17, 40, leafColor, animate, 120)}
        ${leafPath(60, 82, 12, 19, -30, leafColor, animate, 240)}
        ${leafPath(60, 82, 12, 19, 30, leafColor, animate, 360)}
        ${leafPath(60, 70, 10, 16, 0, leafDark, animate, 480)}
      </g>
    `;
  } else if (stage === 3) {
    // Healthy plant — bushier, more leaves, slight stem thickness
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C58,96 62,76 60,58" stroke="${leafDark}" stroke-width="5" stroke-linecap="round" fill="none"/>
        ${leafPath(60, 104, 13, 20, -45, leafColor, animate, 0)}
        ${leafPath(60, 104, 13, 20, 45, leafColor, animate, 100)}
        ${leafPath(60, 86, 14, 21, -32, leafDark, animate, 200)}
        ${leafPath(60, 86, 14, 21, 32, leafColor, animate, 300)}
        ${leafPath(60, 68, 13, 20, -20, leafColor, animate, 400)}
        ${leafPath(60, 68, 13, 20, 20, leafDark, animate, 500)}
        ${leafPath(60, 56, 11, 17, 0, leafColor, animate, 600)}
      </g>
    `;
  } else if (stage === 4) {
    // Growing tree — visible canopy forming, thicker trunk
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C57,90 63,64 60,42" stroke="${trunkColor}" stroke-width="7" stroke-linecap="round" fill="none"/>
        <ellipse cx="60" cy="48" rx="30" ry="24" fill="${leafDark}" opacity="0.9"/>
        <ellipse cx="46" cy="56" rx="20" ry="16" fill="${leafColor}" opacity="0.95"/>
        <ellipse cx="76" cy="54" rx="19" ry="15" fill="${leafColor}" opacity="0.95"/>
        <ellipse cx="60" cy="38" rx="21" ry="17" fill="${leafColor}"/>
        ${leafPath(38, 78, 10, 15, -50, leafColor, animate, 0)}
        ${leafPath(82, 76, 10, 15, 50, leafColor, animate, 200)}
      </g>
    `;
  } else if (stage === 5) {
    // Large tree — full canopy, thick trunk with texture
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C56,86 64,54 60,30" stroke="${trunkColor}" stroke-width="9" stroke-linecap="round" fill="none"/>
        <path d="M60,90 C50,84 44,76 42,68" stroke="${trunkColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M60,80 C70,74 76,66 78,58" stroke="${trunkColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <ellipse cx="60" cy="34" rx="38" ry="30" fill="${leafDark}"/>
        <ellipse cx="38" cy="46" rx="24" ry="19" fill="${leafColor}" opacity="0.96"/>
        <ellipse cx="84" cy="44" rx="23" ry="18" fill="${leafColor}" opacity="0.96"/>
        <ellipse cx="60" cy="20" rx="26" ry="20" fill="${leafColor}"/>
        <ellipse cx="60" cy="40" rx="16" ry="12" fill="${leafDark}" opacity="0.7"/>
      </g>
    `;
  } else {
    // Blooming tree — full canopy plus flowers
    content = `
      <g class="${swayCls}">
        <path d="M60,116 C56,86 64,54 60,28" stroke="${trunkColor}" stroke-width="9" stroke-linecap="round" fill="none"/>
        <path d="M60,88 C50,82 44,74 42,66" stroke="${trunkColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M60,78 C70,72 76,64 78,56" stroke="${trunkColor}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <ellipse cx="60" cy="32" rx="40" ry="31" fill="${leafDark}"/>
        <ellipse cx="36" cy="44" rx="25" ry="20" fill="${leafColor}" opacity="0.97"/>
        <ellipse cx="86" cy="42" rx="24" ry="19" fill="${leafColor}" opacity="0.97"/>
        <ellipse cx="60" cy="16" rx="27" ry="21" fill="${leafColor}"/>
        ${flowerBloom(38, 34, pal.flower, 1, 0)}
        ${flowerBloom(78, 30, pal.flower, 0.9, 150)}
        ${flowerBloom(58, 12, pal.flower, 1.1, 300)}
        ${flowerBloom(88, 52, pal.flower, 0.8, 450)}
        ${flowerBloom(30, 56, pal.flower, 0.85, 600)}
      </g>
    `;
  }

  return `
  <svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg" class="tree-svg" role="img" aria-label="${STAGE_NAMES[stage]} illustration">
    ${pot}
    ${content}
  </svg>`;
}

function mixColor(hex1, hex2, weight) {
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  const r = Math.round(c1.r + (c2.r - c1.r) * weight);
  const g = Math.round(c1.g + (c2.g - c1.g) * weight);
  const b = Math.round(c1.b + (c2.b - c1.b) * weight);
  return `rgb(${r},${g},${b})`;
}
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

const Plant = { render: renderPlant, stageInfo, stageFromPercent, STAGE_NAMES, STAGE_DESCRIPTIONS };
