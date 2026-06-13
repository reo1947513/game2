import * as THREE from "three";
import { WeaponKind, WeaponSpec } from "../../types";
import { DevApp, DevPanel } from "../devTypes";
import { loadWeaponModel } from "../WeaponModels";

// WEAPON タブ：武器の切替と、選択中武器のパラメータを即時編集する。
// 編集はセッション中のみ有効（リロードで戻る）。「JSONコピー」で本番貼り付け用に書き出せる。

interface FieldDef {
  key: keyof WeaponSpec;
  label: string;
  min: number;
  max: number;
  step: number;
}

// 実際の WeaponSpec フィールドに忠実なもの（rpm は fireInterval から別途算出して表示する）。
const FIELDS: FieldDef[] = [
  { key: "damage", label: "ダメージ", min: 1, max: 300, step: 1 },
  { key: "magSize", label: "マガジン弾数", min: 1, max: 100, step: 1 },
  { key: "reserveMax", label: "予備弾の上限", min: 0, max: 600, step: 1 },
  { key: "reloadTime", label: "リロード(秒)", min: 0.3, max: 5, step: 0.1 },
  { key: "hipSpread", label: "腰だめ拡散", min: 0, max: 0.2, step: 0.001 },
  { key: "adsSpread", label: "ADS拡散", min: 0, max: 0.1, step: 0.0002 },
  { key: "recoilKick", label: "縦反動", min: 0, max: 0.2, step: 0.001 },
  { key: "adsFov", label: "ADS視野角", min: 10, max: 75, step: 1 },
  { key: "pellets", label: "弾数(ペレット)", min: 1, max: 16, step: 1 },
];

const ORDER: WeaponKind[] = [
  WeaponKind.Assault,
  WeaponKind.Sniper,
  WeaponKind.Shotgun,
  WeaponKind.Smg,
];

