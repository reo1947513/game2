import { CoopShared } from "../online/netTypes";

// コープ・ガントレット専用のHUD。
// 左に各プレイヤーのHP・状態、上部にWAVE数と残り敵数（休憩中は次Waveまでの秒）、
// 中央に蘇生の進行バー、終了時に全滅リザルトを表示する。
export class CoopHUD {
  private root: HTMLElement;
  private top: HTMLElement;
  private list: HTMLElement;
  private revive: HTMLElement;
  private reviveLabel: HTMLElement;
  private reviveFill: HTMLElement;
  private result: HTMLElement;
  private resultInner: HTMLElement;
  private feed: HTMLElement;
  private onClose: (() => void) | null = null;
  // プレイヤー行のDOMキャッシュ（毎フレーム作り直さず値だけ更新する）
  private rowCache = new Map<
    string,
    { row: HTMLElement; name: HTMLElement; fill: HTMLElement; status: HTMLElement }
  >();

  constructor() {
    this.injectStyle();
    this.root = document.createElement("div");
    this.root.id = "coop-hud";
    this.root.style.display = "none";

    this.top = document.createElement("div");
    this.top.className = "coop-top";

    this.list = document.createElement("div");
    this.list.className = "coop-list";

    this.revive = document.createElement("div");
    this.revive.className = "coop-revive";
    this.revive.style.display = "none";
    this.reviveLabel = document.createElement("div");
    this.reviveLabel.className = "coop-revive-label";
    const track = document.createElement("div");
    track.className = "coop-revive-track";
    this.reviveFill = document.createElement("div");
    this.reviveFill.className = "coop-revive-fill";
    track.appendChild(this.reviveFill);
    this.revive.appendChild(this.reviveLabel);
    this.revive.appendChild(track);

    this.result = document.createElement("div");
    this.result.className = "coop-result";
    this.result.style.display = "none";
    this.resultInner = document.createElement("div");
    this.resultInner.className = "coop-result-inner";
    this.result.appendChild(this.resultInner);

    this.feed = document.createElement("div");
    this.feed.className = "coop-feed";

    this.root.appendChild(this.top);
    this.root.appendChild(this.list);
    this.root.appendChild(this.feed);
    this.root.appendChild(this.revive);
    this.root.appendChild(this.result);
    document.body.appendChild(this.root);
  }

  // キルフィードに1行追加する（フォローキル・フラッシュアシストのボーナス表示）。
  addFeed(text: string): void {
    const row = document.createElement("div");
    row.className = "coop-feed-row";
    row.textContent = text;
    this.feed.appendChild(row);
    while (this.feed.childElementCount > 5) {
      const first = this.feed.firstElementChild;
      if (first) this.feed.removeChild(first);
      else break;
    }
    window.setTimeout(() => {
      if (row.parentElement === this.feed) this.feed.removeChild(row);
    }, 4000);
  }

  show(): void {
    this.root.style.display = "block";
    this.result.style.display = "none";
    this.revive.style.display = "none";
  }

  hide(): void {
    this.root.style.display = "none";
    this.result.style.display = "none";
    this.revive.style.display = "none";
    this.feed.innerHTML = "";
  }

