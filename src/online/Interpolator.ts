import { Vec3 } from "./netTypes";

// 1サンプル（受信した状態＋ローカル受信時刻）。
interface Snapshot {
  t: number; // ローカル受信時刻（performance.now()）
  pos: Vec3;
  yaw: number;
  pitch: number;
}

// 他プレイヤーの受信状態をタイムスタンプ付きで貯め、少し過去の時刻で線形補間して
// 滑らかな座標を返す。ネットワークのカクツキ（到着間隔のばらつき）を吸収する。
export class Interpolator {
  private buf: Snapshot[] = [];
  private readonly maxLen = 8;

  // 受信のたびに呼ぶ。
  push(pos: Vec3, yaw: number, pitch: number): void {
    this.buf.push({ t: performance.now(), pos: { ...pos }, yaw, pitch });
    while (this.buf.length > this.maxLen) this.buf.shift();
  }

  // renderDelay（ms）だけ過去の時刻の補間結果を返す。データが無ければ null。
  sample(renderDelay: number): Snapshot | null {
    if (this.buf.length === 0) return null;
    const target = performance.now() - renderDelay;

    // target を挟む2サンプルを探して線形補間
    for (let i = this.buf.length - 1; i > 0; i--) {
      const a = this.buf[i - 1];
      const b = this.buf[i];
      if (a.t <= target && target <= b.t) {
        const span = b.t - a.t;
        const f = span > 0 ? (target - a.t) / span : 0;
        return {
          t: target,
          pos: {
            x: lerp(a.pos.x, b.pos.x, f),
            y: lerp(a.pos.y, b.pos.y, f),
            z: lerp(a.pos.z, b.pos.z, f),
          },
          yaw: lerpAngle(a.yaw, b.yaw, f),
          pitch: lerp(a.pitch, b.pitch, f),
        };
      }
    }

    // target がバッファ範囲外なら端のサンプルを返す（古すぎ/新しすぎ）。
    if (target <= this.buf[0].t) return this.buf[0];
    return this.buf[this.buf.length - 1];
  }

  clear(): void {
    this.buf = [];
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// 角度の最短経路で補間する（±πをまたぐカクツキを防ぐ）。
function lerpAngle(a: number, b: number, f: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}
