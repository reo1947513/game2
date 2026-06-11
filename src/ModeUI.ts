// モード選択画面・結果画面・モード中の情報表示（スコアや残り時間など）を
// まとめて受け持つ画面まわりのクラスです。DOMを動的に作り、既存のHUDやindex.htmlには手を加えません。

export interface ModeMenuItem {
  id: string;
  label: string;
  description: string;
}

export class ModeUI {
  private root: HTMLElement;
  private menu: HTMLElement;
  private menuList: HTMLElement;
  private stageRow: HTMLElement;
  private result: HTMLElement;
  private resultBody: HTMLElement;
  private resultBack: HTMLElement;
  private hud: HTMLElement;

  constructor() {
    this.injectStyle();

    this.root = document.createElement("div");
    this.root.id = "mode-ui";
    document.body.appendChild(this.root);

    // モード選択画面
    this.menu = document.createElement("div");
    this.menu.className = "mode-overlay";
    this.menu.style.display = "none";
    const menuCard = document.createElement("div");
    menuCard.className = "mode-card";
    const menuTitle = document.createElement("div");
    menuTitle.className = "mode-card-title";
    menuTitle.textContent = "モードを選ぶ";
    menuCard.appendChild(menuTitle);

    // ステージ選択
    const stageTitle = document.createElement("div");
    stageTitle.className = "mode-sub-title";
    stageTitle.textContent = "ステージ";
    menuCard.appendChild(stageTitle);
    this.stageRow = document.createElement("div");
    this.stageRow.className = "stage-row";
    menuCard.appendChild(this.stageRow);

    this.menuList = document.createElement("div");
    this.menuList.className = "mode-list";
    menuCard.appendChild(this.menuList);
    this.menu.appendChild(menuCard);
    this.root.appendChild(this.menu);

    // 結果画面
    this.result = document.createElement("div");
    this.result.className = "mode-overlay";
    this.result.style.display = "none";
    const resultCard = document.createElement("div");
    resultCard.className = "mode-card";
    this.resultBody = document.createElement("div");
    this.resultBody.className = "mode-result-body";
    resultCard.appendChild(this.resultBody);
    this.resultBack = document.createElement("button");
    this.resultBack.className = "mode-btn mode-btn-primary";
    this.resultBack.textContent = "メニューに戻る";
    resultCard.appendChild(this.resultBack);
    this.result.appendChild(resultCard);
    this.root.appendChild(this.result);

    // モード中の情報表示（上部中央）
    this.hud = document.createElement("div");
    this.hud.className = "mode-hud";
    this.hud.style.display = "none";
    this.root.appendChild(this.hud);
  }

  // モード選択画面を表示する（ステージ選択行つき）
  showMenu(
    items: ModeMenuItem[],
    onSelect: (id: string) => void,
    stages: Array<{ id: string; label: string }>,
    selectedStage: string,
    onStageSelect: (id: string) => void
  ): void {
    this.hideResult();
    this.hideHud();

    // ステージ選択ボタン群（選択中をハイライト）
    this.stageRow.innerHTML = "";
    const stageBtns: HTMLElement[] = [];
    for (const s of stages) {
      const sb = document.createElement("button");
      sb.className = "stage-item" + (s.id === selectedStage ? " active" : "");
      sb.textContent = s.label;
      sb.addEventListener("click", () => {
        onStageSelect(s.id);
        for (const x of stageBtns) x.classList.remove("active");
        sb.classList.add("active");
      });
      this.stageRow.appendChild(sb);
      stageBtns.push(sb);
    }

    this.menuList.innerHTML = "";
    for (const item of items) {
      const b = document.createElement("button");
      b.className = "mode-item";
      const label = document.createElement("div");
      label.className = "mode-item-label";
      label.textContent = item.label;
      const desc = document.createElement("div");
      desc.className = "mode-item-desc";
      desc.textContent = item.description;
      b.appendChild(label);
      b.appendChild(desc);
      b.addEventListener("click", () => onSelect(item.id));
      this.menuList.appendChild(b);
    }
    this.menu.style.display = "flex";
  }

  hideMenu(): void {
    this.menu.style.display = "none";
  }

