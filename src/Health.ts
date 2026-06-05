// プレイヤーの体力を管理する部品です。
// 画面下に体力バーを表示し、ダメージで減り、0になると死亡と判定します。
// 戦闘系モード（ウェーブ・サバイバル、ボット・デスマッチ）が使います。

export class Health {
  private max: number;
  private current: number;
  private root: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;

  constructor(max = 100) {
    this.max = max;
    this.current = max;

    this.injectStyle();
    this.root = document.createElement("div");
    this.root.id = "health-bar";
    this.root.style.display = "none";

    const track = document.createElement("div");
    track.className = "health-track";
    this.bar = document.createElement("div");
    this.bar.className = "health-fill";
    track.appendChild(this.bar);

    this.label = document.createElement("div");
    this.label.className = "health-label";

    this.root.appendChild(this.label);
    this.root.appendChild(track);
    document.body.appendChild(this.root);
    this.update();
  }

  // モード開始時に満タンへ戻す（最大値も指定できる）
  reset(max?: number): void {
    if (typeof max === "number") this.max = max;
    this.current = this.max;
    this.update();
  }

  damage(amount: number): void {
    this.current = Math.max(0, this.current - amount);
    this.update();
  }

  heal(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
    this.update();
  }

  isDead(): boolean {
    return this.current <= 0;
  }

  getCurrent(): number {
    return this.current;
  }

  getMax(): number {
    return this.max;
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  // バーの幅・数値・色を現在値に合わせて更新する
  private update(): void {
    const ratio = this.max > 0 ? this.current / this.max : 0;
    this.bar.style.width = `${Math.round(ratio * 100)}%`;
    this.label.textContent = `HP ${Math.round(this.current)} / ${this.max}`;
    // 残量に応じて緑→黄→赤へ
    let color = "#46d36a";
    if (ratio <= 0.3) color = "#e7503a";
    else if (ratio <= 0.6) color = "#e7b53a";
    this.bar.style.background = color;
  }

  private injectStyle(): void {
    if (document.getElementById("health-style")) return;
    const style = document.createElement("style");
    style.id = "health-style";
    style.textContent = `
      #health-bar {
        position: fixed;
        left: 50%;
        bottom: 64px;
        transform: translateX(-50%);
        width: 280px;
        max-width: 60vw;
        z-index: 45;
        display: none;
        pointer-events: none;
        font-family: system-ui, sans-serif;
      }
      #health-bar .health-label {
        color: #ffe6b0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        margin-bottom: 4px;
        text-align: center;
      }
      #health-bar .health-track {
        width: 100%;
        height: 12px;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 220, 150, 0.4);
        border-radius: 6px;
        overflow: hidden;
      }
      #health-bar .health-fill {
        height: 100%;
        width: 100%;
        background: #46d36a;
        transition: width 0.12s linear, background 0.2s linear;
      }
    `;
    document.head.appendChild(style);
  }
}
