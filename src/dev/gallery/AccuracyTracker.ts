import { FeedbackZone } from "./HitFeedback";

// SHOOTING GALLERY の命中精度パネル＋ヒットログ（DEV RANGE専用のDOMオーバーレイ）。
// 画面右上に発射数・命中数・命中率・部位内訳を表示し、直近の命中を時系列で並べる。
export class AccuracyTracker {
  readonly element: HTMLElement;

  private shots = 0;
  private hits = 0;
  private head = 0;
  private body = 0;
  private graze = 0;
  private miss = 0;
  private log: string[] = [];

  private statsEl: HTMLElement;
  private logEl: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    Object.assign(this.element.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      width: "210px",
      padding: "10px 12px",
      background: "rgba(12,14,18,0.82)",
      border: "1px solid #2b3340",
      borderRadius: "8px",
      color: "#e6edf3",
      font: "12px/1.5 ui-monospace, Menlo, monospace",
      zIndex: "40",
      pointerEvents: "none",
      display: "none",
      userSelect: "none",
    } as CSSStyleDeclaration);

    const title = document.createElement("div");
    title.textContent = "ACCURACY";
    Object.assign(title.style, {
      color: "#4ad6a0",
      fontWeight: "700",
      letterSpacing: "1px",
      marginBottom: "6px",
    } as CSSStyleDeclaration);

    this.statsEl = document.createElement("div");
    this.logEl = document.createElement("div");
    Object.assign(this.logEl.style, {
      marginTop: "8px",
      paddingTop: "6px",
      borderTop: "1px solid #2b3340",
      color: "#aab4c0",
      whiteSpace: "pre",
    } as CSSStyleDeclaration);

    this.element.appendChild(title);
    this.element.appendChild(this.statsEl);
    this.element.appendChild(this.logEl);
    document.body.appendChild(this.element);
    this.redraw();
  }

  // 1回の射撃（複数ペレット可）の結果をまとめて反映。
  register(entries: Array<{ zone: FeedbackZone }>): void {
    for (const e of entries) {
      this.shots++;
      switch (e.zone) {
        case "head":
          this.head++;
          this.hits++;
          break;
        case "body":
          this.body++;
          this.hits++;
          break;
        case "graze":
          this.graze++;
          this.hits++;
          break;
        default:
          this.miss++;
      }
      this.pushLog(e.zone);
    }
    this.redraw();
  }

  private pushLog(zone: FeedbackZone): void {
    const tag =
      zone === "head" ? "HEAD  +10" : zone === "body" ? "BODY  +5" : zone === "graze" ? "GRAZE +1" : "MISS";
    this.log.unshift(tag);
    if (this.log.length > 8) this.log.pop();
  }

  private redraw(): void {
    const acc = this.shots > 0 ? Math.round((this.hits / this.shots) * 100) : 0;
    const row = (k: string, v: string | number, col?: string): string =>
      `<div style="display:flex;justify-content:space-between">` +
      `<span>${k}</span><span style="color:${col ?? "#e6edf3"}">${v}</span></div>`;
    this.statsEl.innerHTML =
      row("Shots", this.shots) +
      row("Hits", this.hits) +
      row("Accuracy", `${acc}%`, acc >= 70 ? "#5fd36a" : acc >= 40 ? "#ffce5a" : "#ff5a4d") +
      row("Head", this.head, "#ff3b30") +
      row("Body", this.body, "#4ad6a0") +
      row("Graze", this.graze, "#ffce5a") +
      row("Miss", this.miss, "#9aa0a6");
    this.logEl.textContent = this.log.length ? this.log.join("\n") : "—";
  }

  reset(): void {
    this.shots = this.hits = this.head = this.body = this.graze = this.miss = 0;
    this.log = [];
    this.redraw();
  }

  show(): void {
    this.element.style.display = "block";
  }
  hide(): void {
    this.element.style.display = "none";
  }
  dispose(): void {
    this.element.remove();
  }
}