  // 結果画面を表示する
  showResult(lines: string[], onBack: () => void): void {
    this.hideHud();
    this.resultBody.innerHTML = "";
    lines.forEach((line, i) => {
      const row = document.createElement("div");
      row.className = i === 0 ? "mode-result-title" : "mode-result-line";
      row.textContent = line;
      this.resultBody.appendChild(row);
    });
    this.resultBack.onclick = () => onBack();
    this.result.style.display = "flex";
  }

  hideResult(): void {
    this.result.style.display = "none";
  }

  hideAll(): void {
    this.hideMenu();
    this.hideResult();
  }

  // モード中の情報表示の出し入れ
  showHud(show: boolean): void {
    this.hud.style.display = show ? "block" : "none";
  }

  hideHud(): void {
    this.hud.style.display = "none";
  }

  // 情報表示の中身を更新する（1行ごとに渡す）
  setHud(lines: string[]): void {
    this.hud.innerHTML = "";
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "mode-hud-line";
      row.textContent = line;
      this.hud.appendChild(row);
    }
  }

  private injectStyle(): void {
    if (document.getElementById("mode-ui-style")) return;
    const style = document.createElement("style");
    style.id = "mode-ui-style";
    style.textContent = `
      #mode-ui {
        font-family: system-ui, sans-serif;
      }
      #mode-ui .mode-overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.8);
      }
      #mode-ui .mode-card {
        width: min(90vw, 460px);
        max-height: 88vh;
        overflow-y: auto;
        background: #14141a;
        border: 1px solid rgba(255, 200, 80, 0.4);
        border-radius: 14px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      #mode-ui .mode-card-title {
        color: #ffd27a;
        font-size: 22px;
        font-weight: 800;
        text-align: center;
      }
      #mode-ui .mode-sub-title {
        color: rgba(255, 220, 170, 0.85);
        font-size: 14px;
        font-weight: 700;
      }
      #mode-ui .stage-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      #mode-ui .stage-item {
        appearance: none;
        border: 1px solid rgba(255, 200, 80, 0.4);
        background: rgba(40, 36, 28, 0.6);
        color: rgba(255, 230, 176, 0.85);
        font-size: 13px;
        font-weight: 700;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
      #mode-ui .stage-item:hover {
        background: rgba(255, 170, 60, 0.18);
      }
      #mode-ui .stage-item.active {
        background: rgba(255, 170, 60, 0.85);
        color: #1a1206;
        border-color: rgba(255, 170, 60, 0.9);
      }
      #mode-ui .mode-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #mode-ui .mode-item {
        appearance: none;
        text-align: left;
        border: 1px solid rgba(255, 200, 80, 0.5);
        background: rgba(40, 36, 28, 0.7);
        border-radius: 10px;
        padding: 14px 16px;
        cursor: pointer;
      }
      #mode-ui .mode-item:hover {
        background: rgba(255, 170, 60, 0.18);
      }
      #mode-ui .mode-item-label {
        color: #ffe6b0;
        font-size: 17px;
        font-weight: 700;
        margin-bottom: 4px;
      }
      #mode-ui .mode-item-desc {
        color: rgba(255, 220, 170, 0.7);
        font-size: 13px;
        line-height: 1.4;
      }
      #mode-ui .mode-btn {
        appearance: none;
        border: 1px solid rgba(255, 200, 80, 0.6);
        background: rgba(40, 36, 28, 0.8);
        color: #ffe6b0;
        font-size: 16px;
        font-weight: 700;
        padding: 12px;
        border-radius: 10px;
        cursor: pointer;
      }
      #mode-ui .mode-btn-primary {
        background: rgba(255, 170, 60, 0.85);
        color: #1a1206;
        border-color: rgba(255, 170, 60, 0.9);
      }
      #mode-ui .mode-result-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
      }
      #mode-ui .mode-result-title {
        color: #ffd27a;
        font-size: 20px;
        font-weight: 800;
      }
      #mode-ui .mode-result-line {
        color: #ffe6b0;
        font-size: 17px;
      }
      #mode-ui .mode-hud {
        position: fixed;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        z-index: 45;
        display: none;
        text-align: center;
        pointer-events: none;
        background: rgba(10, 12, 16, 0.5);
        border: 1px solid rgba(255, 200, 80, 0.35);
        border-radius: 10px;
        padding: 8px 18px;
      }
      #mode-ui .mode-hud-line {
        color: #ffe6b0;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.4;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
      }
    `;
    document.head.appendChild(style);
  }
}
