// ヘッドショットなどの通知を画面中央上に一瞬だけ出す部品です。
// モバイル対応で変化しうる HUD には手を入れず、独立して表示します。
export class Hitmarker {
  private root: HTMLElement;

  constructor() {
    this.injectStyle();
    this.root = document.createElement("div");
    this.root.id = "headshot-notice";
    document.body.appendChild(this.root);
  }

  // ヘッドショットの通知を出す
  headshot(): void {
    this.root.textContent = "HEADSHOT";
    // いったんアニメーションを止めてから付け直し、毎回最初から再生させる
    this.root.style.animation = "none";
    void this.root.offsetWidth;
    this.root.style.animation = "headshotPop 0.6s ease-out forwards";
  }

  private injectStyle(): void {
    if (document.getElementById("headshot-style")) return;
    const style = document.createElement("style");
    style.id = "headshot-style";
    style.textContent = `
      #headshot-notice {
        position: fixed;
        left: 50%;
        top: 38%;
        transform: translate(-50%, -50%);
        z-index: 46;
        pointer-events: none;
        opacity: 0;
        font-family: system-ui, sans-serif;
        font-weight: 800;
        font-size: 28px;
        letter-spacing: 0.12em;
        color: #ffb43a;
        text-shadow: 0 0 12px rgba(255, 120, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.9);
      }
      @keyframes headshotPop {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); }
        20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -52%) scale(0.95); }
      }
    `;
    document.head.appendChild(style);
  }
}
