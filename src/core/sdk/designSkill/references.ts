/**
 * web-design-engineer 参考文档库(vendored,生成物勿手改内容)
 *
 * 由 scripts/gen-design-skill.mjs 生成;上游:ConardLi garden-skills web-design-engineer
 * v1.2.2(https://github.com/ConardLi/garden-skills/tree/main/skills/web-design-engineer);© ConardLi,MIT License。
 * vendored: 2026-08-27;共 29 个参考文件(119604 字节)。
 * 上游升级 = 重跑生成器刷新本文件 + 手工对齐 skillDoc.ts 的适配(三处嫁接,见其文件头)。
 *
 * name = 含 references/ 前缀的相对路径(与主文内 "read references/…" 的引用 1:1;load_skill(name, ref) 按此精确匹配);
 * 配方类 description 从文件头 Title/Vibe 机械提取,顶层 4 个手写(生成器内 TOP_DESC)。
 */
import type { SkillRefSpec } from '../../harness/skills'

export const DESIGN_REFERENCES: SkillRefSpec[] = [
  {
    name: 'references/advanced-patterns.md',
    description: "Code templates: device frames, slide engine, animation timeline, Tweaks panel, design canvas, dark mode, data viz, oklch color system, font picks, pinned React+CDN tags",
    getContent: () => `
# Advanced Reference: Component Patterns & Code Templates

This file contains advanced patterns and code templates to reference when implementing specific tasks.

## Table of Contents

1. [Responsive Slide Engine](#responsive-slide-engine)
2. [Device Simulation Frames](#device-simulation-frames)
3. [Tweaks Panel Implementation](#tweaks-panel-implementation)
4. [Animation Timeline Engine](#animation-timeline-engine)
5. [Design Canvas (Multi-option Comparison)](#design-canvas)
6. [Dark Mode Toggle](#dark-mode-toggle)
7. [Data Visualization Templates](#data-visualization-templates)

---

## Responsive Slide Engine

For building fixed-size presentations that auto-fit to any viewport.

**Key conventions**:
- Internal arrays use 0-indexed, **but numbers displayed to the user are always 1-indexed**
- Each \`<section class="slide">\` gets \`data-screen-label="01 Title"\`, \`data-screen-label="02 Agenda"\`, etc. for easy reference
- Control buttons go **outside** the \`.stage\` scaled container to ensure usability on small screens

\`\`\`html
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    background: #000; 
    display: flex; 
    align-items: center; 
    justify-content: center;
    height: 100vh;
    overflow: hidden;
    font-family: system-ui, sans-serif;
  }
  .stage {
    width: 1920px;
    height: 1080px;
    position: relative;
    transform-origin: center center;
  }
  .slide {
    position: absolute;
    inset: 0;
    display: none;
    padding: 80px;
  }
  .slide.active { display: flex; }
  .controls {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    z-index: 1000;
  }
  .controls button {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    background: rgba(255,255,255,0.15);
    color: white;
    cursor: pointer;
    font-size: 14px;
  }
  .slide-counter {
    position: fixed;
    bottom: 20px;
    right: 20px;
    color: rgba(255,255,255,0.6);
    font-size: 14px;
  }
</style>

<script>
  // Auto-fit scaling
  function scaleStage() {
    const stage = document.querySelector('.stage');
    const scaleX = window.innerWidth / 1920;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY);
    stage.style.transform = \`scale(\${scale})\`;
  }
  window.addEventListener('resize', scaleStage);
  scaleStage();

  // Slide navigation
  let current = parseInt(localStorage.getItem('slideIndex') || '0');
  const slides = document.querySelectorAll('.slide');
  
  function showSlide(n) {
    current = Math.max(0, Math.min(n, slides.length - 1));
    slides.forEach((s, i) => s.classList.toggle('active', i === current));
    localStorage.setItem('slideIndex', current);
    // Display 1-indexed to user, store 0-indexed internally
    document.querySelector('.slide-counter').textContent = \`\${current + 1} / \${slides.length}\`;
  }
  
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === ' ') showSlide(current + 1);
    if (e.key === 'ArrowLeft') showSlide(current - 1);
  });
  
  showSlide(current);
</script>
\`\`\`

---

## Device Simulation Frames

### iPhone Frame

\`\`\`jsx
const IPhoneFrame = ({ children, title = "App" }) => (
  <div style={{
    width: 390,
    height: 844,
    borderRadius: 48,
    border: '12px solid #1a1a1a',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    background: '#fff'
  }}>
    {/* Status bar */}
    <div style={{
      height: 54,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      fontSize: 14,
      fontWeight: 600
    }}>
      <span>9:41</span>
      <div style={{
        width: 126,
        height: 34,
        background: '#1a1a1a',
        borderRadius: 20,
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 8
      }} />
      <span>⚡ 📶</span>
    </div>
    {/* Content */}
    <div style={{ height: 'calc(100% - 54px)', overflow: 'auto' }}>
      {children}
    </div>
    {/* Home indicator */}
    <div style={{
      position: 'absolute',
      bottom: 8,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 134,
      height: 5,
      background: '#1a1a1a',
      borderRadius: 3
    }} />
  </div>
);
\`\`\`

### Browser Window Frame

\`\`\`jsx
const BrowserFrame = ({ children, url = "https://example.com", title = "Page" }) => (
  <div style={{
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    border: '1px solid #e5e5e5'
  }}>
    {/* Title bar */}
    <div style={{
      background: '#f5f5f5',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: '1px solid #e5e5e5'
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
      </div>
      <div style={{
        flex: 1,
        background: '#fff',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 13,
        color: '#666',
        border: '1px solid #e0e0e0'
      }}>
        {url}
      </div>
    </div>
    {/* Content */}
    <div style={{ background: '#fff' }}>
      {children}
    </div>
  </div>
);
\`\`\`

---

## Tweaks Panel Implementation

\`\`\`jsx
const TweaksPanel = ({ config, onChange, visible }) => {
  if (!visible) return null;
  
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      width: 280,
      background: 'rgba(24, 24, 27, 0.95)',
      backdropFilter: 'blur(12px)',
      borderRadius: 12,
      padding: 16,
      color: '#fff',
      fontSize: 13,
      zIndex: 9999,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Tweaks</div>
      
      {Object.entries(config).map(([key, value]) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, opacity: 0.7 }}>
            {key}
          </label>
          {typeof value === 'boolean' ? (
            <input
              type="checkbox"
              checked={value}
              onChange={e => onChange({ ...config, [key]: e.target.checked })}
            />
          ) : typeof value === 'number' ? (
            <input
              type="range"
              min="0"
              max="100"
              value={value}
              onChange={e => onChange({ ...config, [key]: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          ) : value.startsWith('#') ? (
            <input
              type="color"
              value={value}
              onChange={e => onChange({ ...config, [key]: e.target.value })}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={e => onChange({ ...config, [key]: e.target.value })}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                padding: '4px 8px',
                color: '#fff'
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
\`\`\`

---

## Animation Timeline Engine

\`\`\`jsx
const useTime = (duration = 5000) => {
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const frameRef = React.useRef();
  const startRef = React.useRef();
  
  React.useEffect(() => {
    if (!playing) return;
    const animate = (timestamp) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = (timestamp - startRef.current) % duration;
      setTime(elapsed / duration); // 0 to 1
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing, duration]);
  
  return { time, playing, setPlaying };
};

const Easing = {
  linear: t => t,
  easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  easeIn: t => t * t * t,
  spring: t => 1 - Math.pow(Math.E, -6 * t) * Math.cos(8 * t)
};

const interpolate = (t, from, to, easing = Easing.easeInOut) => {
  const progress = easing(Math.max(0, Math.min(1, t)));
  return from + (to - from) * progress;
};

// Usage example:
// const { time } = useTime(3000);
// const opacity = interpolate(time, 0, 1);
// const x = interpolate(time, -100, 0, Easing.spring);
\`\`\`

---

## Design Canvas

For displaying multiple design options side by side for comparison:

\`\`\`jsx
const DesignCanvas = ({ options, columns = 3 }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: \`repeat(\${columns}, 1fr)\`,
    gap: 24,
    padding: 40,
    background: '#f8f9fa',
    minHeight: '100vh'
  }}>
    {options.map((option, i) => (
      <div key={i} style={{
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #eee',
          fontSize: 13,
          fontWeight: 600,
          color: '#666'
        }}>
          Option {String.fromCharCode(65 + i)}: {option.label}
        </div>
        <div style={{ padding: 16 }}>
          {option.content}
        </div>
      </div>
    ))}
  </div>
);
\`\`\`

---

## Dark Mode Toggle

\`\`\`jsx
const ThemeProvider = ({ children }) => {
  const [dark, setDark] = React.useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  
  const theme = dark ? {
    bg: '#0a0a0b',
    surface: '#18181b',
    border: '#27272a',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    primary: '#3b82f6'
  } : {
    bg: '#ffffff',
    surface: '#f4f4f5',
    border: '#e4e4e7',
    text: '#18181b',
    textMuted: '#71717a',
    primary: '#2563eb'
  };
  
  return (
    <ThemeContext.Provider value={{ theme, dark, setDark }}>
      <div style={{ background: theme.bg, color: theme.text, minHeight: '100vh' }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
};
\`\`\`

---

## Data Visualization Templates

### Chart.js Quick Start

\`\`\`html
<canvas id="myChart" width="800" height="400"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  const ctx = document.getElementById('myChart').getContext('2d');
  new Chart(ctx, {
    type: 'line', // bar, pie, doughnut, radar, etc.
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Revenue',
        data: [12, 19, 3, 5, 2, 3],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f0f0f0' } },
        x: { grid: { display: false } }
      }
    }
  });
</script>
\`\`\`

---

## Color System Best Practices

Use oklch to define a harmonious color system:

\`\`\`css
:root {
  /* oklch-based color system */
  --primary-h: 250;  /* hue */
  --primary: oklch(0.55 0.25 var(--primary-h));
  --primary-light: oklch(0.75 0.15 var(--primary-h));
  --primary-dark: oklch(0.35 0.2 var(--primary-h));
  
  /* Neutrals */
  --gray-50: oklch(0.98 0.002 250);
  --gray-100: oklch(0.96 0.004 250);
  --gray-200: oklch(0.92 0.006 250);
  --gray-300: oklch(0.87 0.008 250);
  --gray-400: oklch(0.71 0.01 250);
  --gray-500: oklch(0.55 0.014 250);
  --gray-600: oklch(0.45 0.014 250);
  --gray-700: oklch(0.37 0.014 250);
  --gray-800: oklch(0.27 0.014 250);
  --gray-900: oklch(0.21 0.014 250);
}
\`\`\`

---

## Font Recommendations (Non-default Choices)

> ⚠️ **These are experience-based suggestions, not hard rules.**
> - Always prefer fonts already specified by the brand or design system; only refer to this table when the user hasn't provided any font scheme.
> - The only hard rule: **Avoid Inter / Roboto / Arial / Fraunces / system-ui — fonts overused by AI-generated content** that instantly signal "this was assembled by AI."
> - When choosing fonts, focus on "personality fit" rather than "what's trendy." The table below lists common high-quality choices, not an exhaustive list.

| Use Case | Recommendation | Google Fonts Name |
|------|------|------------------|
| Modern headings | Plus Jakarta Sans | Plus+Jakarta+Sans |
| Elegant body text | Outfit | Outfit |
| Technical feel | Space Grotesk | Space+Grotesk |
| Premium brand | Sora | Sora |
| Editorial feel | Newsreader | Newsreader |
| Handwritten style | Caveat | Caveat |
| Monospace / code | JetBrains Mono | JetBrains+Mono |

\`\`\`html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
\`\`\`

---

## Color × Font Pairing Reference

> ⚠️ **These are experience-based pairing suggestions, not hard rules.** When you have **absolutely no design context**, pick one as a starting point — it's far better than starting from Inter + #3b82f6.
> Once the user provides a brand / design system / reference site, drop this table immediately and follow their materials.

For quickly establishing a visual system with personality:

| Style | Primary Color (oklch) | Font Pairing | Best For |
|---|---|---|---|
| Modern tech | \`oklch(0.55 0.25 250)\` blue-violet | Space Grotesk + Inter | SaaS, dev tools, AI products |
| Elegant editorial | \`oklch(0.35 0.10 30)\` warm brown | Newsreader + Outfit | Content platforms, blogs, editorial |
| Premium brand | \`oklch(0.20 0.02 250)\` near-black | Sora + Plus Jakarta Sans | Luxury, consulting, finance |
| Lively consumer | \`oklch(0.70 0.20 30)\` coral | Plus Jakarta Sans + Outfit | E-commerce, lifestyle, social |
| Minimal professional | \`oklch(0.50 0.15 200)\` teal-blue | Outfit + Space Grotesk | Data products, dashboards, B2B |
| Artisan warmth | \`oklch(0.55 0.15 80)\` caramel | Caveat (decorative) + Newsreader | Food & beverage, education, creative |

Avoid these combos:
- ❌ Inter + Roboto + blue buttons (peak AI aesthetic)
- ❌ Fraunces + purple-pink gradients (overused)
- ❌ More than three font families (visual chaos)

`,
  },
  {
    name: 'references/critique-guide.md',
    description: "Critique scoring rubrics: per-output-type weighting, top-10 common issues, detailed 5-dimension scoring",
    getContent: () => `
# Critique Mode — Detailed Reference

Read this when running Step 7 of the workflow (user asked for review, or self-check before delivery). The main \`SKILL.md\` already covers the **5 dimensions and output format**. This file provides **scoring rubrics, per-output-type weighting, and the common-issue catalog**.

**Critique the design, not the designer.** Be specific, actionable, and grounded in design language — not vague taste claims.

---

## The Five Dimensions — Detailed Rubrics

### 1. Philosophy Alignment

How well does every detail trace back to the chosen design direction (Pentagram-style information architecture, Kenya Hara-style minimalism, etc.)?

| Score | Standard |
|---|---|
| 9–10 | Every detail embodies the chosen philosophy; nothing reads as "borrowed from elsewhere" |
| 7–8 | Direction is correct, signature traits land, 1–2 minor drift moments |
| 5–6 | Intent visible, but mixed-in foreign elements dilute purity (e.g., "minimalism" with 6 cards per row) |
| 3–4 | Surface mimicry only; the underlying values aren't understood |
| 1–2 | No discernible relationship to any stated direction |

**What to look for**:
- Are signature moves of the chosen designer/studio actually present?
- Do color, type, layout, motion all agree on the same philosophy?
- Any "self-contradicting" elements? (Picked Kenya Hara then crammed the page full → contradiction)

### 2. Visual Hierarchy

Does the eye flow where the designer intends?

| Score | Standard |
|---|---|
| 9–10 | Eye flows naturally along the intended path; zero friction reading the information |
| 7–8 | Primary/secondary clear; 1–2 spots where hierarchy is muddy |
| 5–6 | Title vs. body distinguishable, but middle layers (subtitles, captions) collapse together |
| 3–4 | Information sits flat with no clear entry point |
| 1–2 | Chaotic — viewer doesn't know where to look first |

**What to look for**:
- Title vs. body size ratio ≥ 2.5× (ideally 4–6× for hero)?
- Color / weight / size building 3–4 clear levels?
- Whitespace actively guiding the eye?
- **Squint test**: squint at the screen — is the hierarchy still legible?

### 3. Craft Quality

Pixel-level execution: alignment, spacing, color discipline.

| Score | Standard |
|---|---|
| 9–10 | Pixel-perfect; alignment, spacing, color all flawless |
| 7–8 | Refined overall; 1–2 minor alignment or spacing issues |
| 5–6 | Basically aligned, but spacing is inconsistent and color use is unsystematic |
| 3–4 | Obvious alignment errors, chaotic spacing, too many colors |
| 1–2 | Sloppy — looks like a draft |

**What to look for**:
- Consistent spacing system (8pt grid: 8 / 16 / 24 / 32 / 48 / 64)?
- Same-class elements use identical spacing?
- Color count controlled (typically ≤ 4 — primary + accent + neutral scale + 1 emphasis)?
- Font families ≤ 2 (1 display + 1 body)?
- Edges align precisely?

### 4. Functionality

Does each element earn its place?

| Score | Standard |
|---|---|
| 9–10 | Every element serves a goal; zero redundancy |
| 7–8 | Function-led overall, with minor decoration that could be cut |
| 5–6 | Usable, but obvious decorative elements compete for attention |
| 3–4 | Form > function; users have to work to find information |
| 1–2 | Decoration drowns the content's ability to communicate |

**What to look for**:
- The deletion test: "If I delete this element, does the design get worse?" If no → delete
- Is the CTA / key information in the most prominent position?
- Anything added "because it looked good"?
- Is the information density appropriate for the medium? (PPT sparse; PDF can be denser; landing page conversion-focused)

### 5. Originality

Avoids clichés while staying coherent within the philosophy.

| Score | Standard |
|---|---|
| 9–10 | Refreshing; finds a unique expression *within* the chosen philosophy |
| 7–8 | Has its own ideas; not template-by-numbers |
| 5–6 | Average; reads as a template execution |
| 3–4 | Heavy use of clichés (gradient orbs for "AI", chat bubbles for "conversation") |
| 1–2 | Pure template / stock-asset assembly |

**What to look for**:
- Has it avoided the AI-slop list (purple gradients, emoji icons, left-border accent cards, Inter as display)?
- Is there at least one "unexpected but right" decision?
- Any element that screams "made by AI"?

---

## Per-Output-Type Weighting

Different outputs need different priorities. When scoring, weight these dimensions higher for each context:

| Output type | Most important | Secondary | Can relax |
|---|---|---|---|
| Landing page / marketing site | Functionality, Visual hierarchy | Originality | — (must be all-around) |
| Dashboard / data product | Functionality, Craft quality | Visual hierarchy | Originality (clarity wins) |
| HTML slide deck | Visual hierarchy, Functionality | Craft | Originality (legibility wins) |
| Mobile app prototype | Functionality, Craft | Visual hierarchy | Philosophy alignment (usability wins) |
| Brand launch animation / hero film | Originality, Visual hierarchy | Philosophy | Functionality (it's the moment, not the form) |
| Editorial / portfolio | Originality, Philosophy | Visual hierarchy | Functionality (vibe matters most) |
| Documentation site | Functionality, Visual hierarchy | Craft | Originality (find-the-answer wins) |
| Interactive prototype for user testing | Functionality, Visual hierarchy | Craft | Originality (testing the flow, not the look) |

---

## Common Issues — Top 10 Catalog

Use these as a checklist when running a critique. Each entry has the issue, why it matters, and the fix.

### 1. AI-tech cliché
**Issue**: Gradient orbs, digital rain, blue circuit boards, robot faces
**Why it's a problem**: Audience is exhausted by these — your product becomes indistinguishable
**Fix**: Use abstract metaphors instead of literal symbols (e.g., a "conversation" metaphor instead of a chat bubble icon)

### 2. Insufficient type-size hierarchy
**Issue**: Title and body are too similar in size (< 2.5×)
**Why**: Users can't find key information quickly
**Fix**: Title at least 3× body (16px body → 48–64px title; for hero, 6× is normal)

### 3. Too many colors
**Issue**: 5+ colors in use without a clear primary/secondary structure
**Why**: Visual chaos; weak brand identity
**Fix**: Limit to 1 primary + 1 secondary + 1 accent + grayscale; everything else has to justify itself

### 4. Inconsistent spacing
**Issue**: Element spacing chosen ad-hoc with no system
**Why**: Reads as unprofessional; visual rhythm broken
**Fix**: Adopt an 8pt grid (only use spacing values from {8, 16, 24, 32, 48, 64, 96})

### 5. Insufficient whitespace
**Issue**: Every region is filled with content
**Why**: Cognitive overload reduces information transfer; dense ≠ informative
**Fix**: Whitespace should be at least 40% of total area (60%+ for minimalist)

### 6. Too many fonts
**Issue**: 3+ font families in use
**Why**: Visual noise; weakens unity
**Fix**: At most 2 (1 display + 1 body); use weight and size variation for richness

### 7. Inconsistent alignment
**Issue**: Mixed left-, center-, and right-aligned blocks
**Why**: Breaks visual order
**Fix**: Pick one alignment (typically left) and apply globally; centered alignment only for hero / pull-quote moments

### 8. Decoration eclipses content
**Issue**: Background patterns / gradients / shadows steal focus from primary content
**Why**: Inverts the priority — users came for information, not for decoration
**Fix**: Apply the deletion test: "if I remove this decoration, does the design get worse?" If no → remove

### 9. Cyber-neon overuse
**Issue**: Dark navy \`#0D1117\` + neon-glow accents
**Why**: This is the GitHub-dark / "AI dev tool" cliché — every clone looks the same
**Fix**: Pick a more distinctive palette; if dark mode is mandatory, choose a non-default base (deep warm gray, near-black with hint of color)

### 10. Information density mismatched to medium
**Issue**: A wall of text on a slide; 10 elements crammed into a social cover
**Why**: Different media have different optimal density
**Fix**:
- Slides: 1 core idea per page
- Cover image: 1 visual focal point
- Infographic: layered (overview → detail)
- PDF / docs: can be dense, but needs clear navigation

---

## Output Template (copy this when delivering a critique)

\`\`\`markdown
## Design Critique

**Overall: X.X / 10** [Excellent (8+) / Good (6–7.9) / Needs work (4–5.9) / Failing (<4)]

**By dimension**:
- Philosophy alignment: X / 10 — [one-sentence reason]
- Visual hierarchy: X / 10 — [one-sentence reason]
- Craft quality: X / 10 — [one-sentence reason]
- Functionality: X / 10 — [one-sentence reason]
- Originality: X / 10 — [one-sentence reason]

### Keep
- [Specific things done well, in design language — not "the colors are nice", say "the muted terracotta against warm off-white reads as confident and editorial"]

### Fix (sorted by severity)

**1. [Issue name]** — ⚠️ Critical / ⚡ Important / 💡 Polish
- Current: [what it looks like now]
- Why: [why it's a problem, anchored in a principle above]
- Fix: [concrete change with specific values — "increase title size from 32px to 56px", not "make titles bigger"]

**2. [Issue name]** — ⚠️ / ⚡ / 💡
…

### Quick Wins (top 3 if you only have 5 minutes)
- [ ] [Highest-impact change that takes the least time]
- [ ] [Second]
- [ ] [Third]
\`\`\`

---

## Critique Anti-Patterns

❌ **Vague taste claims**: "the colors are off" → bad. "The accent saturation is too high — at oklch(0.65 0.25 25) it competes with the primary; reduce to 0.18 chroma to subordinate it" → good.

❌ **Praise without specifics**: "looks great!" provides zero learning. Always say *what* is great and *why*.

❌ **Mixing severity**: putting a critical hierarchy bug next to a polish-level color tweak in the same list. Always sort by ⚠️ → ⚡ → 💡.

❌ **More than 7 fix items**: cognitive overload. If there are more, group them — "five spacing inconsistencies" as one item, not five.

❌ **Critiquing without grounding**: every "Fix" should reference a principle (hierarchy, craft, philosophy, etc.) so the user understands the *why*, not just the *what*.

❌ **Critiquing the designer instead of the design**: "you didn't think this through" is unhelpful and not the agent's role. "This element doesn't earn its place — consider removing" is the right framing.

`,
  },
  {
    name: 'references/design-directions.md',
    description: "Design Direction Advisor library: 6-school taxonomy, per-school anchor tables, AI-prompt templates (for vague \"give me directions\" requests)",
    getContent: () => `
# Design Direction Advisor — Extended Reference

Read this when the request is vague ("make something nice", "I don't know what style I want") and no design context exists. The main \`SKILL.md\` already covers the **mechanism** (3 differentiated directions, named designer references, hard rule against same-school picks). This file provides the **school taxonomy** — six high-level philosophical lenses, each with named anchors and the sample copy you use to recommend it.

> **Terminology lock**: this file deals in **schools** (six high-level lenses) and **anchors** (named studios / brands / designers per school). The companion folder \`style-recipes/\` contains 25 **recipe** files — one file per anchor — with concrete, ready-to-paste configurations. When a user picks a school here, hand them off to the recipe files in that school for concrete palette / typography / spacing values. Load only the recipe files you actually need; the catalog index is at \`style-recipes/INDEX.md\`.

---

## How to Use This File

1. Read the user's request and the four positioning questions (narrative role / viewing distance / visual temperature / capacity)
2. Pick **3 schools from different rows** below that genuinely fit the user's context
3. Recommend each with: named designer/studio + 2–3 lines of "why this fits you" + 3–4 signature visual cues + (optional) one famous touchstone work
4. Wait for the user to pick one (or remix two)
5. **After the user picks a school → read 2–3 recipe files from \`style-recipes/\` in that school** (e.g., picked *Information Architecture* → read \`style-recipes/pentagram.md\` + \`style-recipes/bloomberg-terminal.md\` + \`style-recipes/tufte-dataink.md\`). The recipe files carry the concrete values; this file does not duplicate them.
6. The chosen recipe becomes the design context — write it into \`brand-spec.md\` and proceed to the main workflow

---

## The Six Schools (1 of 3 must come from each different row)

### 1. Information Architecture

**Vibe**: Rational, data-driven, restrained, hierarchy-led
**Best for**: Safe / professional / B2B / data products / institutional
**Why it works**: Treats the page as a *system* of typographic and grid relationships. The "design" disappears so the information speaks.

| Anchor | What to borrow |
|---|---|
| **Pentagram** (Paula Scher, Michael Bierut) | Bold typography as image; identity through type relationships; sparing color use |
| **Edward Tufte** | Maximum data-ink ratio; small multiples; smallest sufficient difference |
| **Massimo Vignelli** | Helvetica-style restraint; strict grid; 6 typefaces is enough for a lifetime |
| **Bloomberg Terminal** | Mission-critical density; amber-on-near-black; monospaced data |
| **NYT / Broadsheet editorial** | Multi-deck hierarchy; serif headlines; place-rich photography |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`pentagram\`](./style-recipes/pentagram.md) · [\`vignelli-swiss-helvetica\`](./style-recipes/vignelli-swiss-helvetica.md) · [\`bloomberg-terminal\`](./style-recipes/bloomberg-terminal.md) · [\`tufte-dataink\`](./style-recipes/tufte-dataink.md) · [\`nyt-the-daily\`](./style-recipes/nyt-the-daily.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

**Sample copy when recommending**:
> "Pentagram-style information architecture — your dashboard becomes a system of typographic relationships rather than a UI. Headlines do the heavy visual lifting; everything else recedes. Best when you want institutional credibility and your data is the hero."

---

### 2. Editorial / Minimalist

**Vibe**: Whitespace, refined typography, quiet luxury, considered
**Best for**: Premium / high-end / quiet / lifestyle / prestige B2C
**Why it works**: Treats whitespace as the primary design material. The reader/viewer gets room to breathe; restraint reads as confidence.

| Anchor | What to borrow |
|---|---|
| **Kenya Hara (MUJI)** | Whiteness as a value; *ex-formation*; emptiness as fullness |
| **Apple HIG / Marketing** | Generous negative space; hero product on white; one-thought-per-screen |
| **Dieter Rams (Braun)** | "Less but better"; honest materials; functional decoration is a contradiction |
| **Aesop** | Cream/sage palette; serif copy as conversation; product as protagonist |
| **Monocle** | Magazine-grade kicker / headline / dek hierarchy; international considered |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`apple-hig\`](./style-recipes/apple-hig.md) · [\`muji-kenya-hara\`](./style-recipes/muji-kenya-hara.md) · [\`aesop\`](./style-recipes/aesop.md) · [\`dieter-rams-braun\`](./style-recipes/dieter-rams-braun.md) · [\`monocle-magazine\`](./style-recipes/monocle-magazine.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

**Sample copy when recommending**:
> "Kenya Hara-style editorial minimalism — the page is mostly whitespace, with one serif headline carrying emotional weight and the product anchored in a single hero shot. Best when premium positioning matters more than feature density."

---

### 3. Motion / Experimental

**Vibe**: Bold, generative, sensory, kinetic, technical
**Best for**: Distinctive / launch films / brand moments / awwwards-style / tech storytelling
**Why it works**: Movement and surprise are the brand. Static screenshots can't capture the experience.

| Anchor | What to borrow |
|---|---|
| **Field.io** | Generative type and form; data-driven motion; the page is a system that *makes* itself |
| **Active Theory** | WebGL hero moments; physics-driven interactions; cinematic transitions |
| **Resn** | Storytelling through scroll; payoff for exploration; surprise is the reward |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`field-io\`](./style-recipes/field-io.md) · [\`active-theory\`](./style-recipes/active-theory.md) · [\`resn-storytelling\`](./style-recipes/resn-storytelling.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

> Note: Vercel / Linear marketing pages use motion *as restraint*, not as the show — they live in the **Modern Tool / Builder SaaS** school below, not here. Reach for this school only when motion is genuinely the brand.

**Sample copy when recommending**:
> "Field.io-style motion-led identity — the page generates itself in front of the visitor through choreographed scroll-driven sequences. Best when the launch *moment* matters and your audience will share clips. Note: this is the most labor-intensive of the three; budget accordingly."

---

### 4. Brutalist / Raw

**Vibe**: Anti-design, honest, unpolished, confrontational
**Best for**: Differentiated / confident / counter-culture / publishing / artist platforms
**Why it works**: Ugly-on-purpose reads as authentic in a sea of polished AI defaults. The lack of consensus aesthetic *is* the aesthetic.

| Anchor | What to borrow |
|---|---|
| **Are.na** | Raw HTML feel; system fonts on purpose; content > chrome |
| **Bloomberg Businessweek covers** (Richard Turley era) | Typographic violence; magazine grid abused; copy as image |
| **Balenciaga** (post-2017) | Default browser styling weaponized; hero text in Helvetica at absurd scale |
| **Craigslist (yes, really)** | Information density without apology; everything is a link |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`are-na\`](./style-recipes/are-na.md) · [\`bloomberg-businessweek-turley\`](./style-recipes/bloomberg-businessweek-turley.md) · [\`balenciaga-post-2017\`](./style-recipes/balenciaga-post-2017.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

**Sample copy when recommending**:
> "Are.na/Bloomberg-style brutalism — system fonts, harsh type contrast, no rounded corners, no shadows. Confrontational on purpose. Best when you're a strong contrarian voice and want to repel the crowd that wants 'modern SaaS.' Warning: half-measures here look broken, not bold."

---

### 5. Warm Humanist

**Vibe**: Approachable, organic, hand-touched, friendly without being childish
**Best for**: Lifestyle / education / approachable B2C / community products / health
**Why it works**: Conveys that real humans made this for real humans. Counters the "robot wrote my landing page" perception.

| Anchor | What to borrow |
|---|---|
| **Mailchimp** (early Freddie era) | Hand-drawn marks; warm illustration; personality in microcopy |
| **Stripe Press** | Editorial serif + warm palette + tactile object photography |
| **Studio Dumbar** | Identity through movement and personality, not through restraint |
| **Headspace / Calm** | Soft pastels, rounded everything, breathing-pace motion |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`mailchimp-freddie\`](./style-recipes/mailchimp-freddie.md) · [\`stripe-press\`](./style-recipes/stripe-press.md) · [\`headspace-meditation\`](./style-recipes/headspace-meditation.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

> Note: Notion (pre-AI era) borrows from this school's friendly tone but lives in the **Modern Tool / Builder SaaS** school below — it's a tool first, warmth second.

**Sample copy when recommending**:
> "Stripe Press / early Mailchimp warmth — humanist serifs, cream palette, illustrations that feel hand-touched. Best when you want trust and approachability over institutional polish. Tone is 'friend who happens to be expert,' not 'expert addressing client.'"

---

### 6. Modern Tool / Builder SaaS

**Vibe**: Quiet luxury for tools, hairline detail, warm dark + monospace accents
**Best for**: Developer tools, B2B SaaS, AI tools, infrastructure / platform products, productivity apps
**Why it works**: Confident restraint reads as "made by people who use tools," not "made by marketers." Hairline borders, monospace shortcut chips, and a single accent color signal craft-led culture without shouting. This is the most under-served school in AI-default output — every model wants to reach for the purple-pink-blue gradient instead.

| Anchor | What to borrow |
|---|---|
| **Linear** | Hairline 1px borders, warm dark ground, selective purple accent < 5% of pixels, keyboard-first chips |
| **Vercel** (recent) | Black + white precision broken by *one* feathered gradient mesh; deploy-log realism in the hero |
| **Raycast** | Glassy command-palette as hero; per-extension color dots used as small accents |
| **Notion** (pre-AI era) | Friendly serif headlines + emoji-as-icon on cream surfaces; structure first, warmth second |

**Concrete starting points** (each is a single file in \`style-recipes/\` — read one): [\`linear\`](./style-recipes/linear.md) · [\`vercel-mesh\`](./style-recipes/vercel-mesh.md) · [\`raycast\`](./style-recipes/raycast.md) · [\`notion-pre-ai\`](./style-recipes/notion-pre-ai.md) — each carries the palette, typography, spacing, and signature moves to paste straight into Step 3.

**Sample copy when recommending**:
> "Linear-style modern-tool aesthetic — warm dark ground, hairline 1px borders, a single purple accent used on less than 5% of pixels, monospace shortcut chips. Best when your audience is technical and 'serious but designed' matters more than 'fun and accessible.' This is the recipe that defends most directly against AI-default Inter + blue button + 16px-radius output."

---

## When the User Picks (or Remixes)

Common user responses:

- **"I'll go with #2."** → Direction confirmed. Write it into \`brand-spec.md\`. Proceed to Step 2 with this as design context.
- **"I like A's color but C's layout."** → Confirm the remix in writing ("So: minimalist editorial palette + motion-led layout choreography. Right?"), then proceed.
- **"None of these feel right — show me more."** → Ask one targeted question to narrow ("Are you closer to formal/institutional or playful/expressive?"), then offer 3 fresh directions from rows you didn't show before.
- **"I don't know, you pick."** → Pick the safest one (usually Editorial / Minimalist), state your reasoning, and propose a 5-minute v0 to validate before committing.

---

## AI-Prompt Templates (when generating imagery to support a direction)

Format: \`[philosophy DNA] + [content description] + [technical params]\`

✅ **Good** (specific characteristics):
> "Kenya Hara-influenced minimalism with 80% whitespace, single muted terracotta (#C04A1A) accent, GT Sectra serif headline, single product hero on warm off-white (#F2EFE8) ground, soft top-down lighting, 3:2 aspect"

❌ **Bad** (style names without DNA):
> "minimalist style, premium feel, high quality"

Always include:
- Color HEX (not "warm" / "cool")
- Aspect ratio and dimensions
- Composition rules (rule-of-thirds, centered, asymmetric)
- What to *avoid* (e.g., "no purple gradient, no emoji, no rounded cards")

> Each recipe file in \`style-recipes/\` ships a pre-written **AI prompt seed** tuned to that recipe's DNA — start from the one you're using rather than writing prompts from scratch.

---

## Anti-Patterns in Direction Recommendation

❌ **Recommending 3 picks from the same row** — the user can't tell them apart; the entire point of "differentiated directions" collapses

❌ **Recommending "minimalism" / "modern" / "clean"** as the direction name — these are not directions, they are AI-default words. Always anchor on a named designer/studio.

❌ **Recommending without any "why this fits you"** — the user wanted *guidance*, not a multiple-choice quiz. Each option must explain its fit to their context (audience, purpose, budget, brand maturity).

❌ **Showing 5+ directions** — choice paralysis. 3 is the sweet spot. If the first 3 all miss, ask one narrowing question and offer 3 fresh ones.

❌ **Asking the user to score each direction 1–10** — that's offloading the recommendation back to them. Make a recommendation; the user will agree or push back.

`,
  },
  {
    name: 'references/style-recipes/active-theory.md',
    description: "Active Theory (Cinematic WebGL) · Cinematic web experiences, WebGL heroes, physical-feeling interaction",
    getContent: () => `
# active-theory — Active Theory (Cinematic WebGL)

- **School**: Motion / Experimental
- **Vibe**: Cinematic web experiences, WebGL heroes, physical-feeling interaction
- **Best for**: Brand launch sites, game / entertainment products, "experience marketing" pieces
- **Touchstone**: activetheory.net, NASA / Apple WWDC dev portals they've made, Doritos / movie tie-in launches

**Palette**
- Often a single dramatic hue from the project's content — black + one signature color from the brand or film
- High contrast — deep black + bright accent
- Tinted neutrals — never plain gray; gray-with-cast (cool blue cast for sci-fi, warm amber for cinematic)

**Typography**
- Display: a strong grotesque or a custom display face built for the campaign — Druk, Editorial New, ABC Diatype Mono
- Body type secondary — most content rides over imagery; less reading, more witnessing
- All-caps display common, with very tight or very open tracking depending on tone

**Spacing**: cinematic — content sits centered or in unexpected corners against a full-bleed canvas

**Radius**: 0

**Shadow**: from WebGL lighting, not CSS

**Motion**: feature-film-grade. Camera moves through a 3D space. Physics-driven debris / particles. The page is a stage.

**Signature moves**
- A full-screen WebGL hero scene that the user moves through (scroll = camera path)
- Real-time physics or particle systems responding to cursor / device tilt
- Carefully art-directed transitions between scenes (not generic fades)
- Sound design integrated (subtle ambient audio that ducks during text passages)
- A single moment of maximum impact — the recipe builds toward one payoff frame

**Avoid**
- Many small WebGL moments (one big set-piece is the recipe, not five small ones)
- Trying to ship a content-heavy site this way (cinematic recipes work for marketing moments, not docs)
- Reaching for off-the-shelf Three.js demos (this recipe demands hand-crafted scenes — generic WebGL reads as cheap)

**AI prompt seed**
> Cinematic VFX still, single dramatic moment from a sci-fi launch film, key light from one direction, deep shadows, single brand-accent hue floating in the scene, particle debris in air, 2.39:1 aspect.

**Don't use when**
- Performance / accessibility constraints rule out heavy WebGL
- The product is utilitarian (this recipe is for moments, not for daily use)
- The build budget is sub-3-weeks

---

> **Same school — Motion / Experimental**: [\`field-io\`](./field-io.md) · [\`resn-storytelling\`](./resn-storytelling.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/aesop.md',
    description: "Aesop Skincare · Apothecary refinement, sage and ink, serif copy as conversation",
    getContent: () => `
# aesop — Aesop Skincare

- **School**: Editorial / Minimalist
- **Vibe**: Apothecary refinement, sage and ink, serif copy as conversation
- **Best for**: Premium consumer goods (skincare, candles, eyewear), restaurants with literary aspirations, hospitality
- **Touchstone**: aesop.com, Aesop store windows, the brown amber bottle

**Palette**
- Ground: \`#E8E4D9\` (warm chamois) — sometimes \`#F2EFE5\`
- Ink: \`#1B1B1B\` (true near-black for copy)
- Sage muted: \`#7A8470\`
- Amber bottle accent: \`#7A4623\` (used very sparingly, e.g., a single rule or seal mark)
- Cream surface: \`#F0EDE4\`

**Typography**
- Display & body: a single transitional serif at every size — Suisse Works, Lyon Text, or GT Sectra (weight 400, italic available). Aesop pairs serif for body copy with a single sans for UI labels (Söhne or Helvetica Now).
- Body size: 16–18px; line-height ~1.65
- Labels in small caps (10–11px, letter-spaced 0.12em)

**Spacing**: 8 / 16 / 24 / 40 / 72 / 120

**Radius**: 0 throughout, including form fields. Aesop is square-edged.

**Shadow**: none.

**Motion**: subtle fades, slow drawer slide-ins (~450ms ease-out). Never spring-bounce.

**Signature moves**
- Body copy reads like product writing in a literary magazine — long, well-cadenced sentences, justified text, no marketing punchiness
- Product is photographed on a warm chamois surface with a single sage prop (leaf, marble dish, linen) and a long shadow
- Small-caps section labels (\`INGREDIENTS\` / \`RITUAL\`) above each block
- All-text navigation in the masthead, letter-spaced
- Asymmetric layouts: image left, generous right-margin block of copy; never centered-everything

**Avoid**
- Bold weights anywhere — Aesop is all regular and italic
- Color other than sage / amber / ink — no blues, no purples, no UI-blue accents
- Pop-up modals (Aesop's UI politely waits)
- Lifestyle stock photography of smiling models — props and product only

**AI prompt seed**
> Amber-glass apothecary bottle on warm chamois #E8E4D9 textured paper, single linen napkin and dried sage sprig, raking afternoon window light, deep soft shadow at lower right, 4:5, editorial product photography, color grading warm with slight green cast.

**Don't use when**
- The product is software or digital-first — Aesop's tactile object photography defines half the recipe; you can't fake it with CSS
- The audience expects price-comparison utility — Aesop never shows pricing prominently
- The voice needs to be funny or casual — Aesop is sincere and slow

---

> **Same school — Editorial / Minimalist**: [\`apple-hig\`](./apple-hig.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md) · [\`monocle-magazine\`](./monocle-magazine.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/apple-hig.md',
    description: "Apple Human Interface · Generous space, hero product on white, one thought per screen",
    getContent: () => `
# apple-hig — Apple Human Interface

- **School**: Editorial / Minimalist
- **Vibe**: Generous space, hero product on white, one thought per screen
- **Best for**: Premium hardware, premium software, "this product deserves a stage" feel
- **Touchstone**: apple.com product pages, Apple keynote slides, HIG documentation

**Palette**
- Ground: \`#FFFFFF\` (paper-pure white) or \`#000000\` (deep black, hero film moments only)
- Ink: \`#1D1D1F\` (Apple's not-quite-black)
- Soft surface: \`#F5F5F7\`
- Muted text: \`#86868B\`
- Accent (sparingly): system-blue \`#0071E3\`

**Typography**
- Display: SF Pro Display (weight 600 for headlines, 400 for sub-display) — fall back to Inter Tight only when SF Pro is unreachable
- Body: SF Pro Text at 17px, line-height ~1.47
- Captions: SF Pro at 12–14px, weight 400, color \`#86868B\`

**Spacing**: 4 / 8 / 16 / 24 / 40 / 64 / 96 / 160. Section breaks are large (160px+ vertical). Headlines breathe.

**Radius**: 12 (small components) / 18 (cards) / 22 (large panels). Apple is rarely sharp-cornered, never gummy-bear rounded.

**Shadow**: barely visible. \`0 1px 2px rgba(0,0,0,0.04)\` at most. Elevation through whitespace and color contrast, not shadow.

**Motion**: cubic-bezier expo-out; durations 350–650ms for layout moves, 150–250ms for hover. Never bouncy. Often a slow Ken Burns on hero imagery.

**Signature moves**
- One product photograph centered on whitespace, occupying ~40% of the hero
- Hero headline in big display weight, body line below in muted gray (\`#86868B\`), single CTA in system-blue text-link form (no chunky button on hero — that comes later)
- Section anatomy: tiny eyebrow label → big headline → one paragraph → one product shot → repeat. No tabs, no cards, no bento.
- Hairline \`#D2D2D7\` dividers between sections, never anything heavier
- Numbers are display-weight characters (e.g., a stat reads \`12.9″\`, with the \`″\` set in a smaller weight)

**Avoid**
- Any gradient mesh, glow, or "tech atmosphere" — Apple's gradients are almost always subtle silver-to-charcoal on a product surface, not background decoration
- Stacking multiple CTAs in the hero
- Card grids of features (Apple uses long vertical sections, one idea each)
- Emoji of any kind on marketing pages

**AI prompt seed** (for hero imagery)
> Studio-lit product photograph, single object centered on pure-white #FFFFFF ground, soft top-down diffused light, subtle floor reflection, 16:9, no text, no people, no shadow drama, color grading neutral.

**Don't use when**
- The product is software-only and doesn't have a "hero object" to photograph — you'll end up with a blank stage
- The brand wants to feel scrappy / startup / accessible — Apple HIG reads as expensive and serious
- Audience is anti-tech-corporate — it'll feel "stale Apple cosplay"

---

> **Same school — Editorial / Minimalist**: [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`aesop\`](./aesop.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md) · [\`monocle-magazine\`](./monocle-magazine.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/are-na.md',
    description: "Are.na (Honest Web) · System fonts on purpose, content > chrome, the web of the late 90s but considered",
    getContent: () => `
# are-na — Are.na (Honest Web)

- **School**: Brutalist / Raw
- **Vibe**: System fonts on purpose, content > chrome, the web of the late 90s but considered
- **Best for**: Indie tools, creative platforms, "research-flavored" products, artist communities
- **Touchstone**: are.na, the Are.na annual

**Palette**
- Ground: \`#FFFFFF\`
- Ink: \`#000000\`
- Are.na blue link: \`#0000EE\` (the classic browser-default blue, used unironically)
- Visited link: \`#551A8B\` (also classic browser-default)
- Hairline: \`#CCCCCC\`
- Optional: warm cream surface \`#F4F1E8\` for cards

**Typography**
- Display & body: system serif (Times / Georgia) and / or system sans (the OS's default sans) on purpose
- No custom font loading — the recipe leans on letting the browser pick
- Body at 14–16px, line-height ~1.45
- Italic and underlined links (also browser-default)

**Spacing**: 4 / 8 / 16 / 24 / 32. Tight. Content-dense.

**Radius**: 0

**Shadow**: none

**Motion**: none, or instant

**Signature moves**
- Underlined blue links, visited purple — left as browser default
- Headings are just larger versions of body type, no special font
- Tables, lists, and prose all flow without ornament
- Footers are tiny, plain, link-rich (the early-web "all links" footer)
- Cards (if used) are flat rectangles with a 1px gray border and no shadow

**Avoid**
- Custom fonts of any kind
- Color other than the blue / purple link colors and the ink + ground
- Hover animations, transitions of any kind
- Modals, tooltips, micro-interactions
- Any sense of "polish"

**AI prompt seed**
> Found-photograph collage on plain white paper, mixed sources, no Photoshop polish, slight imperfection, hand-cut feel, 4:3.

**Don't use when**
- The brand needs to feel "premium" — Are.na's recipe explicitly rejects premium signaling
- The audience expects modern SaaS UX cues — they may bounce, reading the page as broken
- Half-measures will be tempted — commit fully or pick another recipe; partial Are.na looks broken, not curated

---

> **Same school — Brutalist / Raw**: [\`bloomberg-businessweek-turley\`](./bloomberg-businessweek-turley.md) · [\`balenciaga-post-2017\`](./balenciaga-post-2017.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/balenciaga-post-2017.md',
    description: "Balenciaga (post-Demna era) · Default browser styling weaponized, Helvetica at absurd scale, anti-luxury luxury",
    getContent: () => `
# balenciaga-post-2017 — Balenciaga (post-Demna era)

- **School**: Brutalist / Raw
- **Vibe**: Default browser styling weaponized, Helvetica at absurd scale, anti-luxury luxury
- **Best for**: Fashion / counter-culture / fragrance brands, "we're too cool to design this" positioning
- **Touchstone**: balenciaga.com (any 2018+ snapshot via Wayback), Vetements campaigns, post-2017 luxury anti-design

**Palette**
- Ink: \`#000000\`
- Ground: \`#FFFFFF\`
- One muted off-white surface: \`#F5F4F0\`
- No color. None. If a color appears it's in a single photograph and never as a UI element.

**Typography**
- Display & body: Helvetica or Arial — all weights, all sizes, *only this one family*
- Headlines often set in all-caps at hero scale (140px+)
- Body type small — 11–13px
- Mixing weight is fine; mixing family is not

**Spacing**: 8 / 16 / 24 / 40 — restrained, but not luxurious-spacious; more "we didn't bother to soften it"

**Radius**: 0

**Shadow**: none

**Motion**: none — pages don't animate. Hover at most changes underline.

**Signature moves**
- All-caps Helvetica headlines at extreme scale, tightly tracked, often left-aligned hard against the page edge
- Product photography is editorial / fashion-style — model + product, harsh lighting, awkward poses; never the smiling-stock-model pattern
- Navigation is plain text links, sometimes just a vertical list at the top of the page
- Captions and metadata stripped to minimum (model name, designer, location)
- No buttons styled as buttons — CTAs are underlined text links

**Avoid**
- Any font other than Helvetica / Arial
- Color
- Polished UI affordances (rounded buttons, drop shadows, hover effects)
- Decorative anything

**AI prompt seed**
> Fashion editorial photograph, single model against a plain off-white #F5F4F0 backdrop, harsh direct flash, awkward static pose, deadpan expression, 4:5.

**Don't use when**
- The brand has no fashion / counter-culture claim — recipe will read as cosplay
- The audience expects to be "sold to" — Balenciaga's recipe ignores the audience on purpose
- Conversion is critical — this recipe converts the in-group, not the casual visitor

---

> **Same school — Brutalist / Raw**: [\`are-na\`](./are-na.md) · [\`bloomberg-businessweek-turley\`](./bloomberg-businessweek-turley.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/bloomberg-businessweek-turley.md',
    description: "Bloomberg Businessweek (Turley Era) · Typographic violence, magazine grid abused, copy *is* image",
    getContent: () => `
# bloomberg-businessweek-turley — Bloomberg Businessweek (Turley Era)

- **School**: Brutalist / Raw
- **Vibe**: Typographic violence, magazine grid abused, copy *is* image
- **Best for**: Editorial features, agency portfolios, opinionated content sites
- **Touchstone**: Bloomberg Businessweek 2014–2019 covers (Richard Turley → Tracy Ma era), *Eye* magazine archive issues

**Palette**
- Aggressive — \`#FF3D00\` (high-alert orange), \`#FFE800\` (signal yellow), \`#001AFF\` (alert blue)
- Always on \`#FFFFFF\` for max contrast — or inverted onto \`#000000\`
- Black \`#000000\` text on white where readable; otherwise contrasting hue
- Maximum 3 colors per spread

**Typography**
- Display: a single bold grotesque used at absurd scale — Founders Grotesk, Druk, ABC Whyte. Weight 800–900, set 200px+
- Headlines often broken across lines on purpose, kerned tighter than comfortable
- Body type left small in contrast — 12–14px serif (Plantin / Mercury)
- All-caps + condensed common in display

**Spacing**: deliberately broken — content pushed off-grid, sometimes touching edges or overflowing intentionally

**Radius**: 0

**Shadow**: none

**Motion**: jarring cuts, not smooth eases. If anything moves it slams into place.

**Signature moves**
- Headline set so large it visibly breaks the grid (letters touching page edges)
- Color blocks of saturated orange / yellow / blue placed under or behind type
- Photo cutouts (subjects silhouetted, dropped onto color fields) — often awkwardly cropped on purpose
- Tables of data styled like magazine spreads, not like UI components — bold, contrasty, opinionated
- Captions in tiny serif italic positioned in unexpected corners

**Avoid**
- Tasteful design (the recipe is anti-tasteful on purpose)
- More than 3 colors per spread
- Smooth transitions
- Web defaults (every element should feel set, not generated)

**AI prompt seed**
> Magazine cover composition, single bold word set in massive black grotesque at 200pt, behind it a flat field of saturated alert-orange #FF3D00, with a clumsily-cut photo silhouette overlaid at unexpected angle, slight print misregistration, 3:4.

**Don't use when**
- The brand voice is meant to feel calm or trustworthy — Turley-era Bloomberg is loud
- The content is utility-focused — recipe is editorial only
- The team is squeamish about deliberate ugliness — this recipe requires committing to it

---

> **Same school — Brutalist / Raw**: [\`are-na\`](./are-na.md) · [\`balenciaga-post-2017\`](./balenciaga-post-2017.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/bloomberg-terminal.md',
    description: "Bloomberg Terminal · Maximum data-ink, mission-critical density, chrome-amber on near-black",
    getContent: () => `
# bloomberg-terminal — Bloomberg Terminal

- **School**: Information Architecture
- **Vibe**: Maximum data-ink, mission-critical density, chrome-amber on near-black
- **Best for**: Finance / trading / monitoring dashboards, "professionals don't have time for whitespace" products
- **Touchstone**: a real Bloomberg Terminal screenshot (always reference the real thing — it's denser than memory suggests)

**Palette**
- Ground: \`#0A0E1A\` (deep navy-black)
- Surface 1: \`#11172A\`
- Surface 2: \`#1A2138\`
- Amber primary: \`#FFA02F\` (the signature)
- Positive (price-up): \`#00B96B\`
- Negative (price-down): \`#F23645\`
- Muted label: \`#5E6680\`
- High-importance text: \`#E8ECF4\`

**Typography**
- Display & body: a monospaced workhorse — IBM Plex Mono, JetBrains Mono, or Berkeley Mono. Bloomberg itself uses a proprietary mono.
- Sizes: 11 / 12 / 13 / 14px — densely packed. No 16px body. No 32px headlines.
- All numerals tabular-aligned (right-aligned columns of digits)

**Spacing**: 2 / 4 / 8 / 12. Multi-pane layouts with no luxury margins.

**Radius**: 0 or 2px. Terminals don't round.

**Shadow**: none. Elevation through hairline borders only (\`#2A3050\` 1px lines).

**Motion**: ticker scroll (uniform linear), instant state flips, blink on data update (50–80ms flash). No eased animations.

**Signature moves**
- Multi-pane workspaces with hairline dividers — 4 to 9 panels visible at once
- Amber text on near-black for the most important data; chrome-white for secondary
- Status / ticker bar at top with marquee-scrolling tickers, color-coded up/down
- Keyboard-shortcut chips in the margins (\`F9: TRADE\`)
- Tabular data with monospaced digits, color-coded by delta

**Avoid**
- Any rounded corners
- Hero sections / marketing-style headlines
- Photography or illustration of any kind
- Decorative gradients (gradient meshes are not data-ink)
- Sans-serif body type (the monospace is the recipe)

**AI prompt seed**
> Trading workstation user interface, deep navy #0A0E1A background, multi-pane layout with amber #FFA02F headlines, monospaced data tables, ticker scroll across the top, no rounded corners, no illustrations, fixed-width font throughout.

**Don't use when**
- The audience is consumer (they'll bounce in 3 seconds — terminal density is acquired taste)
- You can't fill the screen with real data — terminal aesthetic + dummy "Lorem 1,234" placeholders looks broken
- The task is a marketing landing page — terminals are for working in, not for selling

---

> **Same school — Information Architecture**: [\`pentagram\`](./pentagram.md) · [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`nyt-the-daily\`](./nyt-the-daily.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/dieter-rams-braun.md',
    description: "Dieter Rams / Braun · \"Less but better\", functional honesty, industrial restraint",
    getContent: () => `
# dieter-rams-braun — Dieter Rams / Braun

- **School**: Editorial / Minimalist
- **Vibe**: "Less but better", functional honesty, industrial restraint
- **Best for**: Hardware product pages, audio gear, industrial / tool brands, design-led B2B
- **Touchstone**: Braun T3 radio, Braun ET66 calculator, Rams's *Ten Principles of Good Design*

**Palette**
- Ground: \`#E4E1DC\` (concrete light) or \`#F5F4F0\` (paper)
- Ink: \`#191919\`
- Industrial gray: \`#A8A8A8\`, \`#5C5C5C\`
- Accent: single signal — Braun orange \`#E96A26\` or signal yellow \`#F5C518\`, used only on functional elements (a power dot, an active state)

**Typography**
- Display & body: a precision grotesk — Akzidenz-Grotesk, Helvetica Now, or Söhne. Weight 400 body, weight 500 for emphasis, never 700.
- Numerals love a monospaced variant for spec tables

**Spacing**: based on a 4px sub-grid; visible values 4 / 8 / 16 / 24 / 32 / 64 / 128. Functional, no "luxury whitespace" inflation.

**Radius**: 2–4px maximum. Sharp by default.

**Shadow**: none.

**Motion**: utilitarian — instant state changes (~80–120ms), no flourish.

**Signature moves**
- Diagrammatic exploded views of the product with measurement callouts (real or fictional)
- A single signal-orange dot on the page indicating "active" or "power" — never decorative
- Tabular spec listings as a first-class layout element (not hidden behind a "Specs" toggle)
- Every label exactly what it is, in plain language ("ON / OFF" not "Toggle interaction mode")
- The page itself feels like a piece of equipment

**Avoid**
- Photography that romanticizes the product — Braun shoots it on a grid background like an engineering specimen
- Multiple accent colors
- Curves anywhere — even hover effects shouldn't bounce
- Lifestyle imagery

**AI prompt seed**
> Industrial product photograph, 1960s Braun design language, single hardware object on light gray #E4E1DC grid background, frontal orthographic view, dimensions and labels in thin sans serif, color palette restricted to gray / black / single orange marker, 4:3.

**Don't use when**
- The product is soft / emotional / lifestyle — Rams discipline reads as cold for skincare or hospitality
- The team wants warmth or personality — this recipe is impersonal by design
- The audience is consumer / non-technical — they may read it as "boring spec sheet"

---

> **Same school — Editorial / Minimalist**: [\`apple-hig\`](./apple-hig.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`aesop\`](./aesop.md) · [\`monocle-magazine\`](./monocle-magazine.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/field-io.md',
    description: "Field.io (Generative Motion Identity) · The brand is movement; the page generates itself in front of the visitor",
    getContent: () => `
# field-io — Field.io (Generative Motion Identity)

- **School**: Motion / Experimental
- **Vibe**: The brand is movement; the page generates itself in front of the visitor
- **Best for**: Brand films, launch moments, agency portfolios, "the visit is the experience" sites
- **Touchstone**: field.io, FIELD.SYSTEMS work, kinetic identity case studies

**Palette**
- Often dark base — \`#0B0B0F\` to \`#000000\`
- One or two generative gradient hues used throughout the motion — frequently a single bold hue cycled through hue rotation, e.g., a deep cyan \`#0CE0E5\` blending into electric violet \`#5B2EFF\`, or generated procedurally
- Ink for type: high-contrast white \`#FFFFFF\`
- Secondary type: cool gray \`#A0A4B0\`

**Typography**
- Display: a variable font that *animates* on its own axes — Söhne Variable, Editorial New Variable, or Inter Display Variable
- Type often morphs weight, width, or optical-size during scroll
- Body type kept restrained — a single grotesque at neutral weight; the motion is the show, not the body

**Spacing**: irregular by design — content lands in unexpected positions; the grid sometimes appears and disappears

**Radius**: 0 — Field.io's work is rarely soft-cornered

**Shadow**: not via CSS — through generative lighting in WebGL / Canvas scenes

**Motion**: the entire recipe is motion. Multi-stage choreographed sequences. Scroll-driven not just for parallax but for state changes. Pages frequently feel like a video playing itself.

**Signature moves**
- Generative type sequences where letters appear, morph, and resolve into headlines on scroll
- Particle / mesh systems that respond to cursor and scroll position
- Long-tail eased curves (expo-out, quint-out) — \`cubic-bezier(0.83, 0, 0.17, 1)\` and similar
- Section breaks where the entire page state transforms (a full-bleed canvas overtakes the layout)
- Choreographed multi-element entries — six elements arrive on staggered delays, not all at once

**Avoid**
- Static recipes (this isn't a static recipe — a static screenshot will feel underwhelming)
- Too many cursor-reactive elements (one or two key WebGL moments is the recipe, not the whole page)
- Heavy text content — this recipe is for moments, not for reading

**AI prompt seed**
> Generative type composition, single phrase resolving from particle field, electric violet #5B2EFF and deep cyan #0CE0E5 light traces, on near-black background, long motion trails, 16:9 cinematic.

**Don't use when**
- The deliverable will live as a static screenshot (the recipe loses ~70% of its impact)
- Build budget is small (this is the most labor-intensive of the 25)
- The target audience uses low-end hardware or care about performance / accessibility above wow

---

> **Same school — Motion / Experimental**: [\`active-theory\`](./active-theory.md) · [\`resn-storytelling\`](./resn-storytelling.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/headspace-meditation.md',
    description: "Headspace / Calm · Soft pastels, rounded everything, calming hand-drawn illustration",
    getContent: () => `
# headspace-meditation — Headspace / Calm

- **School**: Warm Humanist
- **Vibe**: Soft pastels, rounded everything, calming hand-drawn illustration
- **Best for**: Wellness / meditation / health apps, sleep / kids products, "approachable expert" services
- **Touchstone**: headspace.com, the Headspace app, Calm.com lock-screen aesthetic

**Palette**
- Ground: warm peach \`#FFE2C5\` or \`#FFEDD5\`
- Surface darker: warm coral \`#F4A573\`
- Ink: warm dark teal \`#1B3A47\`
- Secondary: \`#5C6B7A\`
- Pop accents: muted lavender \`#B0A5D1\`, sage \`#9DB67A\`, salmon \`#F5867B\` (one per scene, rotating)

**Typography**
- Display: a rounded friendly sans — Apercu, GT America (rounded variant), Söhne Breit. Weight 600.
- Body: same family at 16–17px, weight 400
- Optional script for emotional moments — a single soft handwritten line in something like Caveat, used very sparingly

**Spacing**: generous — 8 / 16 / 24 / 40 / 64 / 96

**Radius**: large — 16 (small) / 24 (medium) / 32 (large). Buttons are pills (radius = height / 2).

**Shadow**: soft and warm — \`0 8px 24px rgba(244, 165, 115, 0.2)\`. Often colored to match the ground.

**Motion**: gentle, slow, breathing. 400–800ms eases. Hover lifts have a "buoyant" feel. A subtle breathing animation (1.5–4s cycle) on key elements.

**Signature moves**
- A central character / mascot illustrated in simple round shapes (Headspace's orange circle character)
- Animated breathing circles that expand and contract in sync with body copy ("breathe in… breathe out…")
- Warm peach gradient grounds that slowly drift between hues
- Rounded everything — every container is a pill or a soft-corner rectangle
- Calming microcopy ("Take a moment. We'll wait.")

**Avoid**
- Cool palettes — Headspace lives in warm tones, even at night-mode (warm dark teal not cool navy)
- Sharp corners anywhere
- Harsh motion (no bouncy springs — too jolting; gentle eases only)
- More than 2 colors per scene

**AI prompt seed**
> Simple flat illustration in warm peach #FFE2C5 background, single round mascot character in coral with friendly face, soft pastel shapes around it (sage, lavender), no harsh edges anywhere, gentle hand-drawn imperfection, 4:5.

**Don't use when**
- The product is meant to feel sharp / sophisticated — Headspace's recipe reads as soft / caring
- The brand has no wellness / care positioning — it'll feel infantilizing
- The voice is meant to be authoritative or expert-led — recipe is gentle, not commanding

---

> **Same school — Warm Humanist**: [\`mailchimp-freddie\`](./mailchimp-freddie.md) · [\`stripe-press\`](./stripe-press.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/INDEX.md',
    description: "Recipe catalog index: 25 named recipes with 3 indexes (by school / by best-for / by light-dark) + cross-cutting anti-patterns",
    getContent: () => `
# Style Recipes — Catalog Index

A catalog of 25 named, anchored design recipes — each one tied to a real brand / studio / designer and **stored as its own file in this directory**. Read this INDEX to discover what's available and how to choose; then read **one recipe file** to get the concrete values for Step 3.

\`\`\`
references/style-recipes/
├── INDEX.md                       ← you are here
├── apple-hig.md
├── muji-kenya-hara.md
├── aesop.md
├── ... (25 recipe files total)
\`\`\`

This catalog is the **anchored library**; \`../design-directions.md\` is the **school taxonomy** for vague-request conversations. The two work together:

| Route | Tool | When |
|---|---|---|
| User has no idea — needs guidance | \`../design-directions.md\` (6-school 3-pick conversation) | "Make me something nice" / "I don't know what style I want" |
| User has an anchor in mind | Read **one** file here directly | "Make it Linear-style" / "Stripe Press feeling" / "Are.na vibe" |
| Direction Advisor narrowed to a school but user wants concreteness | Read this INDEX for the school's recipes → then read the 2–3 specific recipe files | Mid-conversation handoff |

---

## When to Read Recipe Files

**Read a single recipe file** when:

1. **The user names an anchor by brand, studio, or designer** — "make a Linear-style landing page", "Aesop-feeling product page", "MUJI quietness", "Pentagram-grade type system". Read **only that anchor's file** (\`linear.md\`, \`aesop.md\`, etc.) — never the whole catalog.
2. **The Direction Advisor narrowed to a school** — read this INDEX to see which recipes live in that school, then read 2–3 specific files to present the user concrete choices.
3. **You're in Step 3 and need a known-good palette / typography / spacing combo** — pick the closest recipe by school or best-for table below, then read that single file and adapt.

Do **not** load every recipe file up front. The entire catalog is ~1400 lines if loaded together; loading one recipe is ~50 lines. **Loading the whole catalog when you only need one recipe is the exact anti-pattern this split is designed to prevent.**

Do **not** read recipe files when:
- The user provided their own brand assets / Figma / codebase — extract from those instead (Asset > Spec).
- The task is dictated by an existing UI you're extending — match the visual vocabulary already there, don't impose a recipe.
- The user gave you a screenshot of a specific reference page — that screenshot *is* the recipe; extract directly.

---

## File Format Conventions (every recipe file follows this anatomy)

- **Title line** — \`# <anchor-id> — <Human-readable name>\`
- **Anchor & school** — which real-world reference and which Direction-Advisor school it belongs to
- **Vibe & best-for** — 1-line vibe summary plus the scenarios it actually serves
- **Touchstone** — at least one named real product / object / publication to look at (search and verify before relying on memory)
- **Palette** — hex values, named by role (ink / surface / accent / ground). Always restricted; never a 12-stop ramp.
- **Typography** — real font names with weight numbers and size guidance. No "Inter / Roboto" fallbacks unless the anchor itself uses them.
- **Spacing system** — concrete value ladder
- **Radius / Shadow / Motion character** — described in **design language**, not code
- **Signature moves** — 3–5 specific, opinionated, copy-able design decisions that make this recipe *recognisable*. This is the design DNA.
- **Avoid** — anti-patterns inside this recipe (i.e., things that would silently turn it into AI slop)
- **AI prompt seed** — when generating supporting imagery, what to ask for to stay in DNA
- **Don't use when** — the boundary; situations where this recipe will misfire
- **Footer** — peer recipes in the same school + a link back to this INDEX

**These files contain no code.** Hex codes, font names, and spacing ladders are *design tokens described in words*, not code. The agent translates them to CSS / JSX in Step 3+ using the project's stack.

---

## Index 1 — By School

| School | Recipes |
|---|---|
| **Editorial / Minimalist** | [\`apple-hig\`](./apple-hig.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`aesop\`](./aesop.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md) · [\`monocle-magazine\`](./monocle-magazine.md) |
| **Information Architecture** | [\`pentagram\`](./pentagram.md) · [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`nyt-the-daily\`](./nyt-the-daily.md) |
| **Modern Tool / Builder SaaS** | [\`linear\`](./linear.md) · [\`vercel-mesh\`](./vercel-mesh.md) · [\`raycast\`](./raycast.md) · [\`notion-pre-ai\`](./notion-pre-ai.md) |
| **Motion / Experimental** | [\`field-io\`](./field-io.md) · [\`active-theory\`](./active-theory.md) · [\`resn-storytelling\`](./resn-storytelling.md) |
| **Brutalist / Raw** | [\`are-na\`](./are-na.md) · [\`bloomberg-businessweek-turley\`](./bloomberg-businessweek-turley.md) · [\`balenciaga-post-2017\`](./balenciaga-post-2017.md) |
| **Warm Humanist** | [\`mailchimp-freddie\`](./mailchimp-freddie.md) · [\`stripe-press\`](./stripe-press.md) · [\`headspace-meditation\`](./headspace-meditation.md) |
| **Specialty / Genre** (not surfaced via Advisor) | [\`y2k-retrofuturism\`](./y2k-retrofuturism.md) · [\`mid-century-modern\`](./mid-century-modern.md) |

The first 6 schools mirror the Direction Advisor's 6 schools (in \`../design-directions.md\`) — so when the Advisor picks one of those, you know which recipe files to surface. The 7th school (Specialty / Genre) is **only reachable through direct anchor naming** — users wanting Y2K or Mid-Century always arrive with the anchor in hand, never through Advisor.

## Index 2 — By Best-For

| Scenario | First-choice recipes |
|---|---|
| B2B SaaS / developer tools | [\`linear\`](./linear.md) · [\`vercel-mesh\`](./vercel-mesh.md) · [\`raycast\`](./raycast.md) · [\`pentagram\`](./pentagram.md) |
| Premium consumer / lifestyle | [\`aesop\`](./aesop.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`stripe-press\`](./stripe-press.md) · [\`monocle-magazine\`](./monocle-magazine.md) |
| Data product / dashboard / finance | [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) |
| Editorial / publishing / longform | [\`nyt-the-daily\`](./nyt-the-daily.md) · [\`monocle-magazine\`](./monocle-magazine.md) · [\`stripe-press\`](./stripe-press.md) · [\`mailchimp-freddie\`](./mailchimp-freddie.md) |
| Launch moment / brand film / awwwards | [\`field-io\`](./field-io.md) · [\`active-theory\`](./active-theory.md) · [\`resn-storytelling\`](./resn-storytelling.md) · [\`vercel-mesh\`](./vercel-mesh.md) |
| Differentiated / counter-culture / artist | [\`are-na\`](./are-na.md) · [\`bloomberg-businessweek-turley\`](./bloomberg-businessweek-turley.md) · [\`balenciaga-post-2017\`](./balenciaga-post-2017.md) |
| Approachable B2C / community / health | [\`mailchimp-freddie\`](./mailchimp-freddie.md) · [\`headspace-meditation\`](./headspace-meditation.md) · [\`notion-pre-ai\`](./notion-pre-ai.md) |
| Retro / theme / decade-coded | [\`y2k-retrofuturism\`](./y2k-retrofuturism.md) · [\`mid-century-modern\`](./mid-century-modern.md) |

## Index 3 — By Mode (light / dark / either)

| Mode | Recipes |
|---|---|
| Light-first | [\`apple-hig\`](./apple-hig.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`aesop\`](./aesop.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md) · [\`monocle-magazine\`](./monocle-magazine.md) · [\`pentagram\`](./pentagram.md) · [\`nyt-the-daily\`](./nyt-the-daily.md) · [\`stripe-press\`](./stripe-press.md) · [\`headspace-meditation\`](./headspace-meditation.md) · [\`mailchimp-freddie\`](./mailchimp-freddie.md) · [\`mid-century-modern\`](./mid-century-modern.md) |
| Dark-first | [\`linear\`](./linear.md) · [\`vercel-mesh\`](./vercel-mesh.md) · [\`raycast\`](./raycast.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`field-io\`](./field-io.md) · [\`active-theory\`](./active-theory.md) · [\`resn-storytelling\`](./resn-storytelling.md) · [\`y2k-retrofuturism\`](./y2k-retrofuturism.md) |
| Works either way | [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`notion-pre-ai\`](./notion-pre-ai.md) · [\`are-na\`](./are-na.md) · [\`bloomberg-businessweek-turley\`](./bloomberg-businessweek-turley.md) · [\`balenciaga-post-2017\`](./balenciaga-post-2017.md) |

---

## Cross-Cutting Anti-Patterns (apply to all 25 recipes)

These apply across every recipe in this catalog. Violating them collapses the recipe back into AI-default slop. **Read these even before reading an individual recipe file** — they're not duplicated in each file.

### ❌ Don't combine two recipes mid-page

Pick **one** recipe and instantiate it fully. Adding "Linear with Aesop accents" or "Pentagram with a Y2K hero" usually reads as confused rather than original. Two-recipe remixes work only when the user explicitly asks and you can articulate *why* the marriage is coherent (e.g., "Aesop palette on Pentagram grid for an apothecary catalog with editorial bones").

### ❌ Don't half-commit to brutalism / Y2K / mid-century

The Specialty / Genre and Brutalist / Raw recipes need full commitment. Half-Y2K reads as "broken modern site". Half-brutalism reads as "unfinished design". Either go all-in or pick a different recipe.

### ❌ Don't default to Inter / Roboto / Arial / system-ui as display

If your chosen recipe specifies a font, use that font (or a real substitute *named in the recipe*). Defaulting to Inter erases the recipe's typographic identity, which is usually 30–40% of its signature.

### ❌ Don't import every color in the palette

Each recipe lists a restricted palette intentionally. If a recipe gives you 4 colors, don't add a 5th to "balance things out". The restriction *is* the recipe.

### ❌ Don't add your own AI-default touches "to make it pop"

If the recipe says "no shadow," don't add a subtle shadow. If it says "no gradient," don't add a gradient mesh. If it says "no emoji," don't add one. Every AI-default addition you make reduces the recipe's distinctiveness toward the mean.

### ❌ Don't fake the photography style with CSS

Recipes like Aesop, Stripe Press, MUJI, Apple HIG, Mailchimp, and Headspace rely on a specific photography or illustration style. If you can't source / generate that imagery, **say so to the user** — don't substitute CSS shapes. A recipe with a real hero photograph at 60% quality lands better than the same recipe with a CSS substitute at 0% recognition value.

### ❌ Don't invent new recipes silently

If you find yourself drifting outside the listed recipes, **tell the user**: "None of the 25 recipes fits — here's what I propose instead." A new recipe deserves its own anchor, its own concrete values, and its own signature moves articulated. Drifting silently produces the AI-default that this whole catalog is built to prevent.

### ❌ Don't read the whole catalog when you need one recipe

Load only the recipe files you actually need. If the user said "Linear-style", read [\`linear.md\`](./linear.md) — not all 25. The 1-file-at-a-time pattern is what makes this catalog efficient; loading everything up front defeats progressive disclosure.

---

## When None of the 25 Fits

Options in this order:

1. **Re-read the user's request** — sometimes the right recipe is obvious in hindsight (a "data-led research tool" is almost always [\`tufte-dataink\`](./tufte-dataink.md) or [\`bloomberg-terminal\`](./bloomberg-terminal.md), even when the user didn't name those)
2. **Combine two recipes deliberately**, with explicit framing — see the warning above
3. **Hand off to \`../design-directions.md\`** — propose 3 differentiated schools and let the user pick
4. **Articulate a new recipe** — name an anchor, list concrete values, get user sign-off, then proceed

Always make the recipe choice explicit in your Step 3 design-system declaration so the user can confirm before code starts.

`,
  },
  {
    name: 'references/style-recipes/linear.md',
    description: "Linear (Modern Builder Tool) · Quiet luxury for developer tools; warm dark, hairline detail, restraint as confidence",
    getContent: () => `
# linear — Linear (Modern Builder Tool)

- **School**: Modern Tool / Builder SaaS
- **Vibe**: Quiet luxury for developer tools; warm dark, hairline detail, restraint as confidence
- **Best for**: Developer tools, AI tools, B2B SaaS where "serious + designed" matters
- **Touchstone**: linear.app, the Linear changelog page, Linear Method site

**Palette**
- Ground: \`#08090A\` (near-black with warm undertone, not pure black)
- Surface 1: \`#16171C\`
- Surface 2: \`#1E1F25\`
- Surface 3 (raised): \`#26272E\`
- Hairline border: \`rgba(255,255,255,0.06)\`
- Primary text: \`#F7F8F8\`
- Secondary text: \`#9CA3AF\`
- Muted text: \`#6B7280\`
- Accent: Linear purple \`#5E6AD2\` — used on < 5% of pixels
- Gradient meshes (very controlled, < 8% opacity) in the hero only

**Typography**
- Display: Inter Tight at weight 600 (or Söhne, or Geist Sans) — never plain Inter at default weight, that's the AI-default
- Body: Inter at 14–15px, weight 400–500, line-height 1.55
- Mono: GeistMono, JetBrains Mono, or Berkeley Mono for inline code and shortcut chips
- Letter-spacing on display headlines: -0.02em (tight)

**Spacing**: 4 / 8 / 12 / 16 / 24 / 40 / 64 / 96

**Radius**: 6 (small UI) / 12 (medium cards) / 16 (large panels). **Never above 16.** Linear's radius character is "modest, precise, never gummy."

**Shadow**: barely there — soft \`0 1px 2px rgba(0,0,0,0.3)\` on raised surfaces. **Never glow, never colored shadow.**

**Motion**: ease-out around 150ms for hover, 350–450ms for layout moves with a quint curve (e.g., the famous cubic-bezier(0.22, 1, 0.36, 1)). State changes feel "snappy but not bouncy."

**Signature moves**
- Hairline 1px borders in \`rgba(255,255,255,0.06)\` separating every panel, everywhere
- Selective accent use — purple appears on focused / active states, on tiny pills, on key brand surfaces; never on body backgrounds
- Inline code styled with monospaced font and dim background \`#1E1F25\`, color \`#A78BFA\`
- Subtle gradient meshes in the hero (extremely controlled saturation, < 8% opacity) — *not* the bright purple-pink-blue AI cliché
- Keyboard-shortcut chips throughout the UI (the brand celebrates keyboard-first)
- A bottom-pinned screenshot of the actual product on landing pages

**Avoid**
- Emoji
- Bouncy springs or elastic easings
- More than one saturated color (Linear's purple is the only accent)
- Border-radius above 16
- Stock photography of people
- "Get Started Free" hero CTAs styled like a 2018 SaaS landing page

**AI prompt seed**
> Abstract product UI screenshot, warm dark #08090A background, hairline borders, panels with #16171C and #1E1F25 surfaces, very subtle blue-purple ambient lighting at top edge, no people, no text on the image itself, 16:9.

**Don't use when**
- The brand is consumer-friendly / playful — Linear reads as professional and serious
- The product needs warmth or hand-touched feel
- The audience is non-technical (the keyboard-shortcut and monospace signals don't land)

---

> **Same school — Modern Tool / Builder SaaS**: [\`vercel-mesh\`](./vercel-mesh.md) · [\`raycast\`](./raycast.md) · [\`notion-pre-ai\`](./notion-pre-ai.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/mailchimp-freddie.md',
    description: "Mailchimp (Freddie Era, c. 2018–2022) · Hand-drawn marks, warm yellow, personality in microcopy",
    getContent: () => `
# mailchimp-freddie — Mailchimp (Freddie Era, c. 2018–2022)

- **School**: Warm Humanist
- **Vibe**: Hand-drawn marks, warm yellow, personality in microcopy
- **Best for**: Small-business tools, creator products, community / education / approachable B2C
- **Touchstone**: mailchimp.com pre-2023 redesigns (Wayback), Freddie illustration sets

**Palette**
- Ground: \`#FFE01B\` (Mailchimp yellow) for hero / brand moments, \`#FFFFFF\` for body
- Ink: \`#241C15\` (warm near-black, never pure black)
- Cream surface: \`#FBEFE3\`
- Secondary: \`#88837C\`
- Accent: a hot pop-pink \`#FF4D74\` or a warm coral, used very sparingly

**Typography**
- Display: a friendly grotesque — Helvetica Now Display, Söhne, Inter Tight at weight 700–800
- Body: same family at 17–18px, weight 400, line-height 1.6
- Decorative: occasional hand-drawn script or text-set-by-hand feel

**Spacing**: 4 / 8 / 16 / 24 / 40 / 64 — generous but not airy

**Radius**: 8 (small) / 16 (medium) / 24 (large pills). Buttons are pill-shaped.

**Shadow**: soft and warm — \`0 4px 12px rgba(36, 28, 21, 0.08)\`

**Motion**: bouncy welcomed. Spring physics on hover lifts, friendly easings.

**Signature moves**
- Freddie-style hand-drawn illustrations (winking mascot, line-drawn characters with personality) — never AI-generated, must be commissioned or use a single illustrator's hand
- Yellow flood-fill section backgrounds breaking up the page
- Pill-shaped buttons with a 2–3px black outline (Memphis-style)
- Personality in microcopy ("Send better email" not "Optimize delivery metrics")
- Asymmetric "tilted" illustration placement — never centered on a grid

**Avoid**
- Pure black anywhere (the recipe is warm-near-black)
- Stock illustrations — the hand-drawn style is the differentiator
- More than 3 colors visible at once (yellow + ink + one accent)
- Cold corporate microcopy

**AI prompt seed**
> Hand-drawn illustration, single line-drawn character with warm color washes (yellow, coral), winking expression, on warm cream #FBEFE3 background, friendly approachable line style, deliberate imperfection, 4:5.

**Don't use when**
- Brand needs to feel premium / luxury — Mailchimp warmth reads as accessible / mass-market
- Illustration can't be sourced from a real illustrator (recipe loses 50% impact)
- Audience is enterprise-only and skeptical of "friendly"

---

> **Same school — Warm Humanist**: [\`stripe-press\`](./stripe-press.md) · [\`headspace-meditation\`](./headspace-meditation.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/mid-century-modern.md',
    description: "Mid-Century Modern (Paul Rand / Saul Bass) · 1950s–60s American graphic modernism — geometric shapes, considered hand-feel, jaz…",
    getContent: () => `
# mid-century-modern — Mid-Century Modern (Paul Rand / Saul Bass)

- **School**: Specialty / Genre (also touches Information Architecture)
- **Vibe**: 1950s–60s American graphic modernism — geometric shapes, considered hand-feel, jazz-album confidence
- **Best for**: Cultural / film / publishing identity, premium consumer brands with heritage claim, "tasteful sophistication"
- **Touchstone**: IBM logo (Paul Rand), Saul Bass Vertigo / Anatomy of a Murder posters, Alvin Lustig book covers, mid-century jazz album sleeves (Reid Miles / Blue Note)

**Palette**
- Ground: warm cream \`#EBE3D2\` or mustard \`#D9A441\` or muted teal \`#3D6E70\`
- Ink: \`#1A1A18\`
- Limited palette per piece — 3 colors max, one bold, two muted
- Common mid-century pairings: mustard + brick + cream; teal + cream + black; sienna + ink + bone

**Typography**
- Display: a geometric grotesque (Futura, Avenir, ITC Avant Garde) at large scale, often condensed weight
- Or a slab serif (Egyptian / Memphis) for editorial moments
- Body: humanist serif (Sabon, Garamond) at 16–17px
- Numerals often set in figures-as-image (a single big numeral as a graphic element)

**Spacing**: structured grid; 4 / 8 / 16 / 24 / 32 / 48

**Radius**: 0 throughout. Mid-century is geometric, not soft.

**Shadow**: none — flat color shapes only

**Motion**: minimal. Shapes slide into place on a single beat, like a Saul Bass title sequence.

**Signature moves**
- Geometric shape compositions — a single big circle, a triangle, a half-moon — as the primary visual
- Hand-cut paper feel (shapes have slightly imperfect edges, suggesting they were cut and pasted)
- Type integrated with the shapes (a headline curving around a circle, or sitting *inside* a colored block)
- A single illustrative motif repeated (a stylized bird, an abstract figure) tying the piece together
- Print-feel grain or paper texture at low opacity

**Avoid**
- Gradients — mid-century is flat color
- Photography as the lead visual (illustration leads; photography supports)
- More than 3 colors per piece
- Rounded / soft-corner UI

**AI prompt seed**
> Mid-century modern poster composition in the style of Saul Bass, single bold geometric shape (large circle in mustard #D9A441) on warm cream #EBE3D2 paper background, flat color shapes, slight paper texture, hand-cut edges, no gradient, no shadow, 3:4.

**Don't use when**
- The product is feature-dense / utility-focused (mid-century is editorial / poster thinking)
- The brand has no heritage / cultural / craft claim
- Realistic photography is essential to the message

---

> **Same school — Specialty / Genre**: [\`y2k-retrofuturism\`](./y2k-retrofuturism.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/monocle-magazine.md',
    description: "Monocle Magazine · International, considered, magazine-grade kicker / headline / dek hierarchy",
    getContent: () => `
# monocle-magazine — Monocle Magazine

- **School**: Editorial / Minimalist
- **Vibe**: International, considered, magazine-grade kicker / headline / dek hierarchy
- **Best for**: Editorial, travel / hospitality, journals, considered lifestyle publications
- **Touchstone**: monocle.com, the Monocle quarterly, Cereal magazine

**Palette**
- Ground: \`#F2EFE7\` (cream paper)
- Ink: \`#1A1A1A\`
- Editorial accent red: \`#C7322E\` (Monocle's signature)
- Olive: \`#5E6347\`
- Hairline rules: \`#C8C2B0\`

**Typography**
- Display: a refined slab or transitional serif — Plantin, Mercury, or Tiempos Headline. Italic widely used.
- Body: Plantin or Tiempos Text at 16–17px, line-height ~1.6
- Sans for kickers / labels: a precision grotesk like Söhne at 10–11px, letter-spaced 0.08em, often in editorial red
- Drop caps welcome on long-form features

**Spacing**: 4 / 8 / 16 / 24 / 32 / 48 / 96. Multi-column work uses tight gutters (16–24px between columns).

**Radius**: 0. Magazine pages don't round corners.

**Shadow**: none.

**Motion**: minimal. Page-turn fades. Slow Ken Burns on lead photographs.

**Signature moves**
- Three-deck hierarchy: tiny red kicker → bold serif headline → italic serif dek
- Multi-column body copy (2–3 columns) with hairline column rules
- Numbered features (\`Feature 04 — Lisbon\`) and small numerals in the margin
- Lead photograph cropped tight at one edge, headline tucked into the empty negative space
- Pull-quotes in italic, much larger than body, set in a single column

**Avoid**
- Sans-serif headlines — Monocle's signature is the serif voice
- Stock photography — the recipe requires commissioned-feeling photography (warm, peopled, place-rich)
- Card grids — this is magazine spread thinking, not SaaS thinking
- More than one accent color (the editorial red is enough)

**AI prompt seed**
> Editorial magazine photograph, place-specific scene (e.g., Tokyo back street at dusk), warm color grading, slight film grain, one human subject in middle-ground, 3:2, color palette restricted to warm earth tones with one red object.

**Don't use when**
- The task is a SaaS product page — magazine craft will feel mismatched
- There's no editorial / human / place content to lead with — without photography this recipe is hollow
- The audience expects fast scanning — Monocle rewards reading, not skimming

---

> **Same school — Editorial / Minimalist**: [\`apple-hig\`](./apple-hig.md) · [\`muji-kenya-hara\`](./muji-kenya-hara.md) · [\`aesop\`](./aesop.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/muji-kenya-hara.md',
    description: "MUJI / Kenya Hara · Emptiness as fullness, off-white as a value, near-silence",
    getContent: () => `
# muji-kenya-hara — MUJI / Kenya Hara

- **School**: Editorial / Minimalist
- **Vibe**: Emptiness as fullness, off-white as a value, near-silence
- **Best for**: Premium quiet positioning, lifestyle goods, "everyday craft" identity
- **Touchstone**: muji.com (any region), Kenya Hara's book *White*, MUJI ryokan signage

**Palette**
- Ground: \`#F4F2EC\` (warm paper off-white — never \`#FFFFFF\`)
- Ink: \`#2A2A28\` (warm ink, never \`#000000\`)
- Secondary text: \`#7C7B76\`
- Hairline: \`#D9D6CD\`
- Accent: there is none. If you must add one, a single brand red \`#C8161D\` used only as a tiny corner mark or rule.

**Typography**
- Display: a humanist sans like Söhne, Inter Tight, or Klim's Calibre — weight 400, never bolder than 500. Letterspacing slightly open (0.01em–0.02em).
- Body: same family at 15–16px, line-height ~1.8
- Japanese-bilingual deployments: Noto Sans CJK JP paired weight-for-weight

**Spacing**: 8 / 16 / 32 / 48 / 96 / 160 / 240. The big numbers matter — 240px between sections is normal.

**Radius**: 0. Hard, honest edges. Maybe 2px on form fields.

**Shadow**: none.

**Motion**: imperceptible. Fades over 600–900ms. Nothing translates more than a few px. Never bouncy.

**Signature moves**
- 60–80% of the page is empty space — content lives in a narrow column, far from edges
- One product image per "screen", small relative to the page, captioned plainly
- Tiny labels (10–11px, letter-spaced) describing what each section is — "01 — Cotton" — never headlines that shout
- Square-bracket-style asides, kept neutral
- Rules (1px hairlines) are the only ornament

**Avoid**
- Any saturated color other than the MUJI red as a corner mark
- Drop shadows, glows, gradients of any kind
- Tabs, accordions, mega-menus, sticky banners
- "Above the fold" thinking — MUJI lets the eye start in the middle of the page

**AI prompt seed**
> Single household object on warm off-white #F4F2EC paper ground, raked daylight from upper left, very long quiet space around the object, 3:2, photographed on film, no shadow drama, neutral tone.

**Don't use when**
- The product needs to communicate feature density (specs, pricing tiers, comparison tables) — MUJI's quietness will hide the message
- The audience scrolls fast and demands signal density (news / SaaS / dashboard) — they'll bounce
- The brand is in a noisy competitive set and needs to shout — quietness is luxury, but luxury isn't always what's needed

---

> **Same school — Editorial / Minimalist**: [\`apple-hig\`](./apple-hig.md) · [\`aesop\`](./aesop.md) · [\`dieter-rams-braun\`](./dieter-rams-braun.md) · [\`monocle-magazine\`](./monocle-magazine.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/notion-pre-ai.md',
    description: "Notion (pre-AI era, c. 2017–2022) · Friendly serif headline + emoji as first-class design element + soft cream + black ink",
    getContent: () => `
# notion-pre-ai — Notion (pre-AI era, c. 2017–2022)

- **School**: Modern Tool / Builder SaaS (warm-leaning, near Humanist border)
- **Vibe**: Friendly serif headline + emoji as first-class design element + soft cream + black ink
- **Best for**: Productivity tools for non-engineers, collaborative software, "your second brain" products
- **Touchstone**: notion.so pre-2023 redesigns (Wayback), early Notion marketing decks

**Palette**
- Ground: \`#FFFFFF\`
- Soft cream surface: \`#F7F6F3\`
- Ink: \`#37352F\` (Notion's specific not-quite-black, warm cast)
- Secondary text: \`#787774\`
- Hairline: \`#E9E9E7\`
- Accent palette: muted Notion colors — \`#E4F4F1\` (mint), \`#FFEDD5\` (peach), \`#FCE7F3\` (rose), \`#FEF3C7\` (sand) — used as soft block backgrounds, never as bright accents

**Typography**
- Display: a friendly modern serif — GT Sectra, Sentinel, or Source Serif Pro. Weight 500 for headlines.
- Body: Inter or Söhne at 16px, line-height 1.6, weight 400
- Emoji set at 1.25× body size, used as section markers and "page icons"

**Spacing**: 4 / 8 / 16 / 24 / 40 / 64

**Radius**: 4 (small UI) / 8 (cards) / 16 (large panels)

**Shadow**: very soft — \`0 2px 8px rgba(15, 15, 15, 0.04)\`. Notion's shadows are felt, not seen.

**Motion**: gentle ease-out around 200–300ms. Hover lifts cards by 2–4px with a soft shadow expansion.

**Signature moves**
- Section headers prefixed with a single emoji icon (\`📖 Notes\`, \`🌱 Ideas\`) — the emoji *is* the visual hierarchy
- Hand-drawn doodles or simple line illustrations integrated into the hero (Notion's signature illustration style)
- Block-based content metaphor visible in the layout — content reads like draggable cards rather than columns
- Color-tagged soft pills for category labels (mint = active, peach = idea, etc.)
- Friendly conversational microcopy

**Avoid**
- Too many emoji in close proximity (one per section header is the recipe, not five)
- Dark mode unless explicitly required (Notion's identity is light)
- Sans-serif headlines — the friendly serif is the differentiator
- Aggressive CTAs — Notion's hero CTA reads as an invitation, not a demand

**AI prompt seed**
> Hand-drawn doodle illustration, simple black-line drawing of an organized desk scene with notebooks and houseplants, on cream #F7F6F3 background, friendly approachable line work, small color washes in soft mint and peach, 3:2.

**Don't use when**
- The audience is enterprise-serious — emoji as design will read as unprofessional
- The product is graphics-heavy or needs visual density — Notion's recipe is text-led
- The voice is meant to be authoritative — Notion is approachable, not commanding

---

> **Same school — Modern Tool / Builder SaaS**: [\`linear\`](./linear.md) · [\`vercel-mesh\`](./vercel-mesh.md) · [\`raycast\`](./raycast.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/nyt-the-daily.md',
    description: "New York Times Editorial · Authoritative broadsheet, generations of typographic craft",
    getContent: () => `
# nyt-the-daily — New York Times Editorial

- **School**: Information Architecture
- **Vibe**: Authoritative broadsheet, generations of typographic craft
- **Best for**: Longform editorial, news / journalism products, narrative explainers
- **Touchstone**: nytimes.com homepage, NYT Cooking, NYT investigative features

**Palette**
- Ground: \`#FFFFFF\`
- Ink: \`#121212\`
- Secondary text: \`#666666\`
- NYT red \`#D0021B\` — used only for breaking-news indicators or sparingly
- Soft section background: \`#F7F7F7\`
- Hairline: \`#E2E2E2\`

**Typography**
- Display: Cheltenham (NYT's proprietary) — substitute Sentinel or Tiempos Headline. Weight 700 for hero, italic widely used.
- Subhead: Imperial or Lyon Display at weight 400
- Body: Imperial / Georgia / source serif at 18–20px, line-height ~1.55
- Sans for UI / kickers: Franklin (NYT) — substitute Söhne Mono or Söhne, weight 500, often in small caps

**Spacing**: 4 / 8 / 16 / 24 / 32 / 48 / 96. Multi-column grids for stories.

**Radius**: 0 throughout.

**Shadow**: none.

**Motion**: minimal — sticky bylines, lazy-loaded images fading in, slow zoom on hero photo over 8–15s.

**Signature moves**
- Three-deck hierarchy: tiny eyebrow ("OPINION" / "ANALYSIS" / "INVESTIGATION" in small-caps sans) → bold serif headline → italic serif standfirst
- Byline + timestamp block in sans below the headline, always
- Pull-quotes set in italic serif at 1.5–2× body size, with hairline rules above and below
- Multi-column body copy on wide viewports; single column on mobile (always readable)
- Inline images with serif captions; captions matter and are styled distinctively

**Avoid**
- Sans-serif headlines (the recipe's signature is the serif voice)
- Card grids of articles — NYT lays articles out as a front page, with hierarchy by size
- Pretty UI buttons in the body of articles
- Centered alignment for body (left-aligned justified is the recipe)

**AI prompt seed**
> Editorial photojournalism, single decisive moment image, natural lighting, 3:2 aspect, color grading neutral with slight desaturation, real-feeling not staged, place-specific.

**Don't use when**
- The product is a SaaS dashboard — NYT craft reads as overformal there
- Content is short and punchy (one-line CTAs) — NYT needs longform to land
- The brand has no editorial / authority claim — using NYT voice without the substance reads as cosplay

---

> **Same school — Information Architecture**: [\`pentagram\`](./pentagram.md) · [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`tufte-dataink\`](./tufte-dataink.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/pentagram.md',
    description: "Pentagram / Paula Scher · Bold typography as image; type does the visual work; everything else recedes",
    getContent: () => `
# pentagram — Pentagram / Paula Scher

- **School**: Information Architecture
- **Vibe**: Bold typography as image; type does the visual work; everything else recedes
- **Best for**: B2B identity, cultural institutions, "we mean business" moments
- **Touchstone**: pentagram.com, Paula Scher's Public Theater posters, MIT Media Lab identity

**Palette**
- High-contrast two-color: ink on ground. Common pairings:
  - Black \`#000000\` on white \`#FFFFFF\`
  - Cobalt \`#1E3FFF\` on cream \`#F4F1E7\`
  - Brick \`#B83A1F\` on bone \`#EFE9DC\`
- A single secondary accent only if the project demands a third color (used very sparingly)

**Typography**
- Display: a single grotesque used at massive scale — Helvetica Now (weight 700–900), Söhne Breit, or Druk. Headlines are often **set bigger than the column they live in**, breaking the margin on purpose.
- Body: the same family at body weight, 16–17px, line-height 1.45–1.55
- Numerals: tabular figures from the same family

**Spacing**: strict 12-column grid, generous gutters (24–32px). Baseline-grid alignment of every text element.

**Radius**: 0.

**Shadow**: none.

**Motion**: typographic moves only — letters shift in, headlines slide on a baseline. No 3D, no bouncy, no parallax.

**Signature moves**
- Headlines so large they touch (or visibly break past) the column edges
- Type as image — a single word or phrase at hero scale becomes the only graphic
- Color blocks (a flat rectangle of accent color) used as section dividers, often with a single huge number on them (\`02\`)
- Captions and metadata pinned to the grid in tiny precise type, often in the column gutter
- A single rule line (1px) sometimes drawn across the entire page width, anchoring everything

**Avoid**
- Photography as the visual lead (type leads, not photo) — exception: if there is a hero photo, it lives behind / under enormous type
- Multiple type families
- Gradients, shadows, decorative anything
- Card grids of content (Pentagram thinks in spreads, not cards)

**AI prompt seed**
> Editorial poster composition, single phrase set in massive black Helvetica weight 900, characters bleeding past the layout margins, behind it a flat field of cobalt #1E3FFF, no photography, no illustration, 3:4.

**Don't use when**
- Headlines can't be made bold and short (3–6 word phrases) — Pentagram needs strong copy
- Many tiers of feature density must be communicated (this is institutional voice, not feature catalog)
- The brand is meant to feel quiet — Pentagram is the opposite of quiet

---

> **Same school — Information Architecture**: [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`nyt-the-daily\`](./nyt-the-daily.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/raycast.md',
    description: "Raycast (Productivity Tool) · Glassy command-palette aesthetic, color extensions for personality, keyboard-first culture",
    getContent: () => `
# raycast — Raycast (Productivity Tool)

- **School**: Modern Tool / Builder SaaS
- **Vibe**: Glassy command-palette aesthetic, color extensions for personality, keyboard-first culture
- **Best for**: Productivity tools, command-palette / launcher products, dev utilities
- **Touchstone**: raycast.com, Raycast app screenshots, raycast.com/store extension cards

**Palette**
- Ground: \`#0F0F11\` (charcoal with hint of blue)
- Surface translucent: \`rgba(255,255,255,0.06)\` over a colored gradient backdrop
- Hairline: \`rgba(255,255,255,0.10)\`
- Primary text: \`#FFFFFF\`
- Secondary text: \`#B0B3B8\`
- Brand red accent: \`#FF6363\` — Raycast's signature, used on icons and key CTAs
- Extension chips: bright per-tile colors (lime, coral, lavender, cyan) used as accent dots on small surfaces only

**Typography**
- Display: Söhne weight 600, or Inter Tight weight 600
- Body: Inter at 14–15px, weight 500 (slightly heavier than Linear's 400 — Raycast feels punchier)
- Mono: SF Mono or JetBrains Mono for shortcut chips
- Letter-spacing on display: -0.02em

**Spacing**: 4 / 8 / 12 / 16 / 24 / 40 / 64

**Radius**: 8 (small) / 12 (medium) / 16 (cards) / 24 (large modal). Raycast's signature radius is the soft-corner command palette.

**Shadow**: cushiony — \`0 16px 40px rgba(0,0,0,0.4)\` on the command palette card; barely any shadow elsewhere

**Motion**: bouncy welcomed for key moments (the palette appearing, hover lift) — spring physics with mild overshoot. Otherwise quick 150ms ease-out.

**Signature moves**
- A floating command-palette screenshot in the hero, slightly tilted, casting a generous cushioned shadow, with a blurred colorful gradient backdrop visible through it (glass)
- Every keyboard shortcut shown as a styled chip — \`⌘\` \`↵\` \`⌥\` set in a precision mono with a hairline border and dim background
- Bright per-extension colors used as small accent dots on tile cards (a Notion tile has a tiny lavender dot, a GitHub tile has a charcoal one)
- Sticky color-banded gradient backdrop behind the hero (oranges → magentas, but soft-focused)
- Generously spaced section anatomy with clear hover lift on tiles

**Avoid**
- Too many bright extension colors on the same screen — they only work as small accents on a dark ground
- Solid bright-color buttons (Raycast buttons are usually translucent white pills with shortcut chips)
- Pure monochrome scenes — Raycast leans on color *just enough* to feel playful

**AI prompt seed**
> Productivity application interface, floating command palette card centered on the page, soft-focused colorful gradient backdrop in warm oranges and magentas behind it, dark charcoal foreground UI, cushioned drop shadow under the palette, no people, 16:9.

**Don't use when**
- The product isn't a launcher / command-palette / keyboard-first tool — the central glass palette image won't land otherwise
- The audience doesn't know keyboard shortcuts (they'll miss the recipe's main signal)
- A strictly enterprise tone is needed — Raycast skews playful

---

> **Same school — Modern Tool / Builder SaaS**: [\`linear\`](./linear.md) · [\`vercel-mesh\`](./vercel-mesh.md) · [\`notion-pre-ai\`](./notion-pre-ai.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/resn-storytelling.md',
    description: "Resn (Story Through Scroll) · Surprise as the reward; the page tells a story to those who scroll",
    getContent: () => `
# resn-storytelling — Resn (Story Through Scroll)

- **School**: Motion / Experimental
- **Vibe**: Surprise as the reward; the page tells a story to those who scroll
- **Best for**: Brand storytelling, agency portfolios, campaign microsites
- **Touchstone**: resn.co, Resn's case-study pages, awwwards site-of-the-day archives

**Palette**
- Project-driven — Resn's recipe is more about composition than a fixed palette
- Often warm-cool contrasted within one piece (warm character against cool environment, or vice versa)
- Saturated where the story demands; muted where it breathes

**Typography**
- A campaign-specific display face is almost always present — custom or unusual
- Body type quiet, often a humanist sans at small sizes
- Text often integrated *into* the scene (titles set in WebGL space, not on a fixed UI layer)

**Spacing**: irregular and composition-driven; not grid-strict

**Radius**: project-dependent

**Shadow**: scene-baked, not component

**Motion**: long-form choreography — a single page might tell a 90-second story across 8–12 scroll triggers, with payoffs at specific moments

**Signature moves**
- Scroll triggers reveal narrative beats — a character moves across the screen, a product is unveiled, a punchline lands
- Easter eggs hidden for repeat visitors
- Cursor-reactive surface materials (a hover changes a texture, an audio cue plays)
- Multi-scene composition — each section is treated as a film scene with its own art direction
- A reward at the end — a special interaction or scene only revealed on full scroll-through

**Avoid**
- Bloating with too many beats — Resn's recipe is "fewer, better" beats
- Pure decoration without narrative — every motion moment should advance the story
- Forgetting the punchline — the recipe needs a payoff scene

**AI prompt seed**
> Narrative scene from a brand microsite, mid-action moment, character or object in motion with intentional motion blur, warm-cool palette contrast, theatrical lighting, 16:9.

**Don't use when**
- There's no story to tell (the recipe needs narrative content)
- Audience won't scroll patiently (Resn rewards patience — for impatient audiences, choose a static recipe)
- The build is rushed — Resn's recipe demands choreography time

---

> **Same school — Motion / Experimental**: [\`field-io\`](./field-io.md) · [\`active-theory\`](./active-theory.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/stripe-press.md',
    description: "Stripe Press · Books as objects, cream + ink, warm photography, the kind of design only a successful infrastructure company funds",
    getContent: () => `
# stripe-press — Stripe Press

- **School**: Warm Humanist (with editorial bones)
- **Vibe**: Books as objects, cream + ink, warm photography, the kind of design only a successful infrastructure company funds
- **Best for**: Editorial / publishing, longform features, "books and ideas" products
- **Touchstone**: press.stripe.com, the physical Stripe Press books (cloth-bound, foil-stamped)

**Palette**
- Ground: \`#F1ECDE\` (warm bone)
- Surface darker: \`#E6DCC4\`
- Ink: \`#1A1A18\` (very warm near-black)
- Secondary text: \`#736D5A\`
- Foil-stamp accent: deep teal \`#1B4B5A\` or burnt sienna \`#A04A2A\` (book-cover-specific colors)
- Hairline: \`#C8BEA4\`

**Typography**
- Display: a refined transitional or modern serif — GT Sectra, Domaine Display, Italian Old Style. Italic everywhere.
- Body: an old-style serif at 18–19px, line-height 1.65 — Source Serif, Lyon Text, ITC Galliard
- Sans for UI only: a humanist sans at small sizes for nav and captions — Söhne or GT America
- Often pairs a wide display serif with a slim body serif

**Spacing**: 4 / 8 / 16 / 24 / 32 / 48 / 96. Editorial breathing room.

**Radius**: 0 throughout (books don't have rounded corners)

**Shadow**: present on book objects — \`0 24px 48px rgba(0, 0, 0, 0.18)\` to make books feel three-dimensional on the page

**Motion**: slow, slow, slow. Crossfades over 1–2 seconds. Books rotate gently in 3D on hover (~15° max). Ken Burns on hero photography (~20s).

**Signature moves**
- Book-cover photography as hero — the actual physical object photographed on cream paper with a warm raking light and an honest shadow
- Wide-set serif italic for emphasis, set 1.5–2× body size
- Author / chapter quotes in oversized italic serif, hung against a wide margin
- Cloth-textured backgrounds for section breaks (subtle textile pattern at low opacity)
- A single foil-stamp color per book / chapter (gold, deep teal, burnt sienna) — never combined

**Avoid**
- Pure white grounds (the warm cream is part of the recipe)
- Sans-serif body type (the editorial serif is the signature)
- Card grids of books — Stripe Press lays each book out as a feature, not a tile
- Cold neutral gray — every gray here has a warm cast

**AI prompt seed**
> Hardcover book photographed on warm cream paper #F1ECDE, raking afternoon window light, deep soft shadow, single book object, cloth-bound spine visible, foil-stamped title in burnt sienna, 4:5, editorial product photography.

**Don't use when**
- The deliverable has no editorial / book / publication content
- The brand voice is light or playful (Stripe Press is sincere and considered)
- The audience won't sit for longform — recipe rewards reading

---

> **Same school — Warm Humanist**: [\`mailchimp-freddie\`](./mailchimp-freddie.md) · [\`headspace-meditation\`](./headspace-meditation.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/tufte-dataink.md',
    description: "Edward Tufte / Maximum Data-Ink · Every pixel earns its place; the chart is the page",
    getContent: () => `
# tufte-dataink — Edward Tufte / Maximum Data-Ink

- **School**: Information Architecture
- **Vibe**: Every pixel earns its place; the chart is the page
- **Best for**: Analytical reports, scientific publications, data-led storytelling
- **Touchstone**: *The Visual Display of Quantitative Information*, *Beautiful Evidence*, edwardtufte.com

**Palette**
- Ground: \`#FBFAF6\` (warm paper)
- Ink: \`#1B1B1A\`
- Two data colors only — typically a warm red \`#A6300E\` and a cool slate \`#3E4A5C\`. Add a third only if a third dimension genuinely needs it.
- Faint reference rules: \`#D8D2C2\`

**Typography**
- Display & body: an old-style or transitional serif — ET Book (Tufte's own family), Equity, or Lyon Text. Weight 400 for body, italic for emphasis.
- Body at 12–14px (Tufte deliberately uses small body text — the reader leans in)
- Sans for axis labels only — a humanist sans at 10–11px, color \`#5C5550\`

**Spacing**: tight. 4 / 8 / 12 / 16 / 24 / 48. Margins are filled with side-notes, not whitespace.

**Radius**: 0.

**Shadow**: none.

**Motion**: none. The page is meant to be read still.

**Signature moves**
- Sparklines inline with body copy (a tiny chart embedded in a sentence)
- Side-notes (marginalia) used heavily — annotations live in the right margin, not in tooltips
- Charts have no chart-junk: no gridlines except faint ones, no border boxes, no 3D, no legends if direct labels work
- Small multiples — a 3×3 grid of the same chart with different data
- Direct labels on data series (the line is labeled at its endpoint, not in a legend box)

**Avoid**
- Pie charts (Tufte would not approve)
- 3D anything
- Gridlines darker than \`#D8D2C2\`
- Multiple chart types on the same page when one would do
- Color for decoration (every color must encode meaning)

**AI prompt seed**
> Editorial scientific figure, warm paper #FBFAF6 background, multi-line time-series chart with two data series in muted red and slate, direct labels at line endpoints, side-note callouts in italic serif, no chart frame, no legend, 4:3.

**Don't use when**
- The chart is decorative (Tufte demands the chart be the *point*)
- The reader expects interactive tooltips / filters (Tufte is for static editorial figures)
- The medium is mobile (small body type plus margin notes doesn't fit)

---

> **Same school — Information Architecture**: [\`pentagram\`](./pentagram.md) · [\`vignelli-swiss-helvetica\`](./vignelli-swiss-helvetica.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`nyt-the-daily\`](./nyt-the-daily.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/vercel-mesh.md',
    description: "Vercel (Gradient Mesh Era) · Black-and-white precision broken by a single shimmering gradient mesh",
    getContent: () => `
# vercel-mesh — Vercel (Gradient Mesh Era)

- **School**: Modern Tool / Builder SaaS (also touches Motion / Experimental)
- **Vibe**: Black-and-white precision broken by a single shimmering gradient mesh
- **Best for**: Platform / infrastructure tools, AI tools, deeply technical products that want to feel modern but not AI-cliché
- **Touchstone**: vercel.com, the v0.dev landing, nextjs.org

**Palette**
- Ground: \`#000000\` (true black)
- Surface 1: \`#0A0A0A\`
- Surface 2: \`#111111\`
- Hairline: \`#1F1F1F\` or \`rgba(255,255,255,0.08)\`
- Primary text: \`#EDEDED\`
- Secondary text: \`#888888\`
- Gradient mesh accents (used only in hero / section breaks):
  - Cyan \`#0070F3\` → magenta \`#FF0080\` → orange \`#F5A623\` — but mixed at low saturation and high feathering, never a hard purple-pink AI gradient
- One sharp accent for CTAs: white \`#FFFFFF\` button on black ground (high contrast)

**Typography**
- Display: Geist Sans (weight 500–600) — Vercel's own family. Substitute Inter Tight weight 600.
- Body: Geist Sans at 15–16px, weight 400, line-height 1.6
- Mono: Geist Mono — for code, terminal-style commands, deploy logs

**Spacing**: 4 / 8 / 16 / 24 / 40 / 64 / 96 / 128

**Radius**: 8 (small) / 12 (medium) / 16 (large). Slightly more generous than Linear, but still disciplined.

**Shadow**: minimal at component level; the *page* feels lit by the gradient mesh, not by shadows.

**Motion**: snappy ease-out (cubic-bezier(0.16, 1, 0.3, 1)), 200ms hovers, 500–700ms for layout. The mesh itself slowly drifts (10–20s loop).

**Signature moves**
- One full-bleed gradient mesh in the hero — diffuse, dreamy, feathered to black edges
- Otherwise the page is black-and-white with hairline detail and monospace accents
- Deploy / terminal log readouts as a hero element (real-feeling, not lorem)
- Animated mesh on hover for cards (the card "lights up" with a soft glow from below)
- White solid buttons (\`#FFFFFF\` on \`#000000\`) — high contrast, no gradient, no shadow

**Avoid**
- Bright saturated purple → pink gradients (that's the AI cliché the recipe is *replacing*)
- More than one mesh per page
- Glow on every component (selective use — one hero, maybe one section break, that's it)
- Colored buttons (the brand button is white)

**AI prompt seed**
> Abstract atmospheric gradient on pure black #000000 background, deep blue #0070F3 fading into magenta #FF0080 and orange #F5A623, feathered edges blending into black, dreamy soft focus, no objects, no text, 16:9, very low saturation overall.

**Don't use when**
- The brand isn't a platform / infra / tooling product — meshes on a consumer site read as "trying too hard"
- Multiple gradient meshes are needed (use one or none, never several)
- The audience expects warm / human feel

---

> **Same school — Modern Tool / Builder SaaS**: [\`linear\`](./linear.md) · [\`raycast\`](./raycast.md) · [\`notion-pre-ai\`](./notion-pre-ai.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/vignelli-swiss-helvetica.md',
    description: "Vignelli / Swiss International · Strict grid, Helvetica throughout, \"six typefaces are enough\"",
    getContent: () => `
# vignelli-swiss-helvetica — Vignelli / Swiss International

- **School**: Information Architecture
- **Vibe**: Strict grid, Helvetica throughout, "six typefaces are enough"
- **Best for**: Wayfinding / transit systems, institutional identity, deeply ordered information
- **Touchstone**: 1972 NYC Subway map (Vignelli), Knoll catalogues, *The Vignelli Canon*

**Palette**
- Black \`#000000\` and white \`#FFFFFF\`
- Plus one of: red \`#E2231A\` / yellow \`#F5C518\` / blue \`#0033A0\` / orange \`#FF6F00\` (only one — never two accents)
- Cool gray \`#8A8A8A\` for secondary content

**Typography**
- Display & body: Helvetica or Helvetica Now exclusively. Weights: 400 / 500 / 700, no italic.
- Hierarchy by size, not weight or color
- Common scale: 72 / 48 / 32 / 24 / 16 / 12, all on the same baseline grid

**Spacing**: 8px baseline grid, 12-column layout, generous baseline-to-baseline spacing equal to or greater than the type size.

**Radius**: 0, always.

**Shadow**: none.

**Motion**: none, or instant. Swiss design is static by nature; if anything moves, it moves like signage being rotated into place.

**Signature moves**
- A bold horizontal or vertical color bar carries the section header in white Helvetica
- The grid is **visible** when it helps — column gutters sometimes drawn as faint lines
- Information sets (data, schedules, lists) get tabular layouts with strict baseline alignment
- Body copy is left-aligned in a single readable measure (~60–70 characters); never centered
- A single oversized number (chapter / section) sits at the top-left corner of each block

**Avoid**
- Serifs entirely
- Color combinations other than ink + ground + one accent
- Italic, drop shadows, gradients, any softness
- "Friendly" copywriting tone — Swiss is matter-of-fact

**AI prompt seed**
> Transit-signage style composition, large directional arrow set in black on flat field of single accent color, condensed Helvetica destination labels, no decoration, 16:9 flat vector aesthetic.

**Don't use when**
- The brand needs warmth — Helvetica + grid reads as institutional / cold
- The content is emotional / storytelling — Swiss strips emotion out
- Modernity / freshness is the goal — Swiss design now reads as classical / archival

---

> **Same school — Information Architecture**: [\`pentagram\`](./pentagram.md) · [\`bloomberg-terminal\`](./bloomberg-terminal.md) · [\`tufte-dataink\`](./tufte-dataink.md) · [\`nyt-the-daily\`](./nyt-the-daily.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
  {
    name: 'references/style-recipes/y2k-retrofuturism.md',
    description: "Y2K / Frutiger Aero Retrofuturism · Late-90s / early-2000s techno-optimism: chrome, glassy bubbles, jelly translucency, lens flare",
    getContent: () => `
# y2k-retrofuturism — Y2K / Frutiger Aero Retrofuturism

- **School**: Specialty / Genre
- **Vibe**: Late-90s / early-2000s techno-optimism: chrome, glassy bubbles, jelly translucency, lens flare
- **Best for**: Fashion / music / nostalgia-coded products, creative campaigns, anything referencing 1999–2005 internet
- **Touchstone**: late-90s Apple iMac G3 ads, Windows Vista Aero, the original iPod aqua buttons, MySpace pages

**Palette**
- Ground: electric ice blue \`#A3D5FF\` or chrome silver \`#E0E4EA\`
- Glass accents: cyan \`#5FC9F8\` → magenta \`#FF66C4\` (the iridescent / oil-slick gradient)
- Chrome: brushed-steel highlights at \`#C4C9D2\` to \`#F2F4F8\`
- Acid green pops: \`#A8FF00\` (used sparingly)
- Ink: \`#000000\` or \`#FFFFFF\` depending on ground

**Typography**
- Display: a chunky rounded sans with personality — Frutiger, Eurostile, or Sharp Grotesk in heavy weight; sometimes a chrome-effect treatment
- Body: friendly humanist sans like Frutiger or Avenir at 14–16px
- Numerals love an LCD / digital-readout treatment for hero counters
- Underline + sparkle treatments common on link hover

**Spacing**: 4 / 8 / 16 / 24 — packed but bubbly

**Radius**: gummy — 16 / 24 / 32 / 9999 (full circle). Buttons are pill-shaped jelly bubbles.

**Shadow**: heavy and colored — glossy reflections, drop shadows like \`0 16px 32px rgba(95, 201, 248, 0.4)\`. Inner highlights to simulate glass.

**Motion**: bouncy springs, glow pulses, lens flare sweeps. Anything that recalls early-Flash interactions.

**Signature moves**
- Glassy translucent buttons with an inner top highlight (faking aqua / lozenge)
- Iridescent oil-slick gradients on hero / character imagery
- Chrome-effect type with sparkle overlays
- Lens flare or specular highlight on any glass surface
- 3D / dimensional UI elements (the OS-X-Aqua dock effect)
- Floating circular orbs / bubbles drifting in the background

**Avoid**
- Sharp corners
- Muted / earthy palettes — Y2K is bright and synthetic
- Restrained typography — Y2K is exuberant
- Anything that reads as "tasteful 2020s minimalism"

**AI prompt seed**
> Y2K retrofuturism scene, chrome silver and ice-blue iridescent gradient background, floating glass orbs with cyan and magenta oil-slick reflections, lens flare in upper right, single bright translucent pill-shaped button, late-1990s techno-optimism vibe, 16:9.

**Don't use when**
- The brand has no nostalgic / retro / playful claim
- The audience is enterprise / professional — this recipe is consumer-fashion-music coded
- Long-form readability matters (Y2K is for moments, not for reading)

---

> **Same school — Specialty / Genre**: [\`mid-century-modern\`](./mid-century-modern.md)  
> **Browse all 25 recipes**: [INDEX.md](./INDEX.md)

`,
  },
]
