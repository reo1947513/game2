// 新モード（GAUNTLET RUN / KEEP MOVING）専用のHUD要素を管理するヘルパーです。
// 既存HUD（HP・弾薬・キルフィード）に重ねて、タイマー・残敵/wave・速度警告の赤パルス・
// 中央のカウントダウン/演出を出します。z-index は既存HUDより上に設定します。
// 赤いパルスは Canvas や追加メッシュを使わず、固定 inset の box-shadow（CSS）だけで表現します。
export class ModeHUD {
  private root: HTMLElement;
  private timerEl: HTMLElement;
  private infoEl: HTMLElement;
  private centerEl: HTMLElement;
  private pulseEl: HTMLElement;

  constructor() {
    ModeHUD.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "mode-hud";

    this.timerEl = document.createElement("div");
    this.timerEl.id = "mh-timer";
    this.root.appendChild(this.timerEl);

    this.infoEl = document.createElement("div");
    this.infoEl.id = "mh-info";
    this.root.appendChild(this.infoEl);

    this.centerEl = document.createElement("div");
    this.centerEl.id = "mh-center";
    this.root.appendChild(this.centerEl);

    this.pulseEl = document.createElement("div");
    this.pulseEl.id = "mh-pulse";
    this.root.appendChild(this.pulseEl);

    document.body.appendChild(this.root);
  }

  // 右上のタイマー文字列をセットする（空文字で非表示）。
  setTimer(text: string): void {
    this.timerEl.textContent = text;
    this.timerEl.style.display = text ? "block" : "none";
  }

  // 左上の情報（残敵・wave・スコアなど）を行で表示する。
  setInfo(lines: string[]): void {
    this.infoEl.innerHTML = "";
    for (const l of lines) {
      const row = document.createElement("div");
      row.textContent = l;
      this.infoEl.appendChild(row);
    }
  }

  // 中央の大きな演出テキスト（カウントダウン・GO・NEW BEST など）。
  setCenter(text: string, color = "#ffffff"): void {
    this.centerEl.textContent = text;
    this.centerEl.style.color = color;
    this.centerEl.style.opacity = "1";
  }

  clearCenter(): void {
    this.centerEl.style.opacity = "0";
  }

  // 速度警告パルス。0=なし / 1=警告（点滅）/ 2=危険（高速点滅・濃い）。
  setPulse(level: 0 | 1 | 2): void {
    this.pulseEl.classList.remove("warn", "danger");
    if (level === 1) this.pulseEl.classList.add("warn");
    else if (level === 2) this.pulseEl.classList.add("danger");
  }

  // ベスト更新のゴールドフラッシュ演出。
  flashBest(): void {
    this.setCenter("NEW BEST", "#ffd23a");
    this.root.classList.add("best-flash");
    window.setTimeout(() => this.root.classList.remove("best-flash"), 1200);
  }

  hide(): void {
    this.root.style.display = "none";
  }

  show(): void {
    this.root.style.display = "block";
  }

  // モード終了時にDOMを完全に取り除く（状態リーク防止）。
  dispose(): void {
    this.setPulse(0);
    this.root.remove();
  }

  private static styleInjected = false;
  private static injectStyle(): void {
    if (ModeHUD.styleInjected) return;
    ModeHUD.styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      #mode-hud {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 120;
        font-family: system-ui, -apple-system, sans-serif;
      }
      #mh-timer {
        position: absolute;
        right: 18px;
        top: 16px;
        font-size: 30px;
        font-weight: 800;
        color: #ffffff;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
        letter-spacing: 0.04em;
      }
      #mh-info {
        position: absolute;
        left: 18px;
        top: 16px;
        font-size: 16px;
        font-weight: 700;
        color: #ffe6c7;
        text-shadow: 0 2px 5px rgba(0, 0, 0, 0.8);
        line-height: 1.5;
      }
      #mh-center {
        position: absolute;
        left: 50%;
        top: 42%;
        transform: translate(-50%, -50%);
        font-size: 64px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);
        opacity: 0;
        transition: opacity 0.12s linear;
      }
      #mh-pulse {
        position: fixed;
        inset: 0;
        pointer-events: none;
        box-shadow: none;
      }
      #mh-pulse.warn {
        animation: mh-pulse-warn 0.9s ease-in-out infinite;
      }
      #mh-pulse.danger {
        animation: mh-pulse-danger 0.4s ease-in-out infinite;
      }
      @keyframes mh-pulse-warn {
        0%, 100% { box-shadow: inset 0 0 60px 8px rgba(255, 40, 30, 0.0); }
        50% { box-shadow: inset 0 0 100px 24px rgba(255, 40, 30, 0.42); }
      }
      @keyframes mh-pulse-danger {
        0%, 100% { box-shadow: inset 0 0 90px 18px rgba(255, 30, 20, 0.25); }
        50% { box-shadow: inset 0 0 150px 48px rgba(255, 30, 20, 0.7); }
      }
      #mode-hud.best-flash {
        animation: mh-best 1.2s ease-out;
      }
      @keyframes mh-best {
        0% { background: rgba(255, 210, 58, 0.0); }
        20% { background: rgba(255, 210, 58, 0.35); }
        100% { background: rgba(255, 210, 58, 0.0); }
      }
    `;
    document.head.appendChild(s);
  }
}
