import {
  Input,
  KeyAction,
  ACTION_LABELS,
  keyLabel,
  SENS_MIN,
  SENS_MAX,
  SENS_PRESETS,
  ADS_SENS_MIN,
  ADS_SENS_MAX,
  ADS_SENS_PRESETS,
} from "../Input";
import { SoundSystem } from "../SoundSystem";

// 設定画面。マウス感度（5段階＋バー）、ADS感度（スコープ。5段階＋バー）、
// PCのキー再割り当て、初期化を提供する。ホーム画面とPCポーズメニューから開く。
// 外部CSSに依存しないようインラインスタイルで自己完結させる。
export class SettingsUI {
  private root: HTMLElement;
  private panel: HTMLElement;
  private onClose: (() => void) | null = null;
  private rebinding: KeyAction | null = null;
  private bindBtns = new Map<KeyAction, HTMLElement>();
  private sensSlider!: HTMLInputElement;
  private sensReadout!: HTMLElement;
  private adsSlider!: HTMLInputElement;
  private adsReadout!: HTMLElement;
  private sensPresetBtns: HTMLElement[] = [];
  private adsPresetBtns: HTMLElement[] = [];
  private volSlider!: HTMLInputElement;
  private volReadout!: HTMLElement;
  private sfxToggle!: HTMLElement;

  constructor(private input: Input, private sound: SoundSystem) {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:rgba(4,6,12,0.82);font-family:'Segoe UI',system-ui,sans-serif;";

    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "width:min(560px,92vw);max-height:88vh;overflow-y:auto;padding:24px 26px;border-radius:14px;background:linear-gradient(160deg,#0e1726,#0a1018);border:1px solid #24405e;color:#eaf3ff;box-shadow:0 24px 70px rgba(0,0,0,0.6);";
    this.root.appendChild(this.panel);

    this.build();
    document.body.appendChild(this.root);

    // パネル外クリックで閉じる
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  private build(): void {
    const h = document.createElement("div");
    h.textContent = "設定";
    h.style.cssText = "font-size:22px;font-weight:800;letter-spacing:2px;margin-bottom:18px;";
    this.panel.appendChild(h);

    // ===== マウス感度 =====
    this.panel.appendChild(this.sectionLabel("マウス感度"));
    {
      const r = this.buildSensRow(SENS_MIN, SENS_MAX, SENS_PRESETS, (v) =>
        this.input.setSensitivity(v)
      );
      this.sensSlider = r.slider;
      this.sensReadout = r.readout;
      this.sensPresetBtns = r.presetBtns;
      this.panel.appendChild(r.el);
    }

    // ===== ADS感度（スコープ） =====
    this.panel.appendChild(this.sectionLabel("ADS感度（スコープ覗き込み時）"));
    {
      const r = this.buildSensRow(ADS_SENS_MIN, ADS_SENS_MAX, ADS_SENS_PRESETS, (v) =>
        this.input.setAdsSensitivity(v)
      );
      this.adsSlider = r.slider;
      this.adsReadout = r.readout;
      this.adsPresetBtns = r.presetBtns;
      this.panel.appendChild(r.el);
    }

    // ===== サウンド =====
    this.panel.appendChild(this.sectionLabel("サウンド"));
    {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;";
      this.sfxToggle = document.createElement("button");
      this.sfxToggle.style.cssText =
        "padding:6px 14px;border-radius:7px;border:1px solid #2f4d6e;background:#13233a;color:#cfe0f5;font-size:13px;cursor:pointer;white-space:nowrap;";
      this.sfxToggle.onclick = () => {
        this.sound.setEnabled(!this.sound.isEnabled());
        this.refresh();
      };
      this.volSlider = document.createElement("input");
      this.volSlider.type = "range";
      this.volSlider.min = "0";
      this.volSlider.max = "1";
      this.volSlider.step = "0.02";
      this.volSlider.style.cssText = "flex:1;accent-color:#6aa8ff;";
      this.volSlider.addEventListener("input", () => {
        this.sound.setVolume(parseFloat(this.volSlider.value));
        this.refresh();
      });
      this.volReadout = document.createElement("div");
      this.volReadout.style.cssText = "min-width:46px;text-align:right;font-size:12px;color:#9fc8ff;";
      row.appendChild(this.sfxToggle);
      row.appendChild(this.volSlider);
      row.appendChild(this.volReadout);
      this.panel.appendChild(row);
    }

    // ===== キー割り当て =====
    this.panel.appendChild(this.sectionLabel("キー割り当て（クリックして変更）"));
    const list = document.createElement("div");
    list.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;margin-bottom:18px;";
    for (const action of Object.keys(ACTION_LABELS) as KeyAction[]) {
      const name = document.createElement("div");
      name.textContent = ACTION_LABELS[action];
      name.style.cssText = "font-size:13px;color:#cfe0f5;";
      const btn = document.createElement("button");
      btn.style.cssText =
        "min-width:84px;padding:6px 10px;border-radius:7px;border:1px solid #2f4d6e;background:#13233a;color:#eaf3ff;font-size:13px;cursor:pointer;";
      btn.onclick = () => this.startRebind(action);
      this.bindBtns.set(action, btn);
      list.appendChild(name);
      list.appendChild(btn);
    }
    this.panel.appendChild(list);

    // ===== 操作ボタン =====
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:space-between;gap:10px;margin-top:6px;";
    const reset = document.createElement("button");
    reset.textContent = "初期設定に戻す";
    reset.style.cssText =
      "padding:9px 16px;border-radius:8px;border:1px solid #6a3030;background:#2a1414;color:#ffd0d0;font-size:13px;cursor:pointer;";
    reset.onclick = () => {
      this.input.resetBindings();
      this.input.setSensitivity(0.0022);
      this.input.setAdsSensitivity(0.0013);
      this.sound.setEnabled(true);
      this.sound.setVolume(0.7);
      this.refresh();
    };
    const close = document.createElement("button");
    close.textContent = "閉じる";
    close.style.cssText =
      "padding:9px 22px;border-radius:8px;border:1px solid #6aa8ff;background:#16335a;color:#eaf3ff;font-size:14px;cursor:pointer;";
    close.onclick = () => this.close();
    actions.appendChild(reset);
    actions.appendChild(close);
    this.panel.appendChild(actions);
  }

  private sectionLabel(text: string): HTMLElement {
    const e = document.createElement("div");
    e.textContent = text;
    e.style.cssText =
      "font-size:12px;letter-spacing:1px;color:#7fb0e8;margin:14px 0 8px;border-bottom:1px solid #1c3148;padding-bottom:4px;";
    return e;
  }

  // 感度行（5段階ボタン＋バー＋数値）。get/set は対象の感度に応じて差し替える。
  private buildSensRow(
    min: number,
    max: number,
    presets: number[],
    set: (v: number) => void
  ): { el: HTMLElement; slider: HTMLInputElement; readout: HTMLElement; presetBtns: HTMLElement[] } {
    const el = document.createElement("div");
    el.style.cssText = "margin-bottom:6px;";

    // 5段階プリセット
    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px;";
    const presetBtns: HTMLElement[] = [];
    const names = ["最低", "低", "標準", "高", "最高"];
    presets.forEach((p, i) => {
      const b = document.createElement("button");
      b.textContent = names[i] ?? String(i + 1);
      b.style.cssText =
        "flex:1;padding:6px 0;border-radius:7px;border:1px solid #2f4d6e;background:#13233a;color:#cfe0f5;font-size:12px;cursor:pointer;";
      b.onclick = () => {
        set(p);
        this.refresh();
      };
      presetBtns.push(b);
      presetRow.appendChild(b);
    });
    el.appendChild(presetRow);

    // バー（連続）＋数値
    const barRow = document.createElement("div");
    barRow.style.cssText = "display:flex;align-items:center;gap:10px;";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String((max - min) / 200);
    slider.style.cssText = "flex:1;accent-color:#6aa8ff;";
    const readout = document.createElement("div");
    readout.style.cssText = "min-width:46px;text-align:right;font-size:12px;color:#9fc8ff;";
    slider.addEventListener("input", () => {
      set(parseFloat(slider.value));
      this.refresh();
    });
    barRow.appendChild(slider);
    barRow.appendChild(readout);
    el.appendChild(barRow);

    return { el, slider, readout, presetBtns };
  }

  private startRebind(action: KeyAction): void {
    if (this.rebinding) return;
    this.rebinding = action;
    const btn = this.bindBtns.get(action);
    if (btn) {
      btn.textContent = "キーを押す…";
      btn.style.borderColor = "#ffcc00";
    }
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener("keydown", onKey, true);
      this.rebinding = null;
      if (e.code !== "Escape") this.input.setBinding(action, e.code);
      this.refresh();
    };
    document.addEventListener("keydown", onKey, true);
  }

