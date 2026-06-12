// 被弾時に画面の淵を赤く光らせるダメージビネットを制御するクラスです。
// 画面外周の赤いDOM（#dmgVignette）の不透明度を、被弾量に応じて上げ、時間で戻します。
// 仕組みは FlashbangOverlay（白のホワイトアウト）と同型です。
export class DamageVignette {
  private el: HTMLElement | null;
  private amt = 0; // 現在の赤の濃さ（0〜1）
  private hold = 0; // 濃さを維持する残り時間（秒）

  constructor() {
    this.el = document.getElementById("dmgVignette");
  }

  // 被弾の強さ strength（0〜1）を与える。現在より強いときだけ濃さを更新し、維持時間も設ける。
  trigger(strength: number): void {
    const s = Math.max(0, Math.min(1, strength));
    if (s > this.amt) this.amt = s;
    // 強く食らうほど、はっきり見える完全な濃さを少し長く保つ。
    this.hold = Math.max(this.hold, 0.08 + 0.12 * s);
  }

  // 毎フレーム呼ぶ。維持時間中は濃さを保ち、その後は約0.6秒かけて赤を引く。
  update(dt: number): void {
    if (this.hold > 0) {
      this.hold -= dt;
    } else if (this.amt > 0) {
      this.amt = Math.max(0, this.amt - dt / 0.6);
    }
    if (this.el) this.el.style.opacity = String(this.amt);
  }

  // リスポーン時などに即座に赤を消す。
  reset(): void {
    this.amt = 0;
    this.hold = 0;
    if (this.el) this.el.style.opacity = "0";
  }
}
