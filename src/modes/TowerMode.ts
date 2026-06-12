import { GameMode, GameContext } from "../GameModes";
import { ModeHUD } from "../ui/ModeHUD";

// ===== TOWER（100層フロア制）オフライン版 =====
//
// 1層から100層まで、各フロアの敵Waveを全滅させて上を目指すタワーモードです。
// 10層ごとにボスフロアが配置され、100層をクリアすると「TOWER CLEARED」で終了します。
//
// このファイルは段階実装の「骨組み」です（タスク2）。
//   - フロアの状態機械（カウントダウン→Wave→休憩→次層→…→クリア）
//   - 100層のフロア進行とボスフロアの判定
//   - 死亡・クリアの終了処理
// 敵のスポーンと行動（6種）はタスク3〜4で、ボス5種はタスク5で、
// 専用HUDとクリア演出はタスク6でこのファイルに差し込みます。
// 骨組みでは敵が存在しないため、各Waveは短い待機後にクリア扱いとして
// 進行とエンディングだけを先に検証できるようにしています（spawnWave 内のコメント参照）。

// ボスの種類。
export type BossType = "crusher" | "phantom" | "warlord" | "hivemind" | "siege";

// 90層は「全ボスの縮小版ラッシュ」を表す特別マーカー。
type BossKind = BossType | "rush";

// 1フロアのボス配置情報。hpMul は強化フロアでのHP倍率。
interface BossSlot {
  kind: BossKind;
  hpMul: number;
  // 画面表示用の名前。
  label: string;
}

// フロアの進行フェーズ。
type Phase =
  | "countdown" // フロア開始前のカウントダウン
  | "wave" // 通常Wave（敵を全滅させる）
  | "boss" // ボス戦
  | "rest" // フロアクリア後の休憩
  | "result" // 失敗などで終了表示中
  | "cleared" // 100層クリア
  | "dead"; // プレイヤー死亡

const MAX_FLOOR = 100;
const REST_SECONDS = 5; // フロアクリア後の休憩秒数
const COUNTDOWN_SECONDS = 3;

// 10層ごとのボス配置表（section 1 のフロア構成に準拠）。
//   10:CRUSHER / 20:PHANTOM / 30:WARLORD / 40:PHANTOM強化 / 50:WARLORD強化 /
//   60:HIVE MIND / 70:HIVE MIND強化 / 80:SIEGE(プレ最終) / 90:ボスラッシュ / 100:SIEGE最終
const BOSS_SCHEDULE: Record<number, BossSlot> = {
  10: { kind: "crusher", hpMul: 1.0, label: "CRUSHER" },
  20: { kind: "phantom", hpMul: 1.0, label: "PHANTOM" },
  30: { kind: "warlord", hpMul: 1.0, label: "WARLORD" },
  40: { kind: "phantom", hpMul: 1.3, label: "PHANTOM+" },
  50: { kind: "warlord", hpMul: 1.3, label: "WARLORD+" },
  60: { kind: "hivemind", hpMul: 1.0, label: "HIVE MIND" },
  70: { kind: "hivemind", hpMul: 1.3, label: "HIVE MIND+" },
  80: { kind: "siege", hpMul: 1.0, label: "SIEGE ENGINE" },
  90: { kind: "rush", hpMul: 1.0, label: "BOSS RUSH" },
  100: { kind: "siege", hpMul: 1.5, label: "SIEGE ENGINE 最終形態" },
};

export class TowerMode implements GameMode {
  id = "tower";
  label = "TOWER（100層）";
  description =
    "1層ずつ敵Waveを全滅させて上を目指す。10層ごとにボス。100層クリアでTOWER CLEARED。";

  private ctx: GameContext | null = null;
  private hud: ModeHUD | null = null;

  private phase: Phase = "countdown";
  private countdown = COUNTDOWN_SECONDS;
  private currentFloor = 1;
  private restCountdown = 0;
  private totalScore = 0;
  private elapsedMs = 0;

  // 現フロアで残っている敵数（骨組みでは仮タイマーで消化する）。
  private waveRemaining = 0;
  // 骨組み専用：敵未実装のあいだ、Waveを擬似的に消化するための待機タイマー。
  // タスク3で実敵スポーンに置き換える。
  private placeholderWaveTimer = 0;

