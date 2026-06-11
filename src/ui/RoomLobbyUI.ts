// オンライン対戦のロビー画面（ルーム作成 / 参加）。
// ネットワーク処理は持たず、ボタン操作をコールバックで Game へ渡すだけ。
export interface LobbyCallbacks {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  onClose: () => void;
}

export class RoomLobbyUI {
  private root: HTMLElement;
  private codeRow: HTMLElement;
  private codeText: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private startBtn: HTMLButtonElement;
  private joinInput: HTMLInputElement;
  private errorEl: HTMLElement;
  private cb: LobbyCallbacks | null = null;

  constructor() {
    RoomLobbyUI.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "lobby-ui";
    this.root.style.display = "none";

    const card = document.createElement("div");
    card.className = "lobby-card";

    const title = document.createElement("div");
    title.className = "lobby-title";
    title.textContent = "オンライン対戦";
    card.appendChild(title);

    // --- ルームを作成 ---
    const createSec = document.createElement("div");
    createSec.className = "lobby-section";
    const createBtn = document.createElement("button");
    createBtn.className = "lobby-btn lobby-btn-primary";
    createBtn.textContent = "ルームを作成";
    createBtn.onclick = () => this.cb?.onCreate();
    createSec.appendChild(createBtn);

    this.codeRow = document.createElement("div");
    this.codeRow.className = "lobby-code-row";
    this.codeRow.style.display = "none";
    const codeLabel = document.createElement("span");
    codeLabel.textContent = "ルームコード: ";
    this.codeText = document.createElement("span");
    this.codeText.className = "lobby-code";
    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "lobby-btn-small";
    this.copyBtn.textContent = "コピー";
    this.copyBtn.onclick = () => this.copyCode();
    this.codeRow.appendChild(codeLabel);
    this.codeRow.appendChild(this.codeText);
    this.codeRow.appendChild(this.copyBtn);
    createSec.appendChild(this.codeRow);
    card.appendChild(createSec);

    // --- ルームに参加 ---
    const joinSec = document.createElement("div");
    joinSec.className = "lobby-section";
    const joinTitle = document.createElement("div");
    joinTitle.className = "lobby-sub";
    joinTitle.textContent = "ルームに参加";
    joinSec.appendChild(joinTitle);
    const joinRow = document.createElement("div");
    joinRow.className = "lobby-join-row";
    this.joinInput = document.createElement("input");
    this.joinInput.className = "lobby-input";
    this.joinInput.maxLength = 6;
    this.joinInput.placeholder = "______";
    this.joinInput.oninput = () => {
      this.joinInput.value = this.joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    };
    const joinBtn = document.createElement("button");
    joinBtn.className = "lobby-btn";
    joinBtn.textContent = "参加";
    joinBtn.onclick = () => {
      const code = this.joinInput.value.trim();
      if (code.length === 6) this.cb?.onJoin(code);
      else this.setError("コードは6文字です");
    };
    joinRow.appendChild(this.joinInput);
    joinRow.appendChild(joinBtn);
    joinSec.appendChild(joinRow);
    card.appendChild(joinSec);

    // --- 状態・開始・戻る ---
    this.statusEl = document.createElement("div");
    this.statusEl.className = "lobby-status";
    card.appendChild(this.statusEl);

    this.errorEl = document.createElement("div");
    this.errorEl.className = "lobby-error";
    card.appendChild(this.errorEl);

    this.startBtn = document.createElement("button");
    this.startBtn.className = "lobby-btn lobby-btn-primary";
    this.startBtn.textContent = "全員揃いました。ゲーム開始";
    this.startBtn.style.display = "none";
    this.startBtn.onclick = () => this.cb?.onStart();
    card.appendChild(this.startBtn);

    const backBtn = document.createElement("button");
    backBtn.className = "lobby-btn";
    backBtn.textContent = "戻る";
    backBtn.onclick = () => this.cb?.onClose();
    card.appendChild(backBtn);

    this.root.appendChild(card);
    document.body.appendChild(this.root);
  }

