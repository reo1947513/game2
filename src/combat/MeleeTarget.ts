import * as THREE from "three";

// 近接攻撃が当たる対象を、各ゲームモードが共通の形で公開するための入口です。
// モードごとに敵の持ち方（WaveEnemy / BotEntry など）は違いますが、近接システムは
// この最小限の窓口だけを見て、索敵・ダメージ・吹き飛ばしを行います。
export interface MeleeTarget {
  // 敵の足元中心のワールド座標（参照をそのまま渡してよい）。
  position: THREE.Vector3;
  // まだ生存しているか。
  isAlive(): boolean;
  // ダメージを与える。撃破に至れば true を返す。
  applyDamage(damage: number): boolean;
  // 水平方向の初速（m/s）でノックバックさせる。
  applyKnockback(vx: number, vz: number): void;
}

// 近接の対象一覧を提供できるゲームモードが実装するインターフェース。
// 敵のいないモードは provider を登録しないため、近接はモーションと音だけになります。
export interface MeleeTargetProvider {
  getMeleeTargets(): MeleeTarget[];
}
