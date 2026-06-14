import { WeaponSpec } from "../types";

// DEV RANGE 用：取込武器モデルに与える「性能の規定値」。ファイル名から銃種を推定して既定スペックを返す。
// 編集対象のフィールドのみ（kind/displayName/scope は除く）。
export type EditableSpec = Pick<
  WeaponSpec,
  | "damage"
  | "fireInterval"
  | "magSize"
  | "reserveMax"
  | "reloadTime"
  | "hipSpread"
  | "adsSpread"
  | "recoilKick"
  | "adsFov"
  | "automatic"
  | "pellets"
>;

type GunType = "ar" | "smg" | "sniper" | "shotgun" | "pistol" | "revolver" | "grenade" | "crossbow";

const LABELS: Record<GunType, string> = {
  ar: "アサルトライフル",
  smg: "サブマシンガン",
  sniper: "スナイパー",
  shotgun: "ショットガン",
  pistol: "ピストル",
  revolver: "リボルバー",
  grenade: "グレネード",
  crossbow: "クロスボウ",
};

// 60/rpm = fireInterval。各種の規定値。
const DEFAULTS: Record<GunType, EditableSpec> = {
  ar: { damage: 25, fireInterval: 0.1, magSize: 30, reserveMax: 240, reloadTime: 2.0, hipSpread: 0.045, adsSpread: 0.006, recoilKick: 0.012, adsFov: 55, automatic: true, pellets: 1 },
  smg: { damage: 18, fireInterval: 0.07, magSize: 30, reserveMax: 240, reloadTime: 1.8, hipSpread: 0.06, adsSpread: 0.01, recoilKick: 0.009, adsFov: 60, automatic: true, pellets: 1 },
  sniper: { damage: 90, fireInterval: 1.1, magSize: 5, reserveMax: 40, reloadTime: 2.8, hipSpread: 0.08, adsSpread: 0.0008, recoilKick: 0.05, adsFov: 25, automatic: false, pellets: 1 },
  shotgun: { damage: 12, fireInterval: 0.85, magSize: 6, reserveMax: 48, reloadTime: 1.0, hipSpread: 0.09, adsSpread: 0.045, recoilKick: 0.04, adsFov: 50, automatic: false, pellets: 8 },
  pistol: { damage: 28, fireInterval: 0.15, magSize: 12, reserveMax: 96, reloadTime: 1.3, hipSpread: 0.04, adsSpread: 0.01, recoilKick: 0.02, adsFov: 60, automatic: false, pellets: 1 },
  revolver: { damage: 50, fireInterval: 0.4, magSize: 6, reserveMax: 48, reloadTime: 2.0, hipSpread: 0.05, adsSpread: 0.012, recoilKick: 0.06, adsFov: 55, automatic: false, pellets: 1 },
  grenade: { damage: 80, fireInterval: 1.0, magSize: 1, reserveMax: 12, reloadTime: 2.5, hipSpread: 0.03, adsSpread: 0.02, recoilKick: 0.05, adsFov: 55, automatic: false, pellets: 1 },
  crossbow: { damage: 70, fireInterval: 1.2, magSize: 1, reserveMax: 20, reloadTime: 1.6, hipSpread: 0.02, adsSpread: 0.004, recoilKick: 0.03, adsFov: 45, automatic: false, pellets: 1 },
};

function gunType(name: string): GunType {
  const n = name.toLowerCase();
  if (/sniper|スナイパー/.test(n)) return "sniper";
  if (/shotgun|ショットガン/.test(n)) return "shotgun";
  if (/smg|submachine|サブマシンガン|p90/.test(n)) return "smg";
  if (/revolver|リボルバー/.test(n)) return "revolver";
  if (/pistol|ピストル|handgun/.test(n)) return "pistol";
  if (/grenade|グレネード/.test(n)) return "grenade";
  if (/crossbow|クロスボウ/.test(n)) return "crossbow";
  // 既定はアサルト（rifle/AR/bullpup/その他）
  return "ar";
}

export function defaultSpec(name: string): EditableSpec {
  return { ...DEFAULTS[gunType(name)] };
}

export function gunTypeLabel(name: string): string {
  return LABELS[gunType(name)];
}