export class WeaponPanel implements DevPanel {
  element: HTMLElement;
  private defaults = new Map<WeaponKind, WeaponSpec>();
  private lastKind: WeaponKind | null = null;
  // 実モデル試着で装着中のモデル（武器種ごと）
  private vmModels = new Map<WeaponKind, THREE.Group>();

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    for (const k of ORDER) this.defaults.set(k, { ...app.ctx.weapons.devSpec(k) });
  }

  // 数字キーなどで武器が切り替わったら作り直す。
  update(): void {
    if (this.app.ctx.weapons.devCurrentKind() !== this.lastKind) this.render();
  }

  onShow(): void {
    this.render();
  }

  private render(): void {
    const weapons = this.app.ctx.weapons;
    const kind = weapons.devCurrentKind();
    this.lastKind = kind;
    const spec = weapons.devSpec(kind);

    this.element.innerHTML = "";

    // 武器切替ボタン
    const switcher = document.createElement("div");
    switcher.className = "dr-stages";
    for (const k of ORDER) {
      const b = document.createElement("button");
      b.className = "dr-btn" + (k === kind ? " on" : "");
      b.textContent = this.defaults.get(k)!.displayName;
      b.onclick = () => this.app.ctx.input.queueSwitch(k);
      switcher.appendChild(b);
    }
    this.element.appendChild(switcher);

    const cur = document.createElement("div");
    cur.className = "dr-cur";
    cur.textContent = `編集中: ${spec.displayName}（ヘッドショットは命中時2倍を自動適用）`;
    this.element.appendChild(cur);

    const grid = document.createElement("div");
    grid.className = "dr-grid";
    grid.appendChild(this.rpmRow(spec)); // RPM（fireInterval へ変換）
    for (const def of FIELDS) grid.appendChild(this.fieldRow(spec, def));
    this.element.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "dr-actions";

    const chkWrap = document.createElement("label");
    chkWrap.className = "dr-chk";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = spec.automatic;
    chk.onchange = () => {
      spec.automatic = chk.checked;
    };
    chkWrap.appendChild(chk);
    chkWrap.appendChild(document.createTextNode("フルオート"));
    actions.appendChild(chkWrap);

    actions.appendChild(this.btn("弾を補充", () => weapons.addAmmo(9999)));
    actions.appendChild(
      this.btn("この武器をリセット", () => {
        this.resetSpec(kind);
        this.render();
      })
    );
    actions.appendChild(
      this.btn("全武器リセット", () => {
        for (const k of ORDER) this.resetSpec(k);
        this.render();
      })
    );
    const copy = this.btn("パラメータをJSONコピー", () => {
      const json = JSON.stringify(spec, null, 2);
      void navigator.clipboard.writeText(json).then(() => {
        copy.textContent = "コピーしました";
        window.setTimeout(() => (copy.textContent = "パラメータをJSONコピー"), 1200);
      });
    });
    actions.appendChild(copy);

    this.element.appendChild(actions);

    // 実モデル試着（テスト環境）
    this.element.appendChild(this.buildViewmodel(kind));
  }

  // 実モデル試着：手元の武器を取込モデルへ差し替えて見る（テスト環境のみ）。
  private buildViewmodel(kind: WeaponKind): HTMLElement {
    const wrap = document.createElement("div");
    const head = document.createElement("div");
    head.className = "dr-cur";
    head.style.marginTop = "10px";
    head.textContent = "実モデル試着（テスト環境・手元表示）";
    wrap.appendChild(head);

    const model = this.vmModels.get(kind) ?? null;
    const actions = document.createElement("div");
    actions.className = "dr-actions";
    const toggle = this.btn(model ? "実モデルを解除（箱に戻す）" : "実モデルを装着", () => {
      if (this.vmModels.has(kind)) {
        this.app.ctx.weapons.devSetViewmodel(kind, null);
        this.vmModels.delete(kind);
        this.render();
        return;
      }
      toggle.textContent = "読込中…";
      void loadWeaponModel(kind).then((m) => {
        if (!m) {
          toggle.textContent = "モデルを読み込めません";
          return;
        }
        m.position.set(0, -0.05, -0.25);
        m.userData.baseScale = m.scale.x;
        this.app.ctx.weapons.devSetViewmodel(kind, m);
        this.vmModels.set(kind, m);
        this.render();
      });
    });
    actions.appendChild(toggle);
    wrap.appendChild(actions);

    if (model) {
      const base = (model.userData.baseScale as number) || model.scale.x || 1;
      const grid = document.createElement("div");
      grid.className = "dr-grid";
      grid.appendChild(this.vmSlider("位置X", -0.6, 0.6, 0.01, model.position.x, (v) => (model.position.x = v)));
      grid.appendChild(this.vmSlider("位置Y", -0.6, 0.6, 0.01, model.position.y, (v) => (model.position.y = v)));
      grid.appendChild(this.vmSlider("位置Z", -1.0, 0.3, 0.01, model.position.z, (v) => (model.position.z = v)));
      grid.appendChild(
        this.vmSlider("スケール", 0.2, 3, 0.05, model.scale.x / base, (v) => model.scale.setScalar(base * v))
      );
      grid.appendChild(this.vmSlider("回転X", -3.14, 3.14, 0.02, model.rotation.x, (v) => (model.rotation.x = v)));
      grid.appendChild(this.vmSlider("回転Y", -3.14, 3.14, 0.02, model.rotation.y, (v) => (model.rotation.y = v)));
      grid.appendChild(this.vmSlider("回転Z", -3.14, 3.14, 0.02, model.rotation.z, (v) => (model.rotation.z = v)));
      wrap.appendChild(grid);

      const hint = document.createElement("div");
      hint.className = "dr-info";
      hint.textContent = "スライダーで手元の位置・向き・大きさを合わせられます（セッション内のみ）。";
      wrap.appendChild(hint);
    }
    return wrap;
  }

  // ラベル＋スライダー＋数値（汎用、変更をコールバックで反映）。
  private vmSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "dr-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    const num = document.createElement("input");
    num.type = "number";
    num.min = String(min);
    num.max = String(max);
    num.step = String(step);
    num.value = String(value);
    const apply = (raw: number, from: "range" | "num"): void => {
      if (!isFinite(raw)) return;
      const v = Math.max(min, Math.min(max, raw));
      onChange(v);
      if (from !== "range") range.value = String(v);
      if (from !== "num") num.value = String(v);
    };
    range.oninput = () => apply(parseFloat(range.value), "range");
    num.oninput = () => apply(parseFloat(num.value), "num");
    row.appendChild(lab);
    row.appendChild(range);
    row.appendChild(num);
    return row;
  }

  // RPM 行：rpm = round(60 / fireInterval)。編集で fireInterval = 60 / rpm を書き戻す。
  private rpmRow(spec: WeaponSpec): HTMLElement {
    const row = document.createElement("div");
    row.className = "dr-row";
    const label = document.createElement("label");
    label.textContent = "連射 RPM";
    const toRpm = (fi: number): number => Math.round(60 / fi);

    const range = document.createElement("input");
    range.type = "range";
    range.min = "40";
    range.max = "1200";
    range.step = "10";
    range.value = String(toRpm(spec.fireInterval));

    const num = document.createElement("input");
    num.type = "number";
    num.min = "40";
    num.max = "1200";
    num.step = "10";
    num.value = String(toRpm(spec.fireInterval));

    const apply = (rpm: number, from: "range" | "num"): void => {
      if (!isFinite(rpm) || rpm <= 0) return;
      rpm = Math.max(40, Math.min(1200, Math.round(rpm)));
      spec.fireInterval = 60 / rpm;
      if (from !== "range") range.value = String(rpm);
      if (from !== "num") num.value = String(rpm);
    };
    range.oninput = () => apply(parseFloat(range.value), "range");
    num.oninput = () => apply(parseFloat(num.value), "num");

    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(num);
    return row;
  }

  private fieldRow(spec: WeaponSpec, def: FieldDef): HTMLElement {
    const row = document.createElement("div");
    row.className = "dr-row";
    const label = document.createElement("label");
    label.textContent = def.label;

    const bag = spec as unknown as Record<string, number>;
    const initial = bag[def.key] ?? (def.key === "pellets" ? 1 : 0);
    const isInt = def.step >= 1;

    const range = document.createElement("input");
    range.type = "range";
    range.min = String(def.min);
    range.max = String(def.max);
    range.step = String(def.step);
    range.value = String(initial);

    const num = document.createElement("input");
    num.type = "number";
    num.min = String(def.min);
    num.max = String(def.max);
    num.step = String(def.step);
    num.value = String(initial);

    const apply = (raw: number, from: "range" | "num"): void => {
      let v = raw;
      if (!isFinite(v)) return;
      v = Math.max(def.min, Math.min(def.max, v));
      if (isInt) v = Math.round(v);
      bag[def.key] = v;
      if (from !== "range") range.value = String(v);
      if (from !== "num") num.value = String(v);
    };
    range.oninput = () => apply(parseFloat(range.value), "range");
    num.oninput = () => apply(parseFloat(num.value), "num");

    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(num);
    return row;
  }

  // DEV RANGE 終了時：全武器スペックを既定へ復帰し、実モデル試着も解除して箱モデルへ戻す。
  resetAll(): void {
    for (const k of ORDER) this.resetSpec(k);
    for (const k of this.vmModels.keys()) this.app.ctx.weapons.devSetViewmodel(k, null);
    this.vmModels.clear();
  }

  private resetSpec(kind: WeaponKind): void {
    const def = this.defaults.get(kind);
    if (!def) return;
    Object.assign(this.app.ctx.weapons.devSpec(kind), def);
  }

  private btn(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "dr-btn";
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }
}
