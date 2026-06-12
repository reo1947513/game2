// ホーム画面（SKYFRAMEロビー）。
// 起動後の最初の画面で、シングルプレイのモード選択・オンライン入口・各種情報を表示する。
// 既存の Game 側の処理（beginMode / openLobby）を呼ぶだけの「見た目＋配線」レイヤーで、
// online/ や RoomLobbyUI には一切手を加えない。CSSは #home-screen 配下にスコープして注入する。

export interface HomeMode {
  id: string;
  label: string;
  description: string;
}
export interface HomeStage {
  id: string;
  label: string;
}
export interface HomeDiff {
  id: string;
  label: string;
}
export interface HomeOptions {
  modes: HomeMode[];
  onPlay: (id: string) => void;
  onOnline: () => void;
  stages: HomeStage[];
  selectedStage: string;
  onStage: (id: string) => void;
  difficulties: HomeDiff[];
  selectedDifficulty: string;
  onDifficulty: (id: string) => void;
}

// モードidに対応するアイコン（24x24・線画）。未知のidには汎用アイコンを返す。
function modeIcon(id: string): string {
  const map: Record<string, string> = {
    rush: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    moving:
      '<circle cx="12" cy="12" r="5"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3M5 5l2 2M17 17l2 2"/>',
    parkour:
      '<circle cx="15" cy="5" r="2"/><path d="M13 8l-3 4 3 2 1 5M10 12l-4 1M14 14l4 3"/>',
    wave: '<circle cx="9" cy="9" r="4"/><path d="M5 13c0 3 8 3 8 0M3 19c2-3 16-3 18 0"/>',
    keepmoving:
      '<circle cx="14" cy="5" r="2"/><path d="M12 8l-2 5 3 2 1 6M10 13l-5 2M13 15l5 1"/>',
    botdm:
      '<rect x="6" y="8" width="12" height="10" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M4 12v3M20 12v3"/>',
    gauntlet:
      '<path d="M4 18l5-12 3 7 3-7 5 12"/><path d="M4 18h16"/>',
  };
  return map[id] || '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>';
}

// オンライン項目の固定アイコン。
const ONLINE_ICONS: Record<string, string> = {
  casual:
    '<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 19c0-2 2-4 4-4s3 1 3.5 2"/>',
  ranked:
    '<path d="M7 4h10v4a5 5 0 0 1-10 0V4zM5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3M10 16h4v4h-4zM8 21h8"/>',
  private:
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  coop: '<path d="M8 13l3 3 5-6M5 20c0-3 2-5 4-5M19 20c0-3-2-5-4-5"/><circle cx="9" cy="6" r="2.5"/><circle cx="15" cy="6" r="2.5"/>',
};

const ONLINE_ROWS = [
  {
    key: "casual",
    label: "カジュアルマッチ",
    desc: "気軽に対戦。腕慣らしや実験に。",
  },
  { key: "ranked", label: "ランクマッチ", desc: "ランクを賭けた真剣勝負。" },
  {
    key: "private",
    label: "プライベートルーム",
    desc: "ルームコードで仲間内と対戦。",
  },
  {
    key: "coop",
    label: "協力／チームバトル",
    desc: "チームを組んで共闘する。",
  },
];

