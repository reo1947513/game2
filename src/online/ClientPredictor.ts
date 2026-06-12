import { Vec3 } from "./netTypes";

// クライアントサイド予測の土台。フェーズ2では移動を中継方式のまま据え置く（＝自分の座標は
// 自分が権威）ため、移動の再調整（Reconciliation）は行わず、主にシーケンス番号の発行と
// 未確認入力リングバッファの管理を担う。将来サーバー権威の移動を入れる際に reconcile() を
// 実働させられるよう、構造だけ用意してある。
export class ClientPredictor {
  private seq = 0;
  // 未確認入力（予測結果の座標つき）。最大128件のリングバッファ。
  private pending: Array<{ seq: number; pos: Vec3 }> = [];
  private readonly maxPending = 128;

  // 毎フレーム呼び、新しいシーケンス番号を発行する。
  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  // 予測した自分の座標を seq とともに記録する。
  record(seq: number, pos: Vec3): void {
    this.pending.push({ seq, pos: { ...pos } });
    while (this.pending.length > this.maxPending) this.pending.shift();
  }

  // サーバーの権威座標と照合し、ずれが0.3m以上なら補正後の座標を返す（null=補正不要）。
  // ※フェーズ2では移動がサーバー権威でないため、Game からは呼ばれない（将来用）。
  reconcile(authorityPos: Vec3, lastProcessedSeq: number): Vec3 | null {
    // 確認済みより古い入力は破棄
    this.pending = this.pending.filter((p) => p.seq > lastProcessedSeq);
    const predicted = this.pending.length > 0 ? this.pending[0].pos : authorityPos;
    const dx = predicted.x - authorityPos.x;
    const dy = predicted.y - authorityPos.y;
    const dz = predicted.z - authorityPos.z;
    const drift = Math.hypot(dx, dy, dz);
    if (drift >= 0.3) {
      // 権威座標へ補正（その後、未確認入力を再適用する想定）。
      return { ...authorityPos };
    }
    return null;
  }

  reset(): void {
    this.seq = 0;
    this.pending = [];
  }
}
