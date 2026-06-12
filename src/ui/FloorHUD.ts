// TOWER モード専用のHUD。既存HUD（HP・弾薬・キルフィード）に重ねて、
// 画面上部にフロア数・残り敵・スコア・タイマーを、中央に演出テキストを出します。
// 100層クリア時の白フェードもここで扱います。すべてDOM＋CSSで構成し、
// z-index は既存HUDより上（mode-hud と同じ系列）に置きます。
export class FloorHUD {
  private root: HTMLElement;
  private floorEl: HTMLElement;
  private remainEl: HTMLElement;
  private scoreEl: HTMLElement;
  private timerEl: HTMLElement;
  private centerEl: HTMLElement;
  private fadeEl: HTMLElement;

  constructor() {
    FloorHUD.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "floor-hud";

    this.floorEl = document.createElement("div");
    this.floorEl.id = "fh-floor";
    this.root.appendChild(this.floorEl);

    this.remainEl = document.createElement("div");
    this.remainEl.id = "fh-remain";
    this.root.appendChild(this.remainEl);

    this.scoreEl = document.createElement("div");
    this.scoreEl.id = "fh-score";
    this.root.appendChild(this.scoreEl);

    this.timerEl = document.createElement("div");
    this.timerEl.id = "fh-timer";
    this.root.appendChild(this.timerEl);

    this.centerEl = document.createElement("div");
    this.centerEl.id = "fh-center";
    this.root.appendChild(this.centerEl);

    this.fadeEl = document.createElement("div");
    this.fadeEl.id = "fh-fade";
    this.root.appendChild(this.fadeEl);

    document.body.appendChild(this.root);
  }

  // 上部の主要情報を一括更新する。
  setHeader(floor: number, maxFloor: number, remaining: number, score: number): void {
    this.floorEl.textContent = `Floor ${floor} / ${maxFloor}`;
    this.remainEl.textContent = `残り敵: ${remaining}`;
    this.scoreEl.textContent = `スコア: ${score}`;
  }

  // 経過タイマー（空文字で非表示）。
  setTimer(text: string): void {
    this.timerEl.textContent = text;
    this.timerEl.style.display = text ? "block" : "none";
  }

  // 中央の大きな演出テキスト（カウントダウン・FLOOR CLEARED・休憩など）。
  setCenter(text: string, color = "#ffffff"): void {
    this.centerEl.textContent = text;
    this.centerEl.style.color = color;
    this.centerEl.style.opacity = "1";
  }

  clearCenter(): void {
    this.centerEl.style.opacity = "0";
  }

  // 100層クリアの白フェード。opacity を 1 へ遷移させる（CSS transition）。
  showClearFade(): void {
    this.fadeEl.style.transition = "opacity 1.1s ease-in";
    // 次フレームで遷移を確実に発火させる。
    window.requestAnimationFrame(() => {
      this.fadeEl.style.opacity = "1";
    });
  }

  dispose(): void {
    this.root.remove();
  }

  private static styleInjected = false;
  private static injectStyle(): void {
    if (FloorHUD.styleInjected) return;
    FloorHUD.styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      #floor-hud {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 121;
        font-family: system-ui, -apple-system, sans-serif;
      }
      #fh-floor {
        position: absolute;
        left: 18px;
        top: 16px;
        font-size: 20px;
        font-weight: 800;
        color: #ffffff;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
        letter-spacing: 0.03em;
      }
      #fh-remain {
        position: absolute;
        left: 50%;
        top: 16px;
        transform: translateX(-50%);
        font-size: 20px;
        font-weight: 800;
        color: #ffe6c7;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
      }
      #fh-score {
        position: absolute;
        right: 18px;
        top: 16px;
        font-size: 20px;
        font-weight: 800;
        color: #ffd23a;
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
      }
      #fh-timer {
        position: absolute;
        right: 18px;
        top: 42px;
        font-size: 15px;
        font-weight: 700;
        color: #cfd6e0;
        text-shadow: 0 2px 5px rgba(0, 0, 0, 0.8);
      }
      #fh-center {
        position: absolute;
        left: 50%;
        top: 40%;
        transform: translate(-50%, -50%);
        font-size: 56px;
        font-weight: 900;
        letter-spacing: 0.06em;
        text-align: center;
        text-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);
        opacity: 0;
        transition: opacity 0.12s linear;
      }
      #fh-fade {
        position: fixed;
        inset: 0;
        background: #ffffff;
        opacity: 0;
        pointer-events: none;
      }
    `;
    document.head.appendChild(s);
  }
}