  show(cb: LobbyCallbacks): void {
    this.cb = cb;
    this.reset();
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private reset(): void {
    this.codeRow.style.display = "none";
    this.codeText.textContent = "";
    this.joinInput.value = "";
    this.statusEl.textContent = "";
    this.errorEl.textContent = "";
    this.startBtn.style.display = "none";
  }

  // ルーム作成/参加でコードが確定したら表示する。
  setCode(code: string): void {
    this.codeText.textContent = code;
    this.codeRow.style.display = "flex";
    this.errorEl.textContent = "";
  }

  // 在室人数と最大人数・ホストかどうかを反映する。
  setRoster(count: number, max: number, isHost: boolean): void {
    if (count >= max) {
      this.statusEl.textContent = `全員揃いました (${count}/${max})`;
      this.startBtn.style.display = isHost ? "block" : "none";
      if (!isHost) this.statusEl.textContent += " — ホストの開始を待っています";
    } else {
      this.statusEl.textContent = `入室待ち... (${count}/${max})`;
      this.startBtn.style.display = "none";
    }
  }

  setError(message: string): void {
    this.errorEl.textContent = message;
  }

  private async copyCode(): Promise<void> {
    const code = this.codeText.textContent ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copyBtn.textContent = "コピー済み";
      window.setTimeout(() => (this.copyBtn.textContent = "コピー"), 1200);
    } catch {
      // クリップボードが使えない環境では選択して手動コピーを促す
      this.setError("コピーできませんでした。コードを手動で控えてください");
    }
  }

  private static styleInjected = false;
  private static injectStyle(): void {
    if (RoomLobbyUI.styleInjected) return;
    RoomLobbyUI.styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      #lobby-ui {
        position: fixed;
        inset: 0;
        z-index: 130;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(8, 10, 14, 0.82);
        font-family: system-ui, -apple-system, sans-serif;
      }
      #lobby-ui .lobby-card {
        background: rgba(22, 26, 34, 0.96);
        border: 1px solid rgba(120, 160, 220, 0.25);
        border-radius: 14px;
        padding: 24px 28px;
        width: 380px;
        max-width: 90vw;
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: #e8ecf5;
      }
      #lobby-ui .lobby-title {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }
      #lobby-ui .lobby-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      #lobby-ui .lobby-sub {
        font-size: 13px;
        font-weight: 700;
        color: rgba(200, 215, 240, 0.85);
      }
      #lobby-ui .lobby-code-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
      }
      #lobby-ui .lobby-code {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.18em;
        color: #ffd23a;
      }
      #lobby-ui .lobby-join-row {
        display: flex;
        gap: 8px;
      }
      #lobby-ui .lobby-input {
        flex: 1;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-align: center;
        text-transform: uppercase;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid rgba(120, 160, 220, 0.4);
        background: rgba(10, 14, 20, 0.8);
        color: #fff;
      }
      #lobby-ui .lobby-status {
        font-size: 14px;
        font-weight: 700;
        color: rgba(180, 220, 255, 0.9);
        min-height: 18px;
      }
      #lobby-ui .lobby-error {
        font-size: 13px;
        color: #ff6a5a;
        min-height: 16px;
      }
      #lobby-ui .lobby-btn {
        appearance: none;
        border: 1px solid rgba(120, 160, 220, 0.35);
        background: rgba(40, 48, 60, 0.8);
        color: #e8ecf5;
        font-size: 15px;
        font-weight: 700;
        padding: 10px 14px;
        border-radius: 9px;
        cursor: pointer;
      }
      #lobby-ui .lobby-btn:hover {
        background: rgba(70, 110, 180, 0.45);
      }
      #lobby-ui .lobby-btn-primary {
        background: rgba(70, 150, 230, 0.85);
        border-color: rgba(70, 150, 230, 0.9);
      }
      #lobby-ui .lobby-btn-primary:hover {
        background: rgba(90, 170, 250, 0.95);
      }
      #lobby-ui .lobby-btn-small {
        appearance: none;
        border: 1px solid rgba(120, 160, 220, 0.4);
        background: rgba(40, 48, 60, 0.8);
        color: #e8ecf5;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(s);
  }
}
