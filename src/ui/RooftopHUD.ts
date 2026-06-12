import { RooftopShared } from "../online/netTypes";

// ROOFTOP DUEL（デスマッチ）のHUD。画面上部に全プレイヤーの [名前 キル数] を
// キル数の多い順で横並び表示し、自分を強調する。終了時に中央へリザルトを出す。
// 外部CSSに依存しないようインラインスタイルで自己完結させる。
export class RooftopHUD {
  private root: HTMLElement;
  private board: HTMLElement;
  private info: HTMLElement;
  private result: HTMLElement;
  private resultInner: HTMLElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;top:10px;left:0;right:0;z-index:40;display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;";

    this.board = document.createElement("div");
    this.board.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:96vw;";
    this.root.appendChild(this.board);

    this.info = document.createElement("div");
    this.info.style.cssText =
      "color:#cfe6ff;font-size:12px;letter-spacing:1px;text-shadow:0 1px 2px #000;opacity:0.85;";
    this.root.appendChild(this.info);

    this.result = document.createElement("div");
    this.result.style.cssText =
      "position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(2,6,15,0.78);pointer-events:auto;";
    this.resultInner = document.createElement("div");
    this.resultInner.style.cssText =
      "min-width:280px;max-width:90vw;padding:28px 32px;border-radius:14px;background:linear-gradient(160deg,#0e1726,#0a1018);border:1px solid #24405e;color:#eaf3ff;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;";
    this.result.appendChild(this.resultInner);

    document.body.appendChild(this.root);
    document.body.appendChild(this.result);
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
    this.result.style.display = "none";
    this.board.innerHTML = "";
  }

  // 上部スコアボードを更新する。
  update(rooftop: RooftopShared, selfId: string, nameOf: (id: string) => string): void {
    const sorted = [...rooftop.players].sort((a, b) => b.kills - a.kills || b.score - a.score);
    this.board.innerHTML = "";
    for (const p of sorted) {
      const me = p.playerId === selfId;
      const chip = document.createElement("div");
      chip.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;font-size:13px;text-shadow:0 1px 2px #000;" +
        (me
          ? "background:rgba(80,150,255,0.32);border:1px solid #6aa8ff;color:#fff;font-weight:700;"
          : "background:rgba(10,18,30,0.6);border:1px solid #24405e;color:#cfe0f5;");
      const dead = !p.isAlive ? "opacity:0.5;" : "";
      chip.style.cssText += dead;
      const nm = document.createElement("span");
      nm.textContent = me ? "あなた" : nameOf(p.playerId);
      const k = document.createElement("span");
      k.style.cssText = "font-weight:700;color:" + (me ? "#fff" : "#ffd27a") + ";";
      k.textContent = String(p.kills);
      chip.appendChild(nm);
      chip.appendChild(k);
      this.board.appendChild(chip);
    }
    const mm = Math.floor(rooftop.timeRemaining / 60);
    const ss = String(rooftop.timeRemaining % 60).padStart(2, "0");
    this.info.textContent = `ROOFTOP DUEL  残り ${mm}:${ss}  /  キル上限 ${rooftop.killLimit}`;
  }

  // 終了リザルトを中央表示する。
  showResult(
    rooftop: RooftopShared,
    selfId: string,
    nameOf: (id: string) => string,
    onClose: () => void
  ): void {
    const sorted = [...rooftop.players].sort((a, b) => b.kills - a.kills || b.score - a.score);
    const won = rooftop.winnerId === selfId;
    const winnerName = rooftop.winnerId
      ? rooftop.winnerId === selfId
        ? "あなた"
        : nameOf(rooftop.winnerId)
      : "なし";

    const rows = sorted
      .map((p, i) => {
        const me = p.playerId === selfId;
        const nm = me ? "あなた" : nameOf(p.playerId);
        return (
          `<div style="display:flex;justify-content:space-between;gap:18px;padding:5px 10px;border-radius:6px;${
            me ? "background:rgba(80,150,255,0.25);font-weight:700;" : ""
          }">` +
          `<span>${i + 1}. ${escapeHtml(nm)}</span>` +
          `<span style="color:#ffd27a;">${p.kills} kills　${p.score} pt</span></div>`
        );
      })
      .join("");

    this.resultInner.innerHTML =
      `<div style="font-size:26px;font-weight:800;letter-spacing:2px;color:${won ? "#7fffd0" : "#ff8a8a"};margin-bottom:4px;">` +
      `${won ? "VICTORY" : "DEFEAT"}</div>` +
      `<div style="font-size:13px;opacity:0.8;margin-bottom:16px;">勝者: ${escapeHtml(winnerName)}</div>` +
      `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:18px;">${rows}</div>` +
      `<button id="rooftop-result-close" style="pointer-events:auto;padding:10px 28px;border-radius:8px;border:1px solid #6aa8ff;background:#16335a;color:#eaf3ff;font-size:14px;cursor:pointer;">メニューへ</button>`;
    this.result.style.display = "flex";
    const btn = this.resultInner.querySelector<HTMLButtonElement>("#rooftop-result-close");
    if (btn) {
      btn.onclick = () => {
        this.hide();
        onClose();
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