const STYLE = `
#home-screen {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  font-family: "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif;
  color: #e8eaed;
  background:
    radial-gradient(120% 90% at 50% -10%, rgba(40,46,54,0.55), rgba(0,0,0,0) 60%),
    linear-gradient(180deg, #0b0d10 0%, #0e1116 45%, #090a0d 100%);
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
}
#home-screen.hidden { display: none; }
/* 背景の質感（うっすらしたグリッドとビネット） */
#home-screen::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 64px),
    repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 64px),
    radial-gradient(80% 60% at 70% 20%, rgba(255,176,60,0.06), transparent 70%);
  pointer-events: none;
}
#home-screen::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);
  pointer-events: none;
}
#home-screen .hs-inner {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: clamp(10px, 2vh, 22px) clamp(14px, 3vw, 40px);
  gap: clamp(10px, 1.6vh, 18px);
  min-height: 0;
}

/* ===== 上部バー ===== */
#home-screen .hs-top {
  display: flex;
  align-items: center;
  gap: 18px;
}
#home-screen .hs-brand { display: flex; align-items: center; gap: 12px; }
#home-screen .hs-mark {
  width: 30px; height: 30px;
  border: 2px solid #ffb83c;
  transform: rotate(45deg);
  position: relative;
  box-shadow: 0 0 14px rgba(255,176,60,0.4);
}
#home-screen .hs-mark::after {
  content: ""; position: absolute; inset: 5px;
  background: linear-gradient(135deg, #ffd27a, #ff9a2e);
}
#home-screen .hs-brand-text { line-height: 1; }
#home-screen .hs-title {
  font-size: clamp(16px, 2.4vw, 26px);
  font-weight: 800;
  letter-spacing: 4px;
  color: #f4f6f8;
}
#home-screen .hs-tagline {
  font-size: 9px; letter-spacing: 3px; color: #8a93a0; margin-top: 4px;
}
#home-screen .hs-nav {
  display: flex; gap: 6px; margin-left: 10px;
}
#home-screen .hs-tab {
  padding: 8px 16px;
  font-size: 13px; font-weight: 600; letter-spacing: 1px;
  color: #9aa3af;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
#home-screen .hs-tab:hover { color: #e8eaed; background: rgba(255,255,255,0.05); }
#home-screen .hs-tab.active {
  color: #1a1206;
  background: linear-gradient(180deg, #ffd27a, #f5a623);
  box-shadow: 0 4px 14px rgba(245,166,35,0.35);
}
#home-screen .hs-spacer { flex: 1; }
#home-screen .hs-profile {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 14px;
  background: rgba(20,24,30,0.7);
  border: 1px solid rgba(255,176,60,0.25);
  border-radius: 10px;
}
#home-screen .hs-rank {
  width: 30px; height: 30px; flex: none;
  display: grid; place-items: center;
  border: 1px solid #ffb83c; border-radius: 7px;
  color: #ffb83c; font-weight: 800; font-size: 13px;
  background: rgba(255,176,60,0.08);
}
#home-screen .hs-prof-text { line-height: 1.2; }
#home-screen .hs-prof-name { font-size: 13px; font-weight: 700; letter-spacing: 1px; }
#home-screen .hs-prof-lv { font-size: 10px; color: #9aa3af; margin-top: 2px; }
#home-screen .hs-xp {
  width: 130px; height: 6px; margin-top: 5px;
  background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;
}
#home-screen .hs-xp > i {
  display: block; height: 100%; width: 60%;
  background: linear-gradient(90deg, #ffd27a, #f5a623);
}
#home-screen .hs-icons { display: flex; gap: 8px; }
#home-screen .hs-icon {
  width: 36px; height: 36px;
  display: grid; place-items: center;
  background: rgba(20,24,30,0.7);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 9px; color: #aeb6c0; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
#home-screen .hs-icon:hover { color: #ffb83c; border-color: rgba(255,176,60,0.4); }
#home-screen .hs-icon svg { width: 18px; height: 18px; }

/* ===== 中央2パネル ===== */
#home-screen .hs-main {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(12px, 2vw, 22px);
}
#home-screen .hs-panel {
  position: relative;
  display: flex; flex-direction: column;
  min-height: 0;
  padding: clamp(14px, 2vh, 22px);
  background:
    linear-gradient(180deg, rgba(22,26,32,0.92), rgba(12,14,18,0.92));
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px;
  overflow: hidden;
}
#home-screen .hs-panel.solo { border-top: 2px solid #f5a623; }
#home-screen .hs-panel.online { border-top: 2px solid #4a90e2; }
#home-screen .hs-panel-head { margin-bottom: 12px; }
#home-screen .hs-panel-title {
  font-size: clamp(20px, 2.6vw, 30px); font-weight: 800; letter-spacing: 2px;
}
#home-screen .hs-panel.solo .hs-panel-title { color: #ffce7a; }
#home-screen .hs-panel.online .hs-panel-title { color: #8bb8f0; }
#home-screen .hs-panel-sub { font-size: 12px; color: #8a93a0; margin-top: 5px; }
#home-screen .hs-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
  padding-right: 4px;
}
#home-screen .hs-list::-webkit-scrollbar { width: 6px; }
#home-screen .hs-list::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12); border-radius: 3px;
}
#home-screen .hs-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 13px;
  background: rgba(255,255,255,0.03);
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
#home-screen .hs-row:hover { background: rgba(255,255,255,0.07); }
#home-screen .hs-row .hs-row-ico {
  width: 34px; height: 34px; flex: none;
  display: grid; place-items: center;
  border-radius: 8px;
  background: rgba(255,255,255,0.05);
  color: #c7ced6;
}
#home-screen .hs-row .hs-row-ico svg { width: 20px; height: 20px; }
#home-screen .hs-row-text { min-width: 0; flex: 1; }
#home-screen .hs-row-label { font-size: 14px; font-weight: 700; }
#home-screen .hs-row-desc {
  font-size: 11px; color: #8a93a0; margin-top: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#home-screen .hs-row-chev { color: #6b7480; flex: none; }
#home-screen .hs-panel.solo .hs-row.sel {
  background: rgba(245,166,35,0.12);
  border-left-color: #f5a623;
}
#home-screen .hs-panel.solo .hs-row.sel .hs-row-ico { color: #ffce7a; }
#home-screen .hs-panel.online .hs-row:hover { border-left-color: #4a90e2; }

/* ステージ・難易度の小さなセレクタ（パネル下部） */
#home-screen .hs-selectors {
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.07);
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
}
#home-screen .hs-sel-group { display: flex; align-items: center; gap: 6px; }
#home-screen .hs-sel-label { font-size: 10px; letter-spacing: 1px; color: #8a93a0; }
#home-screen .hs-chip {
  padding: 5px 11px; font-size: 11px; font-weight: 600;
  color: #aeb6c0; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 7px; cursor: pointer;
}
#home-screen .hs-chip.active {
  color: #1a1206; background: linear-gradient(180deg,#ffd27a,#f5a623); border-color: transparent;
}

/* ===== 下部バー ===== */
#home-screen .hs-bottom {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: clamp(10px, 2vw, 24px);
}
#home-screen .hs-bcard {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: rgba(20,24,30,0.6);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
}
#home-screen .hs-bcard.right { justify-content: flex-end; }
#home-screen .hs-bcard small { font-size: 10px; color: #8a93a0; letter-spacing: 1px; }
#home-screen .hs-bcard b { font-size: 13px; font-weight: 700; }
#home-screen .hs-ghost {
  padding: 8px 14px; font-size: 12px; font-weight: 600;
  color: #ffce7a; background: rgba(255,176,60,0.1);
  border: 1px solid rgba(255,176,60,0.35); border-radius: 8px; cursor: pointer;
}
#home-screen .hs-ghost:hover { background: rgba(255,176,60,0.18); }
#home-screen .hs-play {
  padding: 16px 48px;
  font-size: clamp(18px, 2.4vw, 26px); font-weight: 900; letter-spacing: 3px;
  color: #1a1206;
  background: linear-gradient(180deg, #ffd884, #f5a623);
  border: none; border-radius: 12px; cursor: pointer;
  box-shadow: 0 8px 26px rgba(245,166,35,0.4), inset 0 1px 0 rgba(255,255,255,0.5);
  position: relative;
  transition: transform 0.08s, box-shadow 0.15s;
}
#home-screen .hs-play:hover { box-shadow: 0 10px 32px rgba(245,166,35,0.55), inset 0 1px 0 rgba(255,255,255,0.6); }
#home-screen .hs-play:active { transform: translateY(2px); }
#home-screen .hs-play small {
  display: block; font-size: 10px; letter-spacing: 2px; font-weight: 700;
  color: rgba(26,18,6,0.7); margin-top: 4px;
}

@media (max-width: 760px) {
  #home-screen .hs-nav, #home-screen .hs-prof-lv, #home-screen .hs-xp { display: none; }
  #home-screen .hs-main { grid-template-columns: 1fr; overflow-y: auto; }
  #home-screen .hs-bottom { grid-template-columns: 1fr; }
  #home-screen .hs-bcard, #home-screen .hs-bcard.right { display: none; }
}
`;

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

