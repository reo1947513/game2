import { FeedbackZone } from "./HitFeedback";

interface Dot {
  dx: number; // 的中心からの水平オフセット（m）
  dy: number; // 的中心からの垂直オフセット（m）
  zone: FeedbackZone;
}

const ZONE_DOT: Record<FeedbackZone, string> = {
  head: "#ff3b30",
  body: "#4ad6a0",
  graze: "#ffce5a",
  miss: "#6b7280",
};

// SHOOTING GALLERY の2D着弾分布（DEV RANGE専用）。
// 的中心を原点に、直近の命中点を点で重ねて集弾（まとまり）を可視化する。画面右下。
export class ImpactPattern {
  readonly element: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private dots: Dot[] = [];

  private readonly size = 168;
  private readonly maxDots = 60;
  private readonly scaleM = 1.0; // 中心から半径1.0m を枠いっぱいに描く

  constructor() {
    this.element = document.createElement("canvas");
    this.element.width = this.size;
    this.element.height = this.size;
    Object.assign(this.element.style, {
      position: "fixed",
      bottom: "12px",
      right: "12px",
      background: "rgba(12,14,18,0.82)",
      border: "1px solid #2b3340",
      borderRadius: "8px",
      zIndex: "40",
      pointerEvents: "none",
      display: "none",
    } as CSSStyleDeclaration);
    this.g = this.element.getContext("2d")!;
    document.body.appendChild(this.element);
    this.redraw();
  }

  add(dx: number, dy: number, zone: FeedbackZone): void {
    this.dots.push({ dx, dy, zone });
    if (this.dots.length > this.maxDots) this.dots.shift();
    this.redraw();
  }

  private redraw(): void {
    const g = this.g;
    const s = this.size;
    const c = s / 2;
    g.clearRect(0, 0, s, s);

    // 背景・グリッド
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "#2b3340";
    g.lineWidth = 1;
    // 同心円（0.25 / 0.55 / 0.9 m 相当）
    for (const r of [0.25, 0.55, 0.9]) {
      g.beginPath();
      g.arc(c, c, (r / this.scaleM) * c, 0, Math.PI * 2);
      g.stroke();
    }
    // 十字
    g.beginPath();
    g.moveTo(c, 6);
    g.lineTo(c, s - 6);
    g.moveTo(6, c);
    g.lineTo(s - 6, c);
    g.stroke();

    // 点
    for (const d of this.dots) {
      const px = c + (d.dx / this.scaleM) * c;
      const py = c - (d.dy / this.scaleM) * c; // 上を+yに
      g.fillStyle = ZONE_DOT[d.zone];
      g.beginPath();
      g.arc(px, py, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // 見出し
    g.fillStyle = "#aab4c0";
    g.font = "10px ui-monospace, Menlo, monospace";
    g.textBaseline = "top";
    g.fillText("PATTERN", 6, 5);
  }

  clear(): void {
    this.dots = [];
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
