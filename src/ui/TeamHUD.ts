import { TDMShared, Team } from "../online/netTypes";

// チームデスマッチ専用のHUD。
// 画面上部中央にチームキル数とタイマー、右にチームカラー付きキルフィード、
// 死亡時にELIMINATED＋復活カウントダウン、終了時にリザルトを表示する。
export class TeamHUD {
  private root: HTMLElement;
  private redKills: HTMLElement;
  private blueKills: HTMLElement;
  private timer: HTMLElement;
  private redChip: HTMLElement;
  private blueChip: HTMLElement;
  private feed: HTMLElement;
  private elim: HTMLElement;
  private elimCount: HTMLElement;
  private result: HTMLElement;
  private resultInner: HTMLElement;
  private scoreboard: HTMLElement;
  private onClose: (() => void) | null = null;

  constructor() {
    this.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "tdm-hud";
    this.root.style.display = "none";

    // 上部スコアバー
    const bar = document.createElement("div");
    bar.className = "tdm-bar";
    this.redChip = document.createElement("div");
    this.redChip.className = "tdm-chip tdm-red";
    const redLabel = document.createElement("span");
    redLabel.className = "tdm-team-label";
    redLabel.textContent = "RED";
    this.redKills = document.createElement("span");
    this.redKills.className = "tdm-kills";
    this.redKills.textContent = "0";
    this.redChip.appendChild(redLabel);
    this.redChip.appendChild(this.redKills);

    this.timer = document.createElement("div");
    this.timer.className = "tdm-timer";
    this.timer.textContent = "00:00";

    this.blueChip = document.createElement("div");
    this.blueChip.className = "tdm-chip tdm-blue";
    this.blueKills = document.createElement("span");
    this.blueKills.className = "tdm-kills";
    this.blueKills.textContent = "0";
    const blueLabel = document.createElement("span");
    blueLabel.className = "tdm-team-label";
    blueLabel.textContent = "BLUE";
    this.blueChip.appendChild(this.blueKills);
    this.blueChip.appendChild(blueLabel);

    bar.appendChild(this.redChip);
    bar.appendChild(this.timer);
    bar.appendChild(this.blueChip);

    // キルフィード
    this.feed = document.createElement("div");
    this.feed.className = "tdm-feed";

    // ELIMINATED オーバーレイ
    this.elim = document.createElement("div");
    this.elim.className = "tdm-elim";
    this.elim.style.display = "none";
    const elimTitle = document.createElement("div");
    elimTitle.className = "tdm-elim-title";
    elimTitle.textContent = "ELIMINATED";
    this.elimCount = document.createElement("div");
    this.elimCount.className = "tdm-elim-count";
    this.elim.appendChild(elimTitle);
    this.elim.appendChild(this.elimCount);

    // リザルト
    this.result = document.createElement("div");
    this.result.className = "tdm-result";
    this.result.style.display = "none";
    this.resultInner = document.createElement("div");
    this.resultInner.className = "tdm-result-inner";
    this.result.appendChild(this.resultInner);

    // スコアボード（TAB長押し中に表示）
    this.scoreboard = document.createElement("div");
    this.scoreboard.className = "tdm-board";
    this.scoreboard.style.display = "none";

    this.root.appendChild(bar);
    this.root.appendChild(this.feed);
    this.root.appendChild(this.elim);
    this.root.appendChild(this.scoreboard);
    this.root.appendChild(this.result);
    document.body.appendChild(this.root);
  }

  // スコアボードのHTMLを組み立てる（withBreakdown でキル種別の内訳列を追加）。
  private buildBoard(
    tdm: TDMShared,
    selfId: string,
    nameOf: (id: string) => string,
    withBreakdown: boolean
  ): string {
    const rows = [...tdm.players].sort((a, b) => b.score - a.score);
    const head = withBreakdown
      ? `<tr><th>プレイヤー</th><th>K</th><th>D</th><th>A</th><th>高</th><th>近</th><th>グレ</th><th>連</th><th>SCORE</th></tr>`
      : `<tr><th>プレイヤー</th><th>K</th><th>D</th><th>A</th><th>SCORE</th></tr>`;
    const body = rows
      .map((p) => {
        const teamCls = p.team === "RED" ? "tdm-row-red" : "tdm-row-blue";
        const selfCls = p.playerId === selfId ? " tdm-row-self" : "";
        const name = this.escape(nameOf(p.playerId));
        const extra = withBreakdown
          ? `<td>${p.high}</td><td>${p.melee}</td><td>${p.grenade}</td><td>${p.streak}</td>`
          : "";
        return `<tr class="${teamCls}${selfCls}"><td class="tdm-cell-name">${name}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td>${extra}<td class="tdm-cell-score">${p.score}</td></tr>`;
      })
      .join("");
    return `<table class="tdm-board-table">${head}${body}</table>`;
  }

