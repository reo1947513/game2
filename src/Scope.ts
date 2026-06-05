// スナイパーの覗き込み時に表示する、円形のスコープ枠です。
// 中央は見えたまま、周りを円形の縁と黒いふちで囲み、細い十字を重ねます。
// 銃モデルは別途隠してあるので、これは画面の演出だけを受け持ちます。

export class Scope {
  private root: HTMLElement;

  constructor() {
    this.injectStyle();
    this.root = document.createElement("div");
    this.root.id = "scope-overlay";
    this.root.style.display = "none";

    const vignette = document.createElement("div");
    vignette.className = "scope-vignette";

    const ring = document.createElement("div");
    ring.className = "scope-ring";

    const hLine = document.createElement("div");
    hLine.className = "scope-line scope-line-h";
    const vLine = document.createElement("div");
    vLine.className = "scope-line scope-line-v";

    this.root.appendChild(vignette);
    this.root.appendChild(ring);
    this.root.appendChild(hLine);
    this.root.appendChild(vLine);
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private injectStyle(): void {
    if (document.getElementById("scope-style")) return;
    const style = document.createElement("style");
    style.id = "scope-style";
    style.textContent = `
      #scope-overlay {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: none;
        pointer-events: none;
      }
      /* 中央は透明、外周を黒く落として円形に囲む */
      #scope-overlay .scope-vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          circle at 50% 50%,
          rgba(0, 0, 0, 0) 0,
          rgba(0, 0, 0, 0) 30vmin,
          rgba(0, 0, 0, 0.7) 33vmin,
          rgba(0, 0, 0, 0.97) 42vmin,
          #000 90vmin
        );
      }
      /* スコープの縁のリング */
      #scope-overlay .scope-ring {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 66vmin;
        height: 66vmin;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px solid rgba(255, 220, 150, 0.35);
        box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.55) inset;
      }
      /* 細い十字（目盛り代わり） */
      #scope-overlay .scope-line {
        position: absolute;
        left: 50%;
        top: 50%;
        background: rgba(255, 220, 150, 0.5);
      }
      #scope-overlay .scope-line-h {
        width: 60vmin;
        height: 1px;
        transform: translate(-50%, -50%);
      }
      #scope-overlay .scope-line-v {
        width: 1px;
        height: 60vmin;
        transform: translate(-50%, -50%);
      }
    `;
    document.head.appendChild(style);
  }
}
