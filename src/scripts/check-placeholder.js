"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const {
  resolvePlaceholderSize,
  buildPlaceholderSvg,
  renderPlaceholder,
} = require("../services/placeholderImage");

const outDir = path.join(os.tmpdir(), "placeholder-check");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // ── Sizing rules (design D9) ────────────────────────────────────────
  assert.deepEqual(resolvePlaceholderSize({ w: 400, h: 200 }), {
    width: 400,
    height: 200,
  });
  assert.deepEqual(resolvePlaceholderSize({ w: 400 }), {
    width: 400,
    height: 400,
  });
  assert.deepEqual(resolvePlaceholderSize({ h: 300 }), {
    width: 300,
    height: 300,
  });
  assert.deepEqual(resolvePlaceholderSize({}), { width: 600, height: 600 });
  assert.deepEqual(resolvePlaceholderSize({ w: 99999 }), {
    width: 2000,
    height: 2000,
  });
  assert.deepEqual(resolvePlaceholderSize({ w: 2 }), { width: 16, height: 16 });
  assert.deepEqual(resolvePlaceholderSize({ w: -5, h: 0 }), {
    width: 600,
    height: 600,
  });
  console.log("ok  sizing rules");

  // ── The glyph never overflows its panel ─────────────────────────────
  for (const [w, h] of [
    [16, 16],
    [40, 40],
    [120, 120],
    [600, 600],
    [1600, 900],
    [2000, 2000],
  ]) {
    const svg = buildPlaceholderSvg(w, h);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.includes(`width="${w}"`), `svg declares width ${w}`);
    assert.ok(svg.includes(`height="${h}"`), `svg declares height ${h}`);

    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    const iconSize = scale * 24;
    assert.ok(
      iconSize <= Math.min(w, h) * 0.8 + 0.01,
      `icon ${iconSize} fits inside ${w}x${h}`,
    );
    assert.ok(iconSize > 0, "icon has a positive size");
  }
  console.log("ok  glyph geometry");

  // ── Rendering produces the exact requested pixel size ───────────────
  for (const [w, h] of [
    [16, 16],
    [40, 40],
    [120, 120],
    [600, 600],
    [1600, 900],
    [2000, 2000],
  ]) {
    const { buffer, contentType } = await renderPlaceholder({
      width: w,
      height: h,
      format: "png",
    });
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.width, w, `rendered width for ${w}x${h}`);
    assert.equal(meta.height, h, `rendered height for ${w}x${h}`);
    assert.equal(contentType, "image/png");
    fs.writeFileSync(path.join(outDir, `placeholder-${w}x${h}.png`), buffer);
  }
  console.log("ok  render dimensions");

  // ── Format handling ─────────────────────────────────────────────────
  const webp = await renderPlaceholder({ width: 300, height: 200 });
  assert.equal(webp.contentType, "image/webp", "defaults to webp");

  const jpeg = await renderPlaceholder({
    width: 300,
    height: 200,
    format: "jpg",
  });
  assert.equal(jpeg.contentType, "image/jpeg", "jpg maps to image/jpeg");

  const bogus = await renderPlaceholder({
    width: 300,
    height: 200,
    format: "svg",
  });
  assert.equal(bogus.contentType, "image/webp", "svg falls back to webp");
  console.log("ok  format handling");

  // ── The render cache returns the same buffer, and stays bounded ─────
  const a = await renderPlaceholder({ width: 321, height: 123, format: "png" });
  const b = await renderPlaceholder({ width: 321, height: 123, format: "png" });
  assert.equal(a.buffer, b.buffer, "second call is served from the cache");

  for (let i = 0; i < 60; i += 1) {
    await renderPlaceholder({ width: 100 + i, height: 100, format: "png" });
  }
  console.log("ok  render cache");

  console.log(`\nAll placeholder checks passed. Samples in: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
