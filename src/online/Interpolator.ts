import { Vec3 } from "./netTypes";

// 1サンプル（受信した状態＋サーバー時刻）。
interface Snapshot {
  t: number; // サーバー時刻（WorldState.timestamp。サーバーの Date.now()）
  pos: Vec3;
  yaw: number;
  pitch: number;
}

// sample() が返す補間結果。
export interface InterpSample {
  t: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
}

// 他プレイヤーの受信状態をサーバー時刻つきで貯め、少し過去の時刻で線形補間して
// 滑らかな座標を返す。ネットワークの到着間隔のばらつき（ジッタ）を吸収する。
//
// 時間軸は「サーバー時刻」を基準にする。サーバーは一定間隔（50ms）で WorldState を
// 生成し、その生成時刻 timestamp を載せてくる。これをスナップショットの時刻に使うと、
// ローカル到着のばらつきに影響されない一定ペースの再生になる（到着時刻でスタンプすると、
// 到着が詰まった/空いた区間で補間が伸び縮みし、速度ムラ＝カクツキになる）。
//
// サーバー時刻とローカル時刻（performance.now()）のオフセットは、最初の受信時に一度だけ
// （ローカル受信時刻 − サーバー時刻）を記録して固定する。毎フレーム測り直すと、その測定自体が
// ジッタを拾って時間軸を揺らすため、あえて一度きりにする。
export class Interpolator {
  private buf: Snapshot[] = [];
  private readonly maxLen = 8;

  // サーバー時刻 → ローカル時刻のオフセット（ローカル受信時刻 − サーバー時刻）。
  // 最初の push で一度だけ確定する。null の間は未確定。
  private clockOffset: number | null = null;

  // バッファ枯渇時に外挿してよい上限（ms）。これを超えた分は進めず、その位置で静止する。
  private readonly maxExtrapolateMs = 120;

  // 受信のたびに呼ぶ。serverTime は WorldState.timestamp（サーバーの Date.now()）。
  push(pos: Vec3, yaw: number, pitch: number, serverTime: number): void {
    // 最初の受信で時刻オフセットを確定（以後は固定）。
    if (this.clockOffset === null) {
      this.clockOffset = performance.now() - serverTime;
    }
    this.buf.push({ t: serverTime, pos: { ...pos }, yaw, pitch });
    while (this.buf.length > this.maxLen) this.buf.shift();
  }

  // renderDelay（ms）だけ過去のサーバー時刻における補間結果を返す。データが無ければ null。
  sample(renderDelay: number): InterpSample | null {
    if (this.buf.length === 0 || this.clockOffset === null) return null;

    // 現在のサーバー時刻の推定 = ローカル現在時刻 − オフセット。その renderDelay 前を描く。
    const target = performance.now() - this.clockOffset - renderDelay;

    // target を挟む2サンプルを探して線形補間する（通常経路）。
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

    const first = this.buf[0];
    const last = this.buf[this.buf.length - 1];

    // target が最古サンプルより前：まだ十分なバッファが無い等。最古位置で静止。
    if (target <= first.t) {
      return { t: first.t, pos: { ...first.pos }, yaw: first.yaw, pitch: first.pitch };
    }

    // target が最新サンプルより後＝バッファ枯渇。直近2点の速度で短時間だけ外挿する。
    // 角度は外挿せず最新値を保持（暴れ防止）。経過は maxExtrapolateMs でクランプし、
    // それを超えたら外挿位置で静止させる（次の受信までの空白を埋める）。
    if (this.buf.length >= 2) {
      const prev = this.buf[this.buf.length - 2];
      const span = last.t - prev.t;
      const ahead = Math.min(target - last.t, this.maxExtrapolateMs);
      if (span > 0 && ahead > 0) {
        const vx = (last.pos.x - prev.pos.x) / span;
        const vy = (last.pos.y - prev.pos.y) / span;
        const vz = (last.pos.z - prev.pos.z) / span;
        return {
          t: last.t + ahead,
          pos: {
            x: last.pos.x + vx * ahead,
            y: last.pos.y + vy * ahead,
            z: last.pos.z + vz * ahead,
          },
          yaw: last.yaw,
          pitch: last.pitch,
        };
      }
    }

    // 外挿不能（サンプルが1点だけ等）：最新位置で静止。
    return { t: last.t, pos: { ...last.pos }, yaw: last.yaw, pitch: last.pitch };
  }

  clear(): void {
    this.buf = [];
    this.clockOffset = null;
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
