// 共通で使う型と定数をまとめたファイルです。

// 姿勢の種類
export enum Stance {
  Stand = "STAND",
  Crouch = "CROUCH",
  Prone = "PRONE",
  Slide = "SLIDE",
}

// 武器の種類
export enum WeaponKind {
  Assault = "ASSAULT",
  Sniper = "SNIPER",
  Shotgun = "SHOTGUN",
  Smg = "SMG",
}

// 1フレーム分の入力状態のスナップショット
export interface InputState {
  // 移動の入力（前後・左右を -1〜1 で表す）
  forward: number;
  right: number;
  // ボタン系（押されているか）
  sprint: boolean;
  crouch: boolean;
  jumpPressed: boolean; // 「押した瞬間」だけ true
  pronePressed: boolean; // 伏せトグルの押した瞬間
  firing: boolean; // 左クリック保持
  aiming: boolean; // 右クリック保持（ADS）
  reloadPressed: boolean;
  switchTo: WeaponKind | null; // 数字キーで武器切替
  kickPressed: boolean; // 蹴り（押した瞬間）
  knifePressed: boolean; // ナイフ斬り（押した瞬間）
  fragHeld: boolean; // フラグ投擲ボタン保持（長押しで軌道プレビュー）
  fragReleased: boolean; // フラグ投擲ボタンを離した瞬間（投擲）
  flashThrow: boolean; // フラッシュバン投擲（押した瞬間）
  interactHeld: boolean; // インタラクト（Eキー）長押し中。コープの蘇生に使う。
  scoreboardHeld: boolean; // スコアボード表示（TABキー）長押し中。TDMで使う。
  // 視点（マウス移動の累積から計算した向き）
  yaw: number;
  pitch: number;
}

// 武器ごとの性能パラメータ
export interface WeaponSpec {
  kind: WeaponKind;
  displayName: string;
  magSize: number; // マガジン弾数
  reserveMax: number; // 予備弾の上限
  fireInterval: number; // 連射間隔（秒）
  automatic: boolean; // フルオート可否
  damage: number;
  reloadTime: number; // リロード秒数
  hipSpread: number; // 腰だめの拡散（ラジアン相当の係数）
  adsSpread: number; // ADS時の拡散
  recoilKick: number; // 1発の縦反動（ラジアン）
  adsFov: number; // ADS時の視野角（小さいほど拡大）
  scope: boolean; // 専用スコープ表示を出すか（スナイパー）
  pellets?: number; // 1回の射撃で飛ぶ弾数（ショットガン用。未指定は1）
}
