// TOWER モードのボス戦用HUD。画面下部中央に「BOSS」ラベル付きの大きなHPバーを出します。
// 残量に応じて緑→黄→赤に変化させます。DOM＋CSSで構成し、z-index は FloorHUD と同系列。
export class BossHUD {
  private root: HTMLElement;
  private labelEl: HTMLElement;
  private barOuter: HTMLElement;
  private fillEl: HTMLElement;
  private numEl: HTMLElement;
  private visible = false;

  constructor() {
    BossHUD.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "boss-hud";
    this.root.style.display = "none";

    this.labelEl = document.createElement("div");
    this.labelEl.id = "bh-label";
    this.root.appendChild(this.labelEl);

    this.barOuter = document.createElement("div");
    this.barOuter.id = "bh-bar";
    this.fillEl = document.createElement("div");
    this.fillEl.id = "bh-fill";
    this.barOuter.appendChild(this.fillEl);
    this.root.appendChild(this.barOuter);

    this.numEl = document.createElement("div");
    this.numEl.id = "bh-num";
    this.root.appendChild(this.numEl);

    document.body.appendChild(this.root);
  }

  // ボス戦の開始。ラベルを設定して表示する。
  show(label: string): void {
    this.labelEl.textContent = `BOSS  ${label}`;
    this.root.style.display = "block";
    this.visible = true;
  }

  // 残HPを反映する。
  setHp(current: number, max: number): void {
    const cur = Math.max(0, Math.ceil(current));
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.fillEl.style.width = `${ratio * 100}%`;
    const col =
      ratio > 0.5 ? "#46d36a" : ratio > 0.25 ? "#ffd23a" : "#ff4040";
    this.fillEl.style.background = col;
    this.numEl.textContent = `${cur} / ${max}`;
  }

  hide(): void {
    if (!this.visible) return;
    this.root.style.display = "none";
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.root.remove();
  }

  private static styleInjected = false;
  private static injectStyle(): void {
    if (BossHUD.styleInjected) return;
    BossHUD.styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      #boss-hud {
        position: fixed;
        left: 50%;
        bottom: 84px;
        transform: translateX(-50%);
        width: min(620px, 72vw);
        pointer-events: none;
        z-index: 121;
        font-family: system-ui, -apple-system, sans-serif;
        text-align: center;
      }
      #bh-label {
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 0.12em;
        color: #ffffff;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
        margin-bottom: 6px;
      }
      #bh-bar {
        position: relative;
        width: 100%;
        height: 20px;
        background: #15171c;
        border: 2px solid rgba(255, 255, 255, 0.55);
        border-radius: 4px;
        overflow: hidden;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
      }
      #bh-fill {
        height: 100%;
        width: 100%;
        background: #46d36a;
        transition: width 0.15s linear, background 0.2s linear;
      }
      #bh-num {
        margin-top: 4px;
        font-size: 14px;
        font-weight: 800;
        color: #ffe6c7;
        text-shadow: 0 2px 5px rgba(0, 0, 0, 0.8);
      }
    `;
    document.head.appendChild(s);
  }
}
