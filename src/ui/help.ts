import readme from "../../README.md?raw";
import { renderMarkdown, extractHelp } from "./markdown";

/**
 * Help overlay. Its text is the README's help section, rendered at build
 * time from the same file, so the two cannot drift apart. The soup keeps
 * running behind it.
 */
export class HelpOverlay {
  isOpen = false;
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "help-overlay";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <h1 id="help-title">AlgoChem: a lambda soup</h1>
          <button class="close" title="Close (Esc)">×</button>
        </header>
        <div class="help-body">${renderMarkdown(extractHelp(readme))}</div>
      </div>
    `;
    parent.appendChild(this.root);

    this.root.querySelector(".close")!.addEventListener("click", () => this.toggle(false));
    // Click on the backdrop (not the card) closes.
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.toggle(false);
    });
    window.addEventListener("keydown", (e) => {
      if (this.isOpen && e.key === "Escape") this.toggle(false);
    });
  }

  toggle(open = !this.isOpen): void {
    this.isOpen = open;
    this.root.hidden = !open;
    if (open) this.root.querySelector<HTMLElement>(".help-body")!.scrollTop = 0;
  }
}
