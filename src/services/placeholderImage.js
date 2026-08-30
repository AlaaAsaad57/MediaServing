const { processImage } = require("../processors/imageProcessor");

const MIN_SIDE = 16;

// Formats we are willing to emit. `svg` is deliberately absent: the placeholder
// must never be served back as markup, and the transform route already forces
// PNG for SVG sources.
const PLACEHOLDER_FORMATS = new Set(["webp", "jpeg", "jpg", "png", "avif"]);

// Renders are a few milliseconds each, but a broken URL is usually requested
// many times in a row. This map is process memory only — never S3.
const RENDER_CACHE_LIMIT = 32;
const renderCache = new Map();

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxSide() {
  return envInt("PLACEHOLDER_MAX_SIZE", 2000);
}

function defaultSide() {
  return envInt("PLACEHOLDER_DEFAULT_SIZE", 600);
}

function clampSide(value) {
  return Math.min(Math.max(Math.round(value), MIN_SIDE), maxSide());
}

function toSide(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Decide the placeholder size from the requested transform params.
 *
 * Both sides given -> use them. One side -> square, because a square never
 * looks wrong inside a CSS box that sets its own aspect ratio. Neither ->
 * the default. Every side is clamped so `w_99999` cannot exhaust memory.
 */
function resolvePlaceholderSize(params = {}) {
  const width = toSide(params?.w);
  const height = toSide(params?.h);

  if (width && height) {
    return { width: clampSide(width), height: clampSide(height) };
  }
  if (width) return { width: clampSide(width), height: clampSide(width) };
  if (height) return { width: clampSide(height), height: clampSide(height) };

  const side = clampSide(defaultSide());
  return { width: side, height: side };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Build the placeholder as SVG so one piece of geometry covers every size.
 *
 * The glyph is drawn in a 24x24 unit box and placed with a single
 * translate/scale, so it stays centred and proportional from a 16 px avatar
 * to a 2000 px hero. The three bounds below, in order: 34% of the shorter
 * side is the look we want; the 24 px floor keeps it legible when tiny; the
 * 0.8 ceiling stops the floor from overflowing the panel; 320 px stops it
 * from dominating a very large image.
 */
function buildPlaceholderSvg(width, height) {
  const background = process.env.PLACEHOLDER_BG || "#EDEEF0";
  const foreground = process.env.PLACEHOLDER_FG || "#B4B9C2";

  const shorter = Math.min(width, height);
  const iconSize = Math.min(Math.max(0.34 * shorter, 24), 0.8 * shorter, 320);
  const scale = round(iconSize / 24);
  const offsetX = round((width - iconSize) / 2);
  const offsetY = round((height - iconSize) / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${background}"/>
<g transform="translate(${offsetX} ${offsetY}) scale(${scale})" fill="none" stroke="${foreground}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
<rect x="1.6" y="3.6" width="20.8" height="16.8" rx="2.4"/>
<circle cx="8.2" cy="9.4" r="1.9"/>
<path d="M2.4 16.6 L8.1 11.2 L13.2 15.7 L16.4 12.9 L21.6 17.6"/>
</g>
</svg>`;
}

/**
 * Rasterise the placeholder at an exact pixel size.
 *
 * `processImage` is given no `w`/`h`, so Sharp renders the SVG at the size
 * declared on the element and does not resample afterwards. Format and
 * quality handling therefore stay in one place.
 */
async function renderPlaceholder({ width, height, format, quality }) {
  const outputFormat = PLACEHOLDER_FORMATS.has(format) ? format : "webp";
  const cacheKey = `${width}x${height}:${outputFormat}:${quality ?? ""}`;

  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  const svg = Buffer.from(buildPlaceholderSvg(width, height));
  const rendered = await processImage(svg, {
    f: outputFormat,
    ...(typeof quality === "number" ? { q: quality } : {}),
  });

  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    renderCache.delete(renderCache.keys().next().value);
  }
  renderCache.set(cacheKey, rendered);

  return rendered;
}

module.exports = {
  resolvePlaceholderSize,
  buildPlaceholderSvg,
  renderPlaceholder,
};