  // 毎フレーム更新。nameOf はプレイヤーIDから表示名を返す関数。
  update(coop: CoopShared, selfId: string, nameOf: (id: string) => string): void {
    // 上部：WAVE と残り敵数 / 休憩
    if (coop.phase === "REST") {
      this.top.textContent = `WAVE ${coop.currentWave} 突破　次のWAVEまで ${coop.restCountdown}`;
    } else {
      this.top.textContent = `WAVE ${coop.currentWave} / ∞　　敵 ${coop.enemiesRemaining}　　SCORE ${coop.totalScore}`;
    }

    // 左：プレイヤー状態リスト（playerId別に行をキャッシュし、値だけ更新する）
    const seen = new Set<string>();
    for (const p of coop.players) {
      seen.add(p.playerId);
      let c = this.rowCache.get(p.playerId);
      if (!c) {
        const row = document.createElement("div");
        row.className = "coop-row";
        if (p.playerId === selfId) row.classList.add("coop-self");
        const name = document.createElement("div");
        name.className = "coop-name";
        name.textContent = nameOf(p.playerId);
        const barWrap = document.createElement("div");
        barWrap.className = "coop-bar";
        const fill = document.createElement("div");
        fill.className = "coop-bar-fill";
        barWrap.appendChild(fill);
        const status = document.createElement("div");
        status.className = "coop-status";
        row.appendChild(name);
        row.appendChild(barWrap);
        row.appendChild(status);
        this.list.appendChild(row);
        c = { row, name, fill, status };
        this.rowCache.set(p.playerId, c);
      }

      const ratio = Math.max(0, Math.min(1, p.hp / 100));
      c.fill.style.width = `${Math.round(ratio * 100)}%`;
      if (p.status === "DOWN") c.fill.style.background = "#e7b53a";
      else if (p.status === "DEAD") c.fill.style.background = "#777";
      else c.fill.style.background = ratio <= 0.3 ? "#e7503a" : "#46d36a";

      if (p.status === "DOWN") {
        c.status.textContent = "DOWN";
        c.status.style.color = "#ffcf57";
      } else if (p.status === "DEAD") {
        c.status.textContent = "DEAD";
        c.status.style.color = "#bbb";
      } else {
        c.status.textContent = `HP ${Math.round(p.hp)}`;
        c.status.style.color = "#cfe";
      }
    }
    // いなくなったプレイヤーの行を取り除く
    for (const [id, c] of this.rowCache) {
      if (!seen.has(id)) {
        if (c.row.parentElement === this.list) this.list.removeChild(c.row);
        this.rowCache.delete(id);
      }
    }

    // 中央：蘇生バー
    const me = coop.players.find((p) => p.playerId === selfId);
    let prog = -1;
    let label = "";
    if (me && me.status === "DOWN") {
      prog = me.reviveProgress;
      label = "ダウン — 蘇生を待っています";
    } else {
      // 進行中のダウン者がいれば表示（蘇生している側の目安）
      const reviving = coop.players.find((p) => p.status === "DOWN" && p.reviveProgress > 0.05);
      if (reviving) {
        prog = reviving.reviveProgress;
        label = "蘇生中（Eキー長押し）";
      }
    }
    if (prog >= 0 && coop.phase !== "RESULT") {
      this.revive.style.display = "block";
      this.reviveLabel.textContent = label;
      this.reviveFill.style.width = `${Math.round(Math.min(1, prog / 5) * 100)}%`;
    } else {
      this.revive.style.display = "none";
    }
  }

  showResult(coop: CoopShared, onClose: () => void): void {
    this.onClose = onClose;
    this.revive.style.display = "none";
    this.resultInner.innerHTML = "";
    const h = document.createElement("div");
    h.className = "coop-result-title";
    h.textContent = coop.wipe ? "MISSION FAILED" : "MISSION COMPLETE";
    const sub = document.createElement("div");
    sub.className = "coop-result-sub";
    sub.textContent = `到達 WAVE ${coop.currentWave}　／　SCORE ${coop.totalScore}`;
    const btn = document.createElement("button");
    btn.className = "coop-result-btn";
    btn.textContent = "ロビーに戻る";
    btn.onclick = () => {
      this.result.style.display = "none";
      this.onClose?.();
    };
    this.resultInner.appendChild(h);
    this.resultInner.appendChild(sub);
    this.resultInner.appendChild(btn);
    this.result.style.display = "flex";
  }

  isResultOpen(): boolean {
    return this.result.style.display !== "none";
  }