  // 現在値を画面へ反映する。
  private refresh(): void {
    // キー割り当て
    const bindings = this.input.getBindings();
    for (const [action, btn] of this.bindBtns) {
      btn.textContent = keyLabel(bindings[action]);
      btn.style.borderColor = "#2f4d6e";
    }
    // マウス感度
    const sv = this.input.getSensitivity();
    this.sensSlider.value = String(sv);
    this.sensReadout.textContent = sv.toFixed(4);
    this.highlightPresets(this.sensPresetBtns, SENS_PRESETS, sv);
    // ADS感度
    const av = this.input.getAdsSensitivity();
    this.adsSlider.value = String(av);
    this.adsReadout.textContent = av.toFixed(4);
    this.highlightPresets(this.adsPresetBtns, ADS_SENS_PRESETS, av);
    // サウンド
    const on = this.sound.isEnabled();
    this.sfxToggle.textContent = on ? "効果音 ON" : "効果音 OFF";
    this.sfxToggle.style.background = on ? "rgba(80,150,255,0.32)" : "#13233a";
    this.sfxToggle.style.borderColor = on ? "#6aa8ff" : "#2f4d6e";
    this.sfxToggle.style.color = on ? "#fff" : "#cfe0f5";
    this.volSlider.value = String(this.sound.getVolume());
    this.volReadout.textContent = Math.round(this.sound.getVolume() * 100) + "%";
  }

  // 現在値に最も近いプリセットを強調する。
  private highlightPresets(btns: HTMLElement[], presets: number[], value: number): void {
    let best = 0;
    let bestD = Infinity;
    presets.forEach((p, i) => {
      const d = Math.abs(p - value);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    btns.forEach((b, i) => {
      const on = i === best && bestD < (presets[presets.length - 1] - presets[0]) / 8;
      b.style.background = on ? "rgba(80,150,255,0.32)" : "#13233a";
      b.style.borderColor = on ? "#6aa8ff" : "#2f4d6e";
      b.style.color = on ? "#fff" : "#cfe0f5";
    });
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.refresh();
    this.root.style.display = "flex";
  }

  close(): void {
    if (this.rebinding) return; // リバインド待ち中は閉じない
    this.root.style.display = "none";
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }
}