  private escape(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
    );
  }

  show(): void {
    this.root.style.display = "block";
    this.result.style.display = "none";
    this.elim.style.display = "none";
    this.feed.innerHTML = "";
  }

  hide(): void {
    this.root.style.display = "none";
    this.result.style.display = "none";
    this.elim.style.display = "none";
  }

  // 毎フレームのスコア・タイマー・死亡状態の更新。
  // scoreboardHeld が true（TAB長押し中）のときはスコアボードを表示する。
  update(
    tdm: TDMShared,
    selfId: string,
    nameOf: (id: string) => string,
    scoreboardHeld: boolean
  ): void {
    this.redKills.textContent = String(tdm.kills.RED);
    this.blueKills.textContent = String(tdm.kills.BLUE);
    this.timer.textContent = this.formatTime(tdm.timeRemaining);

    const myTeam = tdm.teams[selfId];
    this.redChip.classList.toggle("tdm-self", myTeam === "RED");
    this.blueChip.classList.toggle("tdm-self", myTeam === "BLUE");

    if (tdm.phase === "RESULT") {
      this.elim.style.display = "none";
      this.scoreboard.style.display = "none"; // リザルト側に内訳付きで出す
      return;
    }

    // TAB長押し中のスコアボード
    if (scoreboardHeld) {
      this.scoreboard.innerHTML = this.buildBoard(tdm, selfId, nameOf, false);
      this.scoreboard.style.display = "flex";
    } else {
      this.scoreboard.style.display = "none";
    }

    const rs = tdm.respawn[selfId] ?? 0;
    if (rs > 0) {
      this.elim.style.display = "flex";
      this.elimCount.textContent = `復活まで ${Math.ceil(rs)}`;
    } else {
      this.elim.style.display = "none";
    }
  }

  // キルフィードに1行追加する（チームカラー付き）。
  addKill(killerName: string, victimName: string, killerTeam: Team, note: string): void {
    const row = document.createElement("div");
    row.className = "tdm-feed-row";
    const k = document.createElement("span");
    k.className = killerTeam === "RED" ? "tdm-name-red" : "tdm-name-blue";
    k.textContent = killerName;
    const mid = document.createElement("span");
    mid.className = "tdm-feed-mid";
    mid.textContent = ` ${note} `;
    const v = document.createElement("span");
    v.className = "tdm-feed-victim";
    v.textContent = victimName;
    row.appendChild(k);
    row.appendChild(mid);
    row.appendChild(v);
    this.feed.appendChild(row);
    while (this.feed.childElementCount > 5) {
      const first = this.feed.firstElementChild;
      if (first) this.feed.removeChild(first);
      else break;
    }
    window.setTimeout(() => {
      if (row.parentElement === this.feed) this.feed.removeChild(row);
    }, 5000);
  }

  // 終了時のリザルト表示（スコアボード＋キル種別ボーナスの内訳付き）。
  showResult(tdm: TDMShared, selfId: string, nameOf: (id: string) => string, onClose: () => void): void {
    this.onClose = onClose;
    this.elim.style.display = "none";
    this.scoreboard.style.display = "none";
    const winner = tdm.winner ?? "DRAW";
    let title = "DRAW";
    let cls = "tdm-win-draw";
    if (winner === "RED") {
      title = "RED WINS";
      cls = "tdm-win-red";
    } else if (winner === "BLUE") {
      title = "BLUE WINS";
      cls = "tdm-win-blue";
    }
    const legend =
      "通常 100 ／ 高所 150 ／ 近接 200 ／ グレネード 180 ／ 連続キル +50 ／ アシスト 50";
    this.resultInner.innerHTML =
      `<div class="tdm-result-title ${cls}">${title}</div>` +
      `<div class="tdm-result-score">RED ${tdm.kills.RED}  —  ${tdm.kills.BLUE} BLUE</div>` +
      `<div class="tdm-board-wrap">${this.buildBoard(tdm, selfId, nameOf, true)}</div>` +
      `<div class="tdm-legend">${legend}</div>`;
    const btn = document.createElement("button");
    btn.className = "tdm-result-btn";
    btn.textContent = "ロビーに戻る";
    btn.onclick = () => {
      this.result.style.display = "none";
      this.onClose?.();
    };
    this.resultInner.appendChild(btn);
    this.result.style.display = "flex";
  }

  isResultOpen(): boolean {
    return this.result.style.display !== "none";
  }

  private formatTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  private injectStyle(): void {
    if (document.getElementById("tdm-hud-style")) return;
    const style = document.createElement("style");
    style.id = "tdm-hud-style";
    style.textContent = `
      #tdm-hud {
        position: fixed; inset: 0; z-index: 48; pointer-events: none;
        font-family: system-ui, sans-serif;
      }
      #tdm-hud .tdm-bar {
        position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
        display: flex; align-items: center; gap: 16px;
      }
      #tdm-hud .tdm-chip {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 14px; border-radius: 8px;
        background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.18);
        font-weight: 800; letter-spacing: 0.06em;
      }
      #tdm-hud .tdm-chip.tdm-self { box-shadow: 0 0 0 2px rgba(255,255,255,0.85) inset; }
      #tdm-hud .tdm-red .tdm-team-label { color: #ff6a55; }
      #tdm-hud .tdm-blue .tdm-team-label { color: #6aa0ff; }
      #tdm-hud .tdm-kills { color: #fff; font-size: 20px; min-width: 22px; text-align: center; }
      #tdm-hud .tdm-timer {
        color: #ffe6b0; font-size: 20px; font-weight: 800; letter-spacing: 0.08em;
        text-shadow: 0 1px 4px rgba(0,0,0,0.8); min-width: 70px; text-align: center;
      }
      #tdm-hud .tdm-feed {
        position: absolute; top: 64px; right: 18px;
        display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
      }
      #tdm-hud .tdm-feed-row {
        background: rgba(0,0,0,0.45); padding: 3px 9px; border-radius: 5px;
        font-size: 13px; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      }
      #tdm-hud .tdm-name-red { color: #ff6a55; }
      #tdm-hud .tdm-name-blue { color: #6aa0ff; }
      #tdm-hud .tdm-feed-mid { color: #ffd27a; }
      #tdm-hud .tdm-feed-victim { color: #e6e6e6; }
      #tdm-hud .tdm-elim {
        position: absolute; top: 38%; left: 50%; transform: translate(-50%,-50%);
        flex-direction: column; align-items: center; gap: 10px;
      }
      #tdm-hud .tdm-elim-title {
        color: #e7503a; font-size: 44px; font-weight: 900; letter-spacing: 0.1em;
        text-shadow: 0 2px 10px rgba(0,0,0,0.9);
      }
      #tdm-hud .tdm-elim-count {
        color: #fff; font-size: 18px; font-weight: 700;
        text-shadow: 0 1px 4px rgba(0,0,0,0.9);
      }
      #tdm-hud .tdm-result {
        position: absolute; inset: 0; background: rgba(0,0,0,0.72);
        align-items: center; justify-content: center; pointer-events: auto;
      }
      #tdm-hud .tdm-result-inner {
        display: flex; flex-direction: column; align-items: center; gap: 18px;
      }
      #tdm-hud .tdm-result-title { font-size: 56px; font-weight: 900; letter-spacing: 0.08em; }
      #tdm-hud .tdm-win-red { color: #ff6a55; }
      #tdm-hud .tdm-win-blue { color: #6aa0ff; }
      #tdm-hud .tdm-win-draw { color: #ffd27a; }
      #tdm-hud .tdm-result-score { color: #fff; font-size: 26px; font-weight: 800; letter-spacing: 0.06em; }
      #tdm-hud .tdm-result-btn {
        margin-top: 6px; padding: 12px 28px; font-size: 16px; font-weight: 800;
        color: #1a1a1a; background: #ffd27a; border: none; border-radius: 10px; cursor: pointer;
      }
      #tdm-hud .tdm-result-btn:hover { background: #ffdd97; }
      #tdm-hud .tdm-board {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        flex-direction: column; align-items: center;
        background: rgba(0,0,0,0.66); padding: 14px 18px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.18);
      }
      #tdm-hud .tdm-board-wrap { margin: 4px 0 2px; }
      #tdm-hud .tdm-board-table { border-collapse: collapse; color: #eee; font-size: 14px; }
      #tdm-hud .tdm-board-table th, #tdm-hud .tdm-board-table td {
        padding: 4px 10px; text-align: center; font-weight: 700;
      }
      #tdm-hud .tdm-board-table th { color: #ffd27a; font-size: 12px; letter-spacing: 0.05em; }
      #tdm-hud .tdm-board-table .tdm-cell-name { text-align: left; min-width: 90px; }
      #tdm-hud .tdm-board-table .tdm-cell-score { color: #ffe6b0; }
      #tdm-hud .tdm-board-table .tdm-row-red .tdm-cell-name { color: #ff6a55; }
      #tdm-hud .tdm-board-table .tdm-row-blue .tdm-cell-name { color: #6aa0ff; }
      #tdm-hud .tdm-board-table .tdm-row-self td { background: rgba(255,255,255,0.10); }
      #tdm-hud .tdm-legend { color: #c9d2dc; font-size: 12px; margin-top: 6px; text-align: center; }

      /* スマホ・タブレット横画面（低い画面）向けの縮小とセーフエリア回避 */
      @media (orientation: landscape) and (max-height: 520px) {
        #tdm-hud .tdm-bar { top: calc(8px + env(safe-area-inset-top, 0px)); gap: 10px; }
        #tdm-hud .tdm-chip { padding: 3px 9px; }
        #tdm-hud .tdm-kills { font-size: 15px; min-width: 18px; }
        #tdm-hud .tdm-timer { font-size: 15px; min-width: 54px; }
        #tdm-hud .tdm-feed { top: 44px; right: calc(10px + env(safe-area-inset-right, 0px)); }
        #tdm-hud .tdm-feed-row { font-size: 11px; padding: 2px 7px; }
        #tdm-hud .tdm-elim-title { font-size: 30px; }
        #tdm-hud .tdm-elim-count { font-size: 14px; }
        #tdm-hud .tdm-result-title { font-size: 38px; }
        #tdm-hud .tdm-result-score { font-size: 18px; }
      }
    `;
    document.head.appendChild(style);
  }
}