  private injectStyle(): void {
    if (document.getElementById("coop-hud-style")) return;
    const style = document.createElement("style");
    style.id = "coop-hud-style";
    style.textContent = `
      #coop-hud { position: fixed; inset: 0; z-index: 48; pointer-events: none; font-family: system-ui, sans-serif; }
      #coop-hud .coop-top {
        position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
        color: #ffe6b0; font-size: 18px; font-weight: 800; letter-spacing: 0.06em;
        text-shadow: 0 1px 4px rgba(0,0,0,0.85); white-space: nowrap;
      }
      #coop-hud .coop-list {
        position: absolute; top: 64px; left: 16px; display: flex; flex-direction: column; gap: 6px;
      }
      #coop-hud .coop-row {
        display: flex; align-items: center; gap: 8px;
        background: rgba(0,0,0,0.45); padding: 5px 9px; border-radius: 7px;
        border: 1px solid rgba(255,255,255,0.12); min-width: 220px;
      }
      #coop-hud .coop-row.coop-self { border-color: rgba(255,220,150,0.7); }
      #coop-hud .coop-name { color: #fff; font-size: 12px; font-weight: 700; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #coop-hud .coop-bar { flex: 1; height: 9px; background: rgba(0,0,0,0.5); border-radius: 5px; overflow: hidden; }
      #coop-hud .coop-bar-fill { height: 100%; width: 100%; background: #46d36a; transition: width 0.12s linear; }
      #coop-hud .coop-status { font-size: 11px; font-weight: 800; width: 48px; text-align: right; }
      #coop-hud .coop-revive {
        position: absolute; top: 60%; left: 50%; transform: translate(-50%,-50%); width: 320px; max-width: 70vw;
      }
      #coop-hud .coop-revive-label { color: #ffe6b0; font-size: 14px; font-weight: 700; text-align: center; margin-bottom: 5px; text-shadow: 0 1px 3px rgba(0,0,0,0.85); }
      #coop-hud .coop-revive-track { width: 100%; height: 12px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,220,150,0.45); border-radius: 6px; overflow: hidden; }
      #coop-hud .coop-revive-fill { height: 100%; width: 0%; background: #57c9ff; transition: width 0.1s linear; }
      #coop-hud .coop-result { position: absolute; inset: 0; background: rgba(0,0,0,0.72); align-items: center; justify-content: center; pointer-events: auto; }
      #coop-hud .coop-result-inner { display: flex; flex-direction: column; align-items: center; gap: 16px; }
      #coop-hud .coop-result-title { font-size: 50px; font-weight: 900; letter-spacing: 0.06em; color: #ff6a55; text-shadow: 0 2px 12px rgba(0,0,0,0.9); }
      #coop-hud .coop-result-sub { color: #fff; font-size: 22px; font-weight: 800; }
      #coop-hud .coop-result-btn { margin-top: 6px; padding: 12px 28px; font-size: 16px; font-weight: 800; color: #1a1a1a; background: #ffd27a; border: none; border-radius: 10px; cursor: pointer; }
      #coop-hud .coop-result-btn:hover { background: #ffdd97; }
      #coop-hud .coop-feed { position: absolute; top: 64px; right: 18px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
      #coop-hud .coop-feed-row { background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 5px; font-size: 13px; font-weight: 800; color: #9ff0b0; text-shadow: 0 1px 2px rgba(0,0,0,0.85); letter-spacing: 0.03em; }

      /* スマホ・タブレット横画面（低い画面）向けの縮小とセーフエリア回避 */
      @media (orientation: landscape) and (max-height: 520px) {
        #coop-hud .coop-top { top: calc(8px + env(safe-area-inset-top, 0px)); font-size: 13px; }
        #coop-hud .coop-list { top: 40px; left: calc(8px + env(safe-area-inset-left, 0px)); gap: 4px; }
        #coop-hud .coop-row { min-width: 150px; padding: 3px 7px; gap: 6px; }
        #coop-hud .coop-name { width: 48px; font-size: 11px; }
        #coop-hud .coop-bar { height: 8px; }
        #coop-hud .coop-status { width: 40px; font-size: 10px; }
        #coop-hud .coop-feed { top: 40px; right: calc(8px + env(safe-area-inset-right, 0px)); }
        #coop-hud .coop-feed-row { font-size: 11px; padding: 3px 7px; }
        #coop-hud .coop-revive { width: 240px; top: 56%; }
        #coop-hud .coop-revive-label { font-size: 12px; }
        #coop-hud .coop-result-title { font-size: 34px; }
        #coop-hud .coop-result-sub { font-size: 16px; }
      }
    `;
    document.head.appendChild(style);
  }
}
