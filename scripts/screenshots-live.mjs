import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "https://metbcy.github.io/avmap-quality-console";
const OUT = "screenshots";

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("wrote", file);
}

async function settle(page, ms = 2500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

// Wait for MapLibre canvas to actually paint tiles (not just exist).
async function waitForMapPaint(page, ms = 4500) {
  await page.waitForSelector("canvas", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function dismissSplash(page) {
  // localStorage flag may not be set on fresh context; click the button if present.
  const btn = page.locator('[data-testid="splash-get-started"]');
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: false,
    executablePath: "/config/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
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

  // 1. Splash overlay first (fresh visit, no localStorage flag)
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  await waitForMapPaint(page);
  console.log("errs after first load:", errs.length, errs.slice(0, 5));
  await shot(page, "splash-overlay.png");

  // Dismiss splash for the rest
  await dismissSplash(page);
  await waitForMapPaint(page, 2000);
  await shot(page, "triage-overview.png");

  // 2. Triage filtered: threshold 0.92 + show-only-flagged
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
  await settle(page, 1500);
  await shot(page, "triage-filtered.png");

  // Reset filter
  await page.locator('input[type="checkbox"]').first().uncheck({ force: true, timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    const range = document.querySelector('input[type="range"]');
    if (!range) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(range, "0.80");
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(page, 1200);

  // 3. Tile detail: click on the canvas roughly mid-map to hit a tile.
  // With MapLibre we can't easily click an SVG polygon; click on canvas at a known offset.
  const canvas = page.locator("canvas").first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      // Click at several offsets until detail panel appears.
      const tries = [
        [box.width * 0.55, box.height * 0.5],
        [box.width * 0.45, box.height * 0.55],
        [box.width * 0.6, box.height * 0.45],
        [box.width * 0.5, box.height * 0.6],
        [box.width * 0.5, box.height * 0.4],
      ];
      for (const [dx, dy] of tries) {
        await page.mouse.click(box.x + dx, box.y + dy);
        await page.waitForTimeout(400);
        if ((await page.locator("text=Score breakdown").count()) > 0) break;
      }
    }
  }
  await settle(page, 800);
  await shot(page, "triage-tile-detail.png");

  // 4. Mountain View
  const mvBtn = page.locator("button", { hasText: "Mountain View" }).first();
  if (await mvBtn.count()) await mvBtn.click({ timeout: 5000 }).catch(() => {});
  await waitForMapPaint(page, 3000);
  await shot(page, "mv-overview.png");

  // 5. Diff overview
  await page.goto(`${BASE}/diff/`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  await waitForMapPaint(page, 3000);
  await dismissSplash(page);
  await shot(page, "diff-overview.png");

  // 6. Lanelet2 viewer
  await page.goto(`${BASE}/lanelet/`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  await waitForMapPaint(page, 3000);
  await dismissSplash(page);
  await shot(page, "lanelet-overview.png");

  // 7. Diff reviewing: claim + comment
  await page.goto(`${BASE}/diff/`, { waitUntil: "networkidle" });
  await settle(page, 2000);
  await waitForMapPaint(page, 2500);
  await dismissSplash(page);
  const claimBtn = page.locator('button:has-text("Claim")').first();
  if (await claimBtn.count()) {
    await claimBtn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const ta = page.locator("textarea").first();
  if (await ta.count()) {
    await ta.fill("LGTM, verified against latest construction notice");
  }
  await settle(page, 1000);
  await shot(page, "diff-reviewing.png");

  // 8. Coverage (added since this view didn't exist when original screenshots were made)
  await page.goto(`${BASE}/coverage/`, { waitUntil: "networkidle" });
  await settle(page, 2000);
  await dismissSplash(page);
  await settle(page, 1500);
  await shot(page, "coverage-overview.png");

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
