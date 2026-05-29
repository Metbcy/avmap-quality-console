// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SplashOverlay, { SPLASH_STORAGE_KEY } from "@/components/SplashOverlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(createElement(SplashOverlay));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

describe("SplashOverlay", () => {
  it("renders when the dismiss flag is absent in localStorage", () => {
    render();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("AV Map Quality Console");
  });

  it("does not render when the dismiss flag is true", () => {
    window.localStorage.setItem(SPLASH_STORAGE_KEY, "true");
    render();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it("persists the dismissal flag and unmounts the dialog when Get started is clicked", () => {
    render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="splash-get-started"]',
    );
    expect(button).not.toBeNull();

    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.localStorage.getItem(SPLASH_STORAGE_KEY)).toBe("true");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("persists the dismissal flag when the close button is clicked", () => {
    render();
    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close welcome dialog"]',
    );
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.localStorage.getItem(SPLASH_STORAGE_KEY)).toBe("true");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
