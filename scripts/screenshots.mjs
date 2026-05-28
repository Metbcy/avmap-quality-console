import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3210";
const OUT = "screenshots";

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("wrote", file);
}

async function settle(page, ms = 3500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForSelector(".maplibregl-canvas", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: false,
    executablePath: "/config/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
    args: [
      "--no-sandbox",
      "--disable-gpu-sandbox",
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

  // 1. Triage overview (SF default)
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await settle(page, 3500);
  await shot(page, "triage-overview.png");

  // 2. Triage filtered — set threshold to 0.85 and toggle "show only flagged"
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

  // reset filter and click a red tile
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

  // 3. Tile detail — click center of map
  const canvas = page.locator(".maplibregl-canvas").first();
  const box = await canvas.boundingBox({ timeout: 8000 }).catch(() => null);
  if (box) {
    // try multiple clicks until detail panel populates
    let clicked = false;
    for (const [dx, dy] of [
      [0.5, 0.5],
      [0.45, 0.55],
      [0.55, 0.45],
      [0.6, 0.5],
      [0.4, 0.5],
      [0.5, 0.6],
      [0.5, 0.4],
      [0.35, 0.65],
    ]) {
      await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
      await page.waitForTimeout(400);
      const has = await page.locator("text=Score breakdown").count();
      if (has > 0) {
        clicked = true;
        break;
      }
    }
    if (!clicked) console.log("warning: tile click did not open detail panel");
  }
  await settle(page, 800);
  await shot(page, "triage-tile-detail.png");

  // 6. MV overview — click MV button (second city button)
  await page.locator('button', { hasText: 'Mountain View' }).first().click();
  await settle(page, 3500);
  await shot(page, "mv-overview.png");

  // 4. Diff overview
  await page.goto(`${BASE}/diff`, { waitUntil: "networkidle" });
  await settle(page, 3500);
  await shot(page, "diff-overview.png");

  // 5. Diff reviewing — approve first diff, type a comment if there's an input
  const approveBtn = page.locator('button:has-text("Approve")').first();
  if (await approveBtn.count()) {
    await approveBtn.click();
    await page.waitForTimeout(300);
  }
  const ta = page.locator("textarea, input[type=text]").first();
  if (await ta.count()) {
    await ta.fill("LGTM — verified against latest construction notice");
  }
  await settle(page, 1200);
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
