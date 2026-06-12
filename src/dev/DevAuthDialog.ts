// DEV RANGE の開発者パスワード入力ダイアログ。
// VITE_DEV_RANGE 有効ビルドからのみ動的 import されるため、本番バンドルには含まれない。
// パスワードは VITE_DEV_PASSWORD（環境変数）。未設定なら何を入れても通らない。
// 不正解はヒントを与えないため、エラー表示なしで静かに閉じる。
export class DevAuthDialog {
  // 正解で onResult(true)＋閉じる、不正解は静かに閉じる（onResult は呼ばない）。
  open(onResult: (ok: boolean) => void): void {
    const password = (import.meta as unknown as { env: { VITE_DEV_PASSWORD?: string } })
      .env.VITE_DEV_PASSWORD ?? "";

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(4,6,10,0.7);font-family:system-ui,-apple-system,sans-serif;";

    const box = document.createElement("div");
    box.style.cssText =
      "width:min(320px,86vw);padding:22px;border-radius:12px;color:#e8eaed;" +
      "background:linear-gradient(180deg,rgba(20,24,30,0.98),rgba(12,14,18,0.98));" +
      "border:1px solid rgba(255,184,60,0.3);box-shadow:0 12px 40px rgba(0,0,0,0.6);";

    const title = document.createElement("div");
    title.textContent = "Developer Access";
    title.style.cssText =
      "font-size:15px;font-weight:800;letter-spacing:0.08em;color:#ffce7a;margin-bottom:14px;text-align:center;";

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.style.cssText =
      "width:100%;padding:10px 12px;font-size:14px;color:#fff;background:rgba(255,255,255,0.06);" +
      "border:1px solid rgba(255,255,255,0.22);border-radius:8px;outline:none;box-sizing:border-box;";

    const enter = document.createElement("button");
    enter.textContent = "Enter";
    enter.style.cssText =
      "width:100%;margin-top:14px;padding:10px;font-size:14px;font-weight:800;color:#1a1206;" +
      "background:linear-gradient(180deg,#ffd884,#f5a623);border:none;border-radius:8px;cursor:pointer;";

    box.appendChild(title);
    box.appendChild(input);
    box.appendChild(enter);
    overlay.appendChild(box);
    // ダイアログ内のキー入力をゲーム側へ漏らさない。
    overlay.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    input.focus();

    const close = (): void => {
      overlay.remove();
    };

    const submit = (): void => {
      const ok = !!password && input.value === password;
      if (ok) {
        close();
        onResult(true);
      } else {
        // 不正解：ヒントを与えず静かに閉じる
        close();
      }
    };

    enter.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      else if (e.key === "Escape") close();
    });
    // 枠外クリックで閉じる
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
  }
}
