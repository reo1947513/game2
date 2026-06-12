// プレイヤーの体力を管理する部品です。
// 画面下に体力バーを表示し、ダメージで減り、0になると死亡と判定します。
// 戦闘系モード（ウェーブ・サバイバル、ボット・デスマッチ）が使います。

export class Health {
  private max: number;
  private current: number;
  private root: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;
  // 無敵モード（DEV RANGE 用）。既定 false で通常挙動。true の間 damage() を無効化する。
  private invincible = false;
  // 被弾通知。実際にHPが減ったときに「失ったHP量」を渡して呼ぶ（赤ビネット演出用）。
  private onDamageCb: ((lost: number) => void) | null = null;

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
    if (this.invincible) return; // DEV RANGE 無敵モード中はダメージを無効化
    const before = this.current;
    this.current = Math.max(0, this.current - amount);
    const lost = before - this.current;
    if (lost > 0 && this.onDamageCb) this.onDamageCb(lost); // 赤ビネット等へ被弾を通知
    this.update();
  }

  // 無敵モードの切替（DEV RANGE 用）。
  setInvincible(on: boolean): void {
    this.invincible = on;
  }

  // 被弾時のコールバックを登録する（失ったHP量を渡す。赤ビネット演出などに使う）。
  onDamage(cb: (lost: number) => void): void {
    this.onDamageCb = cb;
  }

  heal(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
    this.update();
  }

  // 現在値を直接セットする（オンラインのサーバー権威HPを反映する用）。
  set(value: number): void {
    const before = this.current;
    this.current = Math.max(0, Math.min(this.max, value));
    const lost = before - this.current;
    if (lost > 0 && this.onDamageCb) this.onDamageCb(lost); // オンライン被弾を赤ビネット等へ通知
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
