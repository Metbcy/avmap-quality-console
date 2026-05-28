import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT = "screenshots";
// Append ?nogl=1 to every page so map components use the deterministic SVG
// fallback instead of MapLibre/WebGL. Headless Chromium WebGL is flaky on
// CI/sandboxed hosts; this gives byte-stable screenshots without GPU.
const Q = "?nogl=1";

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("wrote", file);
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/config/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });

  const errs = [];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console " + m.text());
  });

  // 1. Triage overview (SF default)
  await page.goto(`${BASE}/${Q}`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  console.log("errs after first load:", errs.length, errs.slice(0, 5));
  await shot(page, "triage-overview.png");

  // 2. Triage filtered , set threshold to 0.92 and toggle "show only flagged"
  await page.evaluate(() => {
    const range = document.querySelector('input[type="range"]');
    if (range) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(range, "0.92");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.locator('input[type="checkbox"]').first().check({ force: true, timeout: 5000 }).catch(() => {});
  await settle(page, 1000);
  await shot(page, "triage-filtered.png");

  // reset filter and click a tile
  await page.locator('input[type="checkbox"]').first().uncheck({ force: true, timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    const range = document.querySelector('input[type="range"]');
    if (!range) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(range, "0.80");
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(page, 800);

  // 3. Tile detail , click an SVG polygon directly (nogl mode renders <polygon>)
  const polys = page.locator("polygon");
  const n = await polys.count();
  if (n > 0) {
    let clicked = false;
    // Walk a sample of polygons until one opens the detail panel.
    const tryIdxs = [Math.floor(n / 2), Math.floor(n / 3), Math.floor(n / 4), 0, n - 1];
    for (const i of tryIdxs) {
      await polys.nth(i).click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      if ((await page.locator("text=Score breakdown").count()) > 0) {
        clicked = true;
        break;
      }
    }
    if (!clicked) console.log("warning: tile click did not open detail panel");
  }
  await settle(page, 500);
  await shot(page, "triage-tile-detail.png");

  // 4. MV overview , click Mountain View button
  const mvBtn = page.locator("button", { hasText: "Mountain View" }).first();
  if (await mvBtn.count()) await mvBtn.click({ timeout: 5000 }).catch(() => {});
  await settle(page, 1500);
  await shot(page, "mv-overview.png");

  // 5. Diff overview
  await page.goto(`${BASE}/diff${Q}`, { waitUntil: "networkidle" });
  await settle(page, 2000);
  await shot(page, "diff-overview.png");

  // 6. Lanelet2 viewer
  await page.goto(`${BASE}/lanelet${Q}`, { waitUntil: "networkidle" });
  await settle(page, 2000);
  await shot(page, "lanelet-overview.png");

  // 7. Diff reviewing , claim first edit + add a comment
  await page.goto(`${BASE}/diff${Q}`, { waitUntil: "networkidle" });
  await settle(page, 1500);
  const claimBtn = page.locator('button:has-text("Claim")').first();
  if (await claimBtn.count()) {
    await claimBtn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const ta = page.locator("textarea").first();
  if (await ta.count()) {
    await ta.fill("LGTM , verified against latest construction notice");
  }
  await settle(page, 800);
  await shot(page, "diff-reviewing.png");

  await browser.close();

  if (errs.length) {
    console.log("\n--- runtime errors ---");
    errs.forEach((e) => console.log(e));
  } else {
    console.log("\nno runtime errors");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
