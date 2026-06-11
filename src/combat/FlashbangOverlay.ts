// フラッシュバンのホワイトアウトを制御するクラスです。
// 画面全面の白いDOM（#flashWhite）の不透明度を、被曝量に応じて上げ、時間で戻します。
export class FlashbangOverlay {
  private el: HTMLElement | null;
  private flashAmt = 0; // 現在の白の濃さ（0〜1）
  private flashHold = 0; // 完全な白を維持する残り時間（秒）

  constructor() {
    this.el = document.getElementById("flashWhite");
  }

  // 被曝量 amt（0〜1）を与える。現在より強いときだけ更新し、維持時間も設定する。
  trigger(amt: number): void {
    if (amt > this.flashAmt) {
      this.flashAmt = amt;
      this.flashHold = 0.25 * amt; // 強く食らうほど完全な白の維持が長い
    }
  }

  // 毎フレーム呼ぶ。維持時間中は白を保ち、その後は約1.4秒かけて視界を戻す。
  update(dt: number): void {
    if (this.flashHold > 0) {
      this.flashHold -= dt;
    } else if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt / 1.4);
    }
    if (this.el) this.el.style.opacity = String(this.flashAmt);
  }

  // リスポーン時などに即座に視界を戻す。
  reset(): void {
    this.flashAmt = 0;
    this.flashHold = 0;
    if (this.el) this.el.style.opacity = "0";
  }
}