function svgWrap(inner: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</svg>"
  );
}

export class HomeScreen {
  private root: HTMLElement;
  private opts: HomeOptions | null = null;
  private selectedModeId = "";

  constructor() {
    if (!document.getElementById("home-screen-style")) {
      const style = document.createElement("style");
      style.id = "home-screen-style";
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.root = document.createElement("div");
    this.root.id = "home-screen";
    this.root.className = "hidden";
    document.body.appendChild(this.root);
  }

  show(opts: HomeOptions): void {
    this.opts = opts;
    if (
      !this.selectedModeId ||
      !opts.modes.some((m) => m.id === this.selectedModeId)
    ) {
      this.selectedModeId = opts.modes.length ? opts.modes[0].id : "";
    }
    this.render();
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  private render(): void {
    const o = this.opts;
    if (!o) return;

    const navTabs = ["ホーム", "武器庫", "カスタマイズ", "実績", "ストア"]
      .map(
        (t, i) =>
          `<button class="hs-tab${i === 0 ? " active" : ""}">${t}</button>`
      )
      .join("");

    const soloRows = o.modes
      .map(
        (m) =>
          `<button class="hs-row${m.id === this.selectedModeId ? " sel" : ""}" data-mode="${m.id}">
            <span class="hs-row-ico">${svgWrap(modeIcon(m.id))}</span>
            <span class="hs-row-text">
              <span class="hs-row-label">${m.label}</span>
              <span class="hs-row-desc">${m.description}</span>
            </span>
            <span class="hs-row-chev">${CHEVRON}</span>
          </button>`
      )
      .join("");

    const onlineRows = ONLINE_ROWS.map(
      (r) =>
        `<button class="hs-row" data-online="${r.key}">
          <span class="hs-row-ico">${svgWrap(ONLINE_ICONS[r.key])}</span>
          <span class="hs-row-text">
            <span class="hs-row-label">${r.label}</span>
            <span class="hs-row-desc">${r.desc}</span>
          </span>
          <span class="hs-row-chev">${CHEVRON}</span>
        </button>`
    ).join("");

    const stageChips = o.stages
      .map(
        (s) =>
          `<button class="hs-chip${s.id === o.selectedStage ? " active" : ""}" data-stage="${s.id}">${s.label}</button>`
      )
      .join("");
    const diffChips = o.difficulties
      .map(
        (d) =>
          `<button class="hs-chip${d.id === o.selectedDifficulty ? " active" : ""}" data-diff="${d.id}">${d.label}</button>`
      )
      .join("");

    this.root.innerHTML = `
      <div class="hs-inner">
        <div class="hs-top">
          <div class="hs-brand">
            <div class="hs-mark"></div>
            <div class="hs-brand-text">
              <div class="hs-title">SKYFRAME</div>
              <div class="hs-tagline">PRECISION · SPEED · VICTORY</div>
            </div>
          </div>
          <div class="hs-nav">${navTabs}</div>
          <div class="hs-spacer"></div>
          <div class="hs-profile">
            <div class="hs-rank">A</div>
            <div class="hs-prof-text">
              <div class="hs-prof-name">STRIKER_01</div>
              <div class="hs-prof-lv">Lv. 24</div>
              <div class="hs-xp"><i></i></div>
            </div>
          </div>
          <div class="hs-icons">
            <button class="hs-icon" title="フレンド">${svgWrap(ONLINE_ICONS.casual)}</button>
            <button class="hs-icon" title="メール">${svgWrap('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M4 7l8 6 8-6"/>')}</button>
            <button class="hs-icon" data-settings="1" title="設定">${svgWrap('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>')}</button>
          </div>
        </div>

        <div class="hs-main">
          <div class="hs-panel solo">
            <div class="hs-panel-head">
              <div class="hs-panel-title">ひとりで遊ぶ</div>
              <div class="hs-panel-sub">自分のペースで練習し、限界を超える。</div>
            </div>
            <div class="hs-list" id="hs-solo-list">${soloRows}</div>
            <div class="hs-selectors">
              <div class="hs-sel-group">
                <span class="hs-sel-label">ステージ</span>${stageChips}
              </div>
              <div class="hs-sel-group">
                <span class="hs-sel-label">難易度</span>${diffChips}
              </div>
            </div>
          </div>

          <div class="hs-panel online">
            <div class="hs-panel-head">
              <div class="hs-panel-title">オンライン</div>
              <div class="hs-panel-sub">世界中のプレイヤーと競い合い、頂点を目指せ。</div>
            </div>
            <div class="hs-list">${onlineRows}</div>
          </div>
        </div>

        <div class="hs-bottom">
          <div class="hs-bcard">
            <div>
              <small>デイリーチャレンジ</small>
              <b>3 / 5 達成</b>
            </div>
            <button class="hs-ghost" data-noop="1">報酬を受け取る</button>
          </div>
          <button class="hs-play" id="hs-play">プレイ<small>ゲームを開始する</small></button>
          <div class="hs-bcard right">
            <div style="text-align:right">
              <small>最新情報</small>
              <b>シーズン3 開幕</b>
            </div>
            <button class="hs-ghost" data-noop="1">トレーニングモード</button>
          </div>
        </div>
      </div>
    `;

    this.bind();
  }

  private bind(): void {
    const o = this.opts;
    if (!o) return;

    // シングルモードの選択
    this.root.querySelectorAll<HTMLElement>("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.mode || "";
        this.selectedModeId = id;
        this.root
          .querySelectorAll<HTMLElement>(".hs-panel.solo .hs-row")
          .forEach((r) => r.classList.toggle("sel", r === el));
      });
    });

    // プレイボタン → 選択中モードを開始
    const play = this.root.querySelector<HTMLElement>("#hs-play");
    play?.addEventListener("click", () => {
      if (this.selectedModeId) o.onPlay(this.selectedModeId);
    });

    // オンライン項目 → 既存ロビーを開く
    this.root.querySelectorAll<HTMLElement>("[data-online]").forEach((el) => {
      el.addEventListener("click", () => o.onOnline());
    });

    // ステージ選択
    this.root.querySelectorAll<HTMLElement>("[data-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.stage || "";
        o.onStage(id);
        this.root
          .querySelectorAll<HTMLElement>("[data-stage]")
          .forEach((c) => c.classList.toggle("active", c === el));
      });
    });

    // 難易度選択
    this.root.querySelectorAll<HTMLElement>("[data-diff]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.diff || "";
        o.onDifficulty(id);
        this.root
          .querySelectorAll<HTMLElement>("[data-diff]")
          .forEach((c) => c.classList.toggle("active", c === el));
      });
    });
  }
}