  enter(ctx: GameContext, _now: number): void {
    this.ctx = ctx;
    this.phase = "countdown";
    this.countdown = COUNTDOWN_SECONDS;
    this.currentFloor = 1;
    this.restCountdown = 0;
    this.totalScore = 0;
    this.elapsedMs = 0;
    this.waveRemaining = 0;
    this.placeholderWaveTimer = 0;

    ctx.health.reset(100);
    ctx.health.show();
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(true);
      ctx.grenadeSystem.reset();
    }
    // 射撃命中フック。タスク3以降で敵への当たりをここで処理する。
    ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg);

    this.hud = new ModeHUD();
    this.hud.setCenter(String(COUNTDOWN_SECONDS), "#ffffff");
    this.updateHud();
  }

  update(ctx: GameContext, dt: number, _now: number): void {
    if (this.phase === "result" || this.phase === "cleared" || this.phase === "dead") {
      return;
    }

    // 死亡判定は常に最優先で見る。
    if (ctx.health.isDead()) {
      this.die(ctx);
      return;
    }

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.hud?.setCenter("GO", "#46d36a");
        window.setTimeout(() => this.hud?.clearCenter(), 500);
        this.beginFloor(this.currentFloor);
      } else {
        this.hud?.setCenter(String(Math.max(1, Math.ceil(this.countdown))), "#ffffff");
      }
      return;
    }

    this.elapsedMs += dt * 1000;

    if (this.phase === "wave" || this.phase === "boss") {
      this.updateCombat(ctx, dt);
      if (this.waveRemaining <= 0) {
        this.onFloorCleared();
      }
      this.updateHud();
      return;
    }

    if (this.phase === "rest") {
      this.restCountdown -= dt;
      this.hud?.setCenter(
        `次のフロアまで ${Math.max(1, Math.ceil(this.restCountdown))}`,
        "#ffe6c7"
      );
      if (this.restCountdown <= 0) {
        this.hud?.clearCenter();
        this.currentFloor += 1;
        this.beginFloor(this.currentFloor);
      }
      this.updateHud();
      return;
    }
  }

  // フロア開始。ボスフロアならボス戦、通常フロアならWaveを始める。
  private beginFloor(floor: number): void {
    const boss = BOSS_SCHEDULE[floor];
    if (boss) {
      this.phase = "boss";
      this.spawnBoss(floor, boss);
      this.hud?.setCenter(boss.label, "#ff5a5a");
      window.setTimeout(() => this.hud?.clearCenter(), 900);
    } else {
      this.phase = "wave";
      this.spawnWave(floor);
    }
    this.updateHud();
  }

  // 通常Waveの敵数 = 4 + floor*2（section 1）。
  private waveEnemyCount(floor: number): number {
    return 4 + floor * 2;
  }

  // 通常Waveのスポーン。
  // 【骨組み】実際の敵生成はタスク3で実装する。ここでは敵数だけ確定させ、
  // placeholderWaveTimer による擬似消化で進行を流す。
  private spawnWave(floor: number): void {
    this.waveRemaining = this.waveEnemyCount(floor);
    this.placeholderWaveTimer = 0.6; // 骨組み：0.6秒後にクリア扱い
  }

  // ボスのスポーン。
  // 【骨組み】実際のボス生成・行動はタスク5で実装する。ここでは1体ぶんの
  // 残数を立て、placeholderWaveTimer で擬似的に消化する。
  private spawnBoss(_floor: number, _slot: BossSlot): void {
    this.waveRemaining = 1;
    this.placeholderWaveTimer = 1.0; // 骨組み：1秒後にクリア扱い
  }

  // 戦闘フェーズの毎フレーム処理。
  // 【骨組み】敵が未実装のため、擬似タイマーで waveRemaining を消化する。
  // タスク3〜5で、実敵・実ボスの更新と全滅判定に置き換える。
  private updateCombat(_ctx: GameContext, dt: number): void {
    if (this.placeholderWaveTimer > 0) {
      this.placeholderWaveTimer -= dt;
      if (this.placeholderWaveTimer <= 0) {
        this.waveRemaining = 0;
      }
    }
  }

  // 射撃が敵に当たったときのフック。
  // 【骨組み】敵が未実装のため現状は何もしない。タスク3でHP減算・撃破処理を追加。
  private onHit(_obj: object, _dmg: number): void {
    // 敵実装後にここで命中処理を行う。
  }

  // フロアクリア時の処理。スコア加算→休憩 or 100層ならクリア。
  private onFloorCleared(): void {
    const bonus = this.floorClearBonus(this.currentFloor);
    this.totalScore += bonus;

    if (this.currentFloor >= MAX_FLOOR) {
      this.clearTower();
      return;
    }

    this.phase = "rest";
    this.restCountdown = REST_SECONDS;
    this.hud?.setCenter(`FLOOR ${this.currentFloor} CLEARED  +${bonus}pt`, "#ffd23a");
  }

  // フロアクリアのスコア（ボスフロアは厚め）。
  private floorClearBonus(floor: number): number {
    return BOSS_SCHEDULE[floor] ? 2000 : 200 + floor * 30;
  }

  // 100層クリア。
  // 【骨組み】専用のフェード演出はタスク6で実装。ここでは結果表示で締める。
  private clearTower(): void {
    this.phase = "cleared";
    const sec = Math.round(this.elapsedMs / 1000);
    this.ctx?.finish(
      [
        "TOWER CLEARED",
        `クリアタイム ${fmtTime(sec)}`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  // プレイヤー死亡。到達層と総スコアを表示。
  private die(ctx: GameContext): void {
    this.phase = "dead";
    ctx.finish(
      [
        "TOWER 失敗",
        `到達 ${this.currentFloor} / ${MAX_FLOOR} 層`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  private updateHud(): void {
    if (!this.hud) return;
    this.hud.setTimer(fmtTime(Math.round(this.elapsedMs / 1000)));
    this.hud.setInfo([
      `Floor ${this.currentFloor} / ${MAX_FLOOR}`,
      `残り敵 ${Math.max(0, this.waveRemaining)}`,
      `スコア ${this.totalScore}`,
    ]);
  }

  exit(ctx: GameContext): void {
    ctx.weapons.enemyHitHook = null;
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(false);
      ctx.grenadeSystem.clear();
    }
    ctx.health.hide();
    this.hud?.dispose();
    this.hud = null;
    this.ctx = null;
  }
}

// 秒数を mm:ss 表記にする。
function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
