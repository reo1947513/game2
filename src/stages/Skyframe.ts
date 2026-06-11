import * as THREE from "three";
import { StageContext, Target } from "../Stage";

// ============================================================================
// STAGE 02 — SKYFRAME（建設中の高層ビル・夜間工事）
//
// コンセプトは縦特化。鉄骨とコンクリートの未完成タワーを、壁ジャンプ・段差ジャンプ・
// 飛び降りで縦横に駆け回れること、そして実在の工事現場として嘘がないディテールを
// 両立させる。物理の確定値（重力26・ジャンプ高1.42m・落下11m制限・シャフト幅4.0m・
// 足場刻み1.2m・フロア高3.6m）の帰結としてレベルを設計している。
//
// 座標系: x=東+, z=南+（Threeの前方は -z）。マップは±70。タワーは原点中心±15。
// フロア高: 1F=0 / 2F=3.6 / 3F=7.2 / 屋上=10.8。
// ============================================================================

// --- 色（コンクリート/鉄骨/鉄筋/型枠/足場/配管/養生/安全色） ---
const C_CONCRETE = 0x6b6f78;
const C_CONCRETE2 = 0x5d6169;
const C_STEEL = 0x3a4250;
const C_STEEL_LT = 0x8a93a0;
const C_REBAR = 0x6e3b2a;
const C_FORMWORK = 0xb89048;
const C_BOARD = 0x9a8050;
const C_NET = 0x123a28;
const C_TARP = 0x2a5cc0;
const C_CONE = 0xff6a00;
const C_FLOOD = 0xf4f6ff;
const C_PANEL = 0xf2d21a;

const F2 = 3.6;
const F3 = 7.2;
const ROOF = 10.8;
const SH = 2.3; // シャフト外面の半幅（内法4.0＝内面±2.0、厚0.3）

// SKYFRAMEを構築し、プレイヤーのスポーン位置を返す。
export function buildSkyframe(ctx: StageContext): THREE.Vector3 {
  const { scene, group, colliders, targets, addBox, addUpdater } = ctx;

  // 上面を topY に合わせた水平スラブ（床板）。span から箱寸法を作る。
  const slab = (
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    topY: number,
    color: number,
    collidable = true
  ): void => {
    addBox(
      x1 - x0,
      0.3,
      z1 - z0,
      (x0 + x1) / 2,
      topY - 0.15,
      (z0 + z1) / 2,
      color,
      collidable
    );
  };

  // span 指定の任意ボックス（壁・梁など）。
  const span = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: number,
    collidable = true
  ): void => {
    addBox(
      x1 - x0,
      y1 - y0,
      z1 - z0,
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      (z0 + z1) / 2,
      color,
      collidable
    );
  };

  // 視覚専用の円柱（単管・鉄筋・配管・支保工・ワイヤーなど）。当たり判定は持たせない。
  const vcyl = (
    rTop: number,
    rBot: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: number,
    rotX = 0,
    rotZ = 0,
    emissive = 0,
    emissiveIntensity = 0
  ): THREE.Mesh => {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, 10);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.35,
      emissive: new THREE.Color(emissive),
      emissiveIntensity,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    m.rotation.z = rotZ;
    m.castShadow = true;
    group.add(m);
    return m;
  };

  // 視覚専用の発光球（障害灯・コア等）。
  const vsphere = (
    r: number,
    x: number,
    y: number,
    z: number,
    color: number,
    emissiveIntensity = 1
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(r, 12, 10);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity,
      roughness: 0.4,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  // 投光器（三脚＋ヘッド＋強い白色ポイントライト）。暗がりを残すため数を絞って置く。
  const floodlight = (x: number, z: number, baseY = 0, intensity = 1.3, dist = 24): void => {
    const headY = baseY + 3.0;
    // 三脚
    vcyl(0.04, 0.04, 3.1, x - 0.25, baseY + 1.5, z, 0x202428, 0, 0.16);
    vcyl(0.04, 0.04, 3.1, x + 0.18, baseY + 1.5, z - 0.2, 0x202428, 0.12, -0.1);
    vcyl(0.04, 0.04, 3.1, x + 0.18, baseY + 1.5, z + 0.2, 0x202428, -0.12, -0.1);
    // ヘッド
    addBox(0.5, 0.34, 0.28, x, headY, z, 0xe8ecf5, false);
    const light = new THREE.PointLight(C_FLOOD, intensity, dist, 1.6);
    light.position.set(x, headY, z);
    scene.add(light);
  };

  // ====================================================================
  // 1. ライティング・空気感（夜間工事）
  // ====================================================================
  scene.background = new THREE.Color(0x0b0e16);
  scene.fog = new THREE.Fog(0x0b0e16, 34, 130);

  const amb = new THREE.AmbientLight(0x223044, 0.26);
  scene.add(amb);

  // 月光（弱い寒色のDirectionalLight・影あり）1灯のみ
  const moon = new THREE.DirectionalLight(0x7e96c8, 0.55);
  moon.position.set(-55, 85, -45);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 220;
  const sd = 80;
  moon.shadow.camera.left = -sd;
  moon.shadow.camera.right = sd;
  moon.shadow.camera.top = sd;
  moon.shadow.camera.bottom = -sd;
  scene.add(moon);

  const hemi = new THREE.HemisphereLight(0x1a2740, 0x05070c, 0.3);
  scene.add(hemi);

  // 投光器：地上ヤードに4基、各フロアに1〜2基。全域を均一に照らさず暗がりを残す。
  floodlight(-26, 30, 0, 1.5, 30); // 南西ヤード
  floodlight(28, 22, 0, 1.4, 28); // 南東ヤード
  floodlight(-34, -20, 0, 1.4, 30); // 北西（クレーン寄り）
  floodlight(20, -30, 0, 1.3, 26); // 北東ヤード
  floodlight(10, F2, -10, 1.0, 16); // 2F
  floodlight(-9, F3, 7, 1.0, 16); // 3F
  floodlight(12, ROOF, 10, 1.1, 18); // 屋上

  // ====================================================================
  // 2. 地面・外周（±70）
  // ====================================================================
  const floorGeo = new THREE.PlaneGeometry(140, 140, 1, 1);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f15,
    roughness: 0.96,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // 床の当たり判定（上面 y=0）
  colliders.push(
    new THREE.Box3(new THREE.Vector3(-70, -2, -70), new THREE.Vector3(70, 0, 70))
  );

  // 外周壁
  span(-70, 70, 0, 12, -71, -70, 0x12161f); // 北
  span(-70, 70, 0, 12, 70, 71, 0x12161f); // 南
  span(70, 71, 0, 12, -70, 70, 0x12161f); // 東
  span(-71, -70, 0, 12, -70, 70, 0x12161f); // 西

  // 街の夜景（外周の外側に遠景ビルのシルエット＋窓明かり。フォグで霞む）
  buildSkyline(group);

  // ====================================================================
  // 3. タワー躯体（±15、4層スラブ・床抜け開口つき）
  // ====================================================================
  // 1F は地面そのもの。2F/3F/屋上のスラブを開口付きで構築する。
  // 各フロアの飛び降り開口（drop-down）は A=北側 / B=南側。
  buildFloor(slab, F2, C_CONCRETE, [3, 9, -12, -6], [-9, -3, 6, 12]);
  buildFloor(slab, F3, C_CONCRETE2, [-12, -6, -11, -5], [5, 11, 5, 11]);
  buildFloor(slab, ROOF, C_CONCRETE, [5, 11, -11, -5], [-11, -5, 5, 11]);

  // 四隅の鉄骨柱（1F〜屋上を貫通）と、屋上から上へ突き出す建方中の柱
  for (const [cx, cz] of [
    [-14, -14],
    [14, -14],
    [-14, 14],
    [14, 14],
  ]) {
    span(cx - 0.3, cx + 0.3, 0, ROOF + 0.3, cz - 0.3, cz + 0.3, C_STEEL);
    // 屋上から上へ突き出す柱（建方の最前線・登れない視覚要素）
    vcyl(0.18, 0.18, 3.0, cx, ROOF + 1.5, cz, C_STEEL);
  }
  // 中間の梁（各層の外周梁を一部だけ）
  for (const h of [F2, F3, ROOF]) {
    span(-15, 15, h - 0.05, h + 0.35, -15, -14.7, C_STEEL); // 北梁
    span(-15, 15, h - 0.05, h + 0.35, 14.7, 15, C_STEEL); // 南梁
  }
  // 屋上のみ：一部だけ架かった梁（鉄骨建方の途中）
  span(-15, 4, ROOF + 0.4, ROOF + 0.7, -0.2, 0.2, C_STEEL);
  span(-12, -11.6, ROOF, ROOF + 2.4, -12, 12, C_STEEL); // 立ち上がり柱

  // 端部養生の単管手すり（開口の縁。高さ0.4・ジャンプで越えられる視覚要素）
  railing(span, [3, 9, -12, -6], F2);
  railing(span, [-9, -3, 6, 12], F2);
  railing(span, [-12, -6, -11, -5], F3);
  railing(span, [5, 11, 5, 11], F3);
  railing(span, [5, 11, -11, -5], ROOF);
  railing(span, [-11, -5, 5, 11], ROOF);

  // ====================================================================
  // 4. エレベーターシャフト（コア・内法4.0m・壁ジャン直登）
  // ====================================================================
  // 北・東・西の壁は全高ソリッド。南壁のみ各層に1.5m幅の出入り開口。
  span(-SH, SH, 0, ROOF, -SH, -2.0, C_CONCRETE2); // 北壁
  span(2.0, SH, 0, ROOF, -2.0, 2.0, C_CONCRETE2); // 東壁
  span(-SH, -2.0, 0, ROOF, -2.0, 2.0, C_CONCRETE2); // 西壁
  // 南壁（z=2.0..2.3）：x[-0.75,0.75]・各層 y[H,H+2.2] を開口として抜く
  span(-SH, -0.75, 0, ROOF, 2.0, SH, C_CONCRETE2); // 南壁・左柱
  span(0.75, SH, 0, ROOF, 2.0, SH, C_CONCRETE2); // 南壁・右柱
  span(-0.75, 0.75, 0, F2, 2.0, SH, C_CONCRETE2); // 2F扉の下
  span(-0.75, 0.75, F2 + 2.2, F3, 2.0, SH, C_CONCRETE2); // 2F扉と3F扉の間
  span(-0.75, 0.75, F3 + 2.2, ROOF, 2.0, SH, C_CONCRETE2); // 3F扉の上
  // ピット（シャフト底）の資材
  addBox(1.2, 0.6, 1.2, 0, 0.3, 0, C_STEEL);
  vcyl(0.08, 0.08, 1.6, 0.5, 0.8, -0.4, C_STEEL_LT, 0.2, 0);

  // ====================================================================
  // 5. 外周仮設足場（1.2m刻みで螺旋周回・一部欠落）
  // ====================================================================
  // 板は幅1.2mの薄い箱。半径≈16.5でタワー外周を時計回りに上がる。
  // [中心x, 中心z, 高さ, x幅, z幅, 欠落フラグ]
  const boards: Array<[number, number, number, number, number, boolean]> = [
    [0, 16.8, 1.2, 6, 1.2, false], // 南
    [8, 16.0, 2.4, 6, 1.2, false], // 南東
    [16.0, 8, 3.6, 1.2, 6, false], // 東
    [16.8, 0, 4.8, 1.2, 6, true], // 東（欠落）
    [16.0, -8, 6.0, 1.2, 6, false], // 北東
    [8, -16.0, 7.2, 6, 1.2, false], // 北
    [-8, -16.0, 8.4, 6, 1.2, true], // 北西（欠落）
    [-16.0, -8, 9.6, 1.2, 6, false], // 西
    [-16.0, 8, 10.8, 1.2, 6, false], // 西（屋上高）
  ];
  for (const [bx, bz, by, sx, sz, missing] of boards) {
    if (missing) continue; // 未設置区画＝隙間ジャンプ
    slab(bx - sx / 2, bx + sx / 2, bz - sz / 2, bz + sz / 2, by, C_BOARD);
    // 支柱（単管）。視覚のみ。
    vcyl(0.05, 0.05, by, bx - sx / 2 + 0.2, by / 2, bz - sz / 2 + 0.2, C_STEEL_LT);
    vcyl(0.05, 0.05, by, bx + sx / 2 - 0.2, by / 2, bz + sz / 2 - 0.2, C_STEEL_LT);
  }

  // ====================================================================
  // 6. 資材スタックの屋内ルート（地上→2F→3F→屋上）
  // ====================================================================
  // 南ヤードから木箱の段で2F南縁(z=15,H=3.6)へ
  addBox(2.4, 1.2, 2.4, 0, 0.6, 30, C_FORMWORK); // 上面1.2
  addBox(2.4, 2.4, 2.4, 0, 1.2, 26, 0x8f7a3a); // 上面2.4
  addBox(2.6, 3.6, 2.6, 0, 1.8, 21, C_FORMWORK); // 上面3.6 → 2Fへ
  // 2F上：型枠スタックの階段で3F(7.2)へ
  addBox(2.2, 4.8, 2.2, 6, 2.4, 9, 0x8f7a3a); // 上面4.8
  addBox(2.2, 6.0, 2.2, 9, 3.0, 4, C_FORMWORK); // 上面6.0
  addBox(2.4, 7.2, 2.4, 11, 3.6, 0, 0x8f7a3a); // 上面7.2 → 3Fへ
  // 3F上：サポート資材で屋上(10.8)へ
  addBox(2.0, 8.4, 2.0, 6, 4.2, -8, C_FORMWORK); // 上面8.4
  addBox(2.0, 9.6, 2.0, 2, 4.8, -10, 0x8f7a3a); // 上面9.6
  addBox(2.2, 10.8, 2.2, -3, 5.4, -8, C_FORMWORK); // 上面10.8 → 屋上へ

  // ====================================================================
  // 7. 地上ヤード（資材置場・プレハブ・生コン車・トイレ・洗車ピット）
  // ====================================================================
  // プレハブ事務所（屋根に登れる・高さ2.6）
  addBox(8, 2.6, 5, -30, 1.3, 24, 0x3a4658);
  addBox(8.2, 0.2, 5.2, -30, 2.6, 24, 0x2c3644); // 屋根
  // 生コン車（ドラム＋シャシ。当たり判定は箱で簡略）
  addBox(3, 1.6, 7, 30, 0.8, -8, 0x6b2b2b);
  vcyl(1.4, 1.1, 4.0, 30, 2.4, -9, 0xb0b6c0, Math.PI / 2 - 0.5, 0); // ミキサードラム（視覚）
  // 仮設トイレ2基
  addBox(1.3, 2.2, 1.3, -38, 1.1, 6, 0x2f6f4f);
  addBox(1.3, 2.2, 1.3, -38, 1.1, 8, 0x2f6f4f);
  // 洗車ピット（縁石の低い箱で囲う）
  span(20, 30, 0, 0.25, 30, 40, 0x33373f);
  // 資材置場：H鋼の山（角材を井桁組み・視覚）と配管材の束
  hPile(vcyl, 24, 0, -28);
  pipeBundle(vcyl, -22, 0, 34);
  // フォークリフト（箱の組合せ）
  addBox(1.6, 1.0, 2.6, 16, 0.5, 28, C_PANEL);
  addBox(1.4, 1.4, 0.6, 16, 1.2, 27, 0x2a2a2a);
  vcyl(0.06, 0.06, 2.2, 16, 1.6, 29.2, 0x202020); // マスト（視覚）

  // ====================================================================
  // 8. タワークレーン（北西ヤード。屋上→ジブ一本橋の一方向）
  // ====================================================================
  const mastX = -40;
  const mastZ = -40;
  // マスト基部（当たり判定あり）＋格子マスト（視覚・15mまで）
  addBox(2.4, 1.0, 2.4, mastX, 0.5, mastZ, C_STEEL);
  for (let i = 0; i < 4; i++) {
    const ox = i < 2 ? -0.9 : 0.9;
    const oz = i % 2 === 0 ? -0.9 : 0.9;
    vcyl(0.1, 0.1, 15, mastX + ox, 7.5, mastZ + oz, C_PANEL);
  }
  // ジブ（水平腕）の歩行床：屋上北西角(-15,-15)の上空へ張り出す一本橋（幅1.2m, y≈11.2）。
  // 落下は必ず屋上(10.8)か3F足場に着地する位置関係（屋上footprint内）。
  // 歩行できるジブは屋上から+1.2m（ジャンプで届く）の一本橋。屋上footprint内に収め、
  // 橋から落ちても必ず屋上(10.8)に着地する（落差1.2m＝11m制限を厳守）。
  const jibY = 12.0;
  slab(-15, -3, -14.8, -13.6, jibY, C_STEEL_LT); // 幅1.2mの一本橋（屋上北西の上空）
  // ジブのトラス上弦（視覚）とマストへ続く腕
  vcyl(0.12, 0.12, 30, (mastX - 9) / 2, jibY + 1.0, (mastZ - 14) / 2, C_PANEL, 0, Math.PI / 2 - 0.7);
  // フックから吊り荷（H鋼束）をワイヤーで吊る（屋上の上空・静止・視覚）
  vcyl(0.02, 0.02, 2.6, -9, jibY - 1.3, -14, 0x111111); // ワイヤー
  addBox(2.4, 0.5, 0.5, -9, jibY - 2.8, -14, C_STEEL); // 吊り荷

  // 障害灯（マスト頂部・ジブ橋の端）。1秒周期で明滅。
  const mastLamp = vsphere(0.25, mastX, 15.2, mastZ, 0xff2a2a, 1.2);
  const jibLamp = vsphere(0.22, -3, jibY + 0.3, -14, 0xff2a2a, 1.2);
  const mastPL = new THREE.PointLight(0xff2a2a, 0.6, 12);
  mastPL.position.set(mastX, 15.2, mastZ);
  scene.add(mastPL);

  // ====================================================================
  // 9. フロアごとの工程の物語＋建築ディテール語彙
  // ====================================================================
  // 1F：躯体完成・資材搬入階（パレット積みセメント袋・配管束・フォークは§7）
  addBox(2.0, 1.6, 1.4, -8, 0.8, -6, 0x9a9488); // セメント袋パレット
  addBox(2.0, 1.0, 1.4, -8, 1.9, -6, 0x8c8678); // 段積み
  addBox(1.8, 1.4, 1.2, 8, 0.7, 7, 0x9a9488);
  pipeBundle(vcyl, 11, 0, -10);

  // 2F：配筋工事中（スラブ開口の縁から鉄筋が林立・鉄筋マット）
  rebarForest(vcyl, 3, F2, -3); // 開口Aの縁
  rebarForest(vcyl, -6, F2, 9); // 開口Bの縁
  rebarMat(vcyl, -8, F2, -8);

  // 3F：型枠・打設準備（合板型枠の壁・サポート支柱・コンクリートバケット）
  span(-12, -8, F3, F3 + 1.8, -2, -1.8, C_FORMWORK); // 合板型枠の壁
  span(8, 8.2, F3, F3 + 1.8, -6, 2, C_FORMWORK);
  supportPosts(vcyl, -6, F3, -6); // サポート支柱（天井まで・視覚）
  supportPosts(vcyl, 9, F3, 8);
  addBox(1.4, 1.6, 1.4, 4, F3 + 0.8, -10, 0x55585e); // コンクリートバケット

  // 屋上：鉄骨建方の最前線（安全ネット・溶接火花）
  // 安全ネット：半透明の濃緑の薄い箱。落下受けの1枚のみ当たり判定あり。
  netPanel(addBox, -14, -2, 12, 14.6, ROOF - 0.2, true); // 落下受け（当たり判定）
  netPanel(addBox, 4, 14.6, -14.6, -12, ROOF + 0.4, false); // 視覚のみ

  // ====================================================================
  // 10. 建築ディテール語彙集（各3箇所以上）
  // ====================================================================
  // ブルーシート（風で張った設定の静的な傾き）
  tarp(group, -24, 1.2, 18, 0.5);
  tarp(group, 26, 1.0, 14, -0.4);
  tarp(group, 6, F3 + 0.6, 6, 0.3);
  // カラーコーン＋コーンバー
  coneRow(vcyl, addBox, -10, 36);
  coneRow(vcyl, addBox, 14, 34);
  coneRow(vcyl, addBox, -2, -12.5, F2); // 2F開口前
  // 単管バリケード（視覚）
  barricade(vcyl, -18, 26);
  barricade(vcyl, 22, 30);
  barricade(vcyl, 0, 12);
  // 安全第一の看板（白帯＋赤帯のパネル・エミッシブ）
  signBoard(addBox, -30, 2.6, 20);
  signBoard(addBox, 18, 2.4, -18);
  signBoard(addBox, -2, F2 + 1.4, 14.6);
  // 仮設分電盤（黄色＋黒帯）
  distroBox(addBox, -34, 0, 28);
  distroBox(addBox, 30, 0, 18);
  distroBox(addBox, 9, F3, 6);
  // 消火器（赤い小シリンダー・視覚）
  vcyl(0.18, 0.18, 0.6, -29.4, 0.3, 22, 0xd11a1a);
  vcyl(0.18, 0.18, 0.6, 9, F3 + 0.3, 6.6, 0xd11a1a);
  vcyl(0.18, 0.18, 0.6, 0.6, 0.3, 13, 0xd11a1a);

  // ====================================================================
  // 11. 動的演出（障害灯の明滅・溶接火花）
  // ====================================================================
  // 溶接火花：屋上の1箇所。青白いポイントライトを不規則に明滅＋加算の小球を散らす。
  const weldX = -10;
  const weldZ = -2;
  const weldY = ROOF + 0.5;
  const weldLight = new THREE.PointLight(0x9fc8ff, 0, 8);
  weldLight.position.set(weldX, weldY, weldZ);
  scene.add(weldLight);
  const sparks: THREE.Mesh[] = [];
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xbfe0ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 5; i++) {
    const sg = new THREE.SphereGeometry(0.05, 6, 5);
    const sm = new THREE.Mesh(sg, sparkMat.clone());
    sm.position.set(weldX, weldY, weldZ);
    sm.visible = false;
    group.add(sm);
    sparks.push(sm);
  }

  // 障害灯（1秒周期）と溶接火花の更新を登録する。
  addUpdater((now: number) => {
    const on = Math.sin(now * Math.PI * 2) > 0 ? 1 : 0;
    (mastLamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.4 : 0.15;
    (jibLamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.4 : 0.15;
    mastPL.intensity = on ? 0.7 : 0.05;

    // 溶接：不規則な明滅。発光時に火花を散らす。
    const flick = Math.sin(now * 47) * Math.sin(now * 13);
    const arc = flick > 0.5;
    weldLight.intensity = arc ? 2.2 + (flick - 0.5) * 4 : 0.0;
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      if (arc) {
        s.visible = true;
        const t = (now * (3 + i)) % 1;
        s.position.set(
          weldX + Math.sin(now * (9 + i) + i) * 0.6,
          weldY + t * 0.9,
          weldZ + Math.cos(now * (7 + i) + i) * 0.6
        );
        (s.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      } else {
        s.visible = false;
      }
    }
  });

  // ====================================================================
  // 12. 撃てる的（TargetRush/MovingRange 用）
  // ====================================================================
  const targetPos: Array<[number, number, number]> = [
    [-26, 1.2, 30],
    [28, 1.2, 22],
    [0, 1.2, 36],
    [8, F2 + 1.2, 6],
    [-8, F3 + 1.2, -6],
    [10, ROOF + 1.2, 8],
  ];
  for (const [x, y, z] of targetPos) {
    addTarget(group, targets, x, y, z);
  }

  // プレイヤースポーン：地上ヤード南側のゲート前（タワーを向く）
  return new THREE.Vector3(0, 0, 42);
}

// --- フロア（30×30スラブ）を、中央シャフト空隙＋2つの飛び降り開口を残して構築 ---
function buildFloor(
  slab: (x0: number, x1: number, z0: number, z1: number, topY: number, color: number, collidable?: boolean) => void,
  H: number,
  color: number,
  A: [number, number, number, number], // 北側の開口 [x0,x1,z0,z1]（z<0）
  B: [number, number, number, number] // 南側の開口 [x0,x1,z0,z1]（z>0）
): void {
  const [ax0, ax1, az0, az1] = A;
  const [bx0, bx1, bz0, bz1] = B;
  // 北域（z[-15,-SH]）から開口Aを抜く
  slab(-15, ax0, -15, -SH, H, color);
  slab(ax1, 15, -15, -SH, H, color);
  slab(ax0, ax1, -15, az0, H, color);
  slab(ax0, ax1, az1, -SH, H, color);
  // 南域（z[SH,15]）から開口Bを抜く
  slab(-15, bx0, SH, 15, H, color);
  slab(bx1, 15, SH, 15, H, color);
  slab(bx0, bx1, SH, bz0, H, color);
  slab(bx0, bx1, bz1, 15, H, color);
  // 東西の中央帯（シャフトの左右）
  slab(SH, 15, -SH, SH, H, color);
  slab(-15, -SH, -SH, SH, H, color);
}

// --- 開口の縁の単管手すり（高さ0.4・視覚のみ） ---
function railing(
  span: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, collidable?: boolean) => void,
  rect: [number, number, number, number],
  H: number
): void {
  const [x0, x1, z0, z1] = rect;
  span(x0, x1, H, H + 0.4, z0, z0 + 0.06, C_STEEL_LT, false);
  span(x0, x1, H, H + 0.4, z1 - 0.06, z1, C_STEEL_LT, false);
  span(x0, x0 + 0.06, H, H + 0.4, z0, z1, C_STEEL_LT, false);
  span(x1 - 0.06, x1, H, H + 0.4, z0, z1, C_STEEL_LT, false);
}

// --- 遠景ビル群のシルエット＋窓明かり ---
function buildSkyline(group: THREE.Group): void {
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    const r = 95 + (i % 5) * 6;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const w = 8 + (i % 4) * 4;
    const h = 18 + ((i * 7) % 34);
    const geo = new THREE.BoxGeometry(w, h, w);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0d1420 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, h / 2, z);
    m.lookAt(0, h / 2, 0);
    group.add(m);
    // 窓明かり（点灯率高め）
    const winGeo = new THREE.BoxGeometry(w * 0.9, h * 0.9, w * 0.9);
    const winMat = new THREE.MeshBasicMaterial({
      color: 0xffd98a,
      transparent: true,
      opacity: 0.12 + ((i * 13) % 10) * 0.012,
    });
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.copy(m.position);
    win.quaternion.copy(m.quaternion);
    group.add(win);
  }
}

// --- H鋼の井桁積み（視覚） ---
function hPile(vcyl: VCyl, x: number, y: number, z: number): void {
  for (let layer = 0; layer < 4; layer++) {
    const yy = y + 0.25 + layer * 0.5;
    const horiz = layer % 2 === 0;
    for (let k = -1; k <= 1; k++) {
      if (horiz) vcyl(0.18, 0.18, 5, x, yy, z + k * 1.2, 0x4a525e, 0, Math.PI / 2);
      else vcyl(0.18, 0.18, 5, x + k * 1.2, yy, z, 0x4a525e, Math.PI / 2, 0);
    }
  }
}

// --- 配管材の束（視覚） ---
function pipeBundle(vcyl: VCyl, x: number, y: number, z: number): void {
  for (let i = 0; i < 6; i++) {
    const ox = (i % 3) * 0.32 - 0.32;
    const oy = Math.floor(i / 3) * 0.3;
    vcyl(0.14, 0.14, 4.4, x + ox, y + 0.3 + oy, z, C_STEEL_LT, Math.PI / 2, 0);
  }
}

// --- 鉄筋の林立（開口の縁から突き出す・視覚） ---
function rebarForest(vcyl: VCyl, x: number, H: number, z: number): void {
  for (let i = 0; i < 10; i++) {
    const ox = (i % 5) * 0.35 - 0.7;
    const oz = Math.floor(i / 5) * 0.4;
    vcyl(0.03, 0.03, 1.6, x + ox, H + 0.8, z + oz, C_REBAR);
  }
}

// --- 結束済みの鉄筋マット（格子・視覚） ---
function rebarMat(vcyl: VCyl, x: number, H: number, z: number): void {
  for (let i = -2; i <= 2; i++) {
    vcyl(0.025, 0.025, 5, x + i * 0.6, H + 0.06, z, C_REBAR, Math.PI / 2, 0);
    vcyl(0.025, 0.025, 5, x, H + 0.06, z + i * 0.6, C_REBAR, 0, Math.PI / 2);
  }
}

// --- サポート支柱（床から天井まで・視覚。当たり判定は持たせない） ---
function supportPosts(vcyl: VCyl, x: number, H: number, z: number): void {
  for (let i = 0; i < 6; i++) {
    const ox = (i % 3) * 1.0 - 1.0;
    const oz = Math.floor(i / 3) * 1.0 - 0.5;
    vcyl(0.05, 0.05, 3.4, x + ox, H + 1.7, z + oz, C_STEEL_LT);
  }
}

// --- 安全ネット（半透明の濃緑の薄い箱。collidableで落下受けにもなる） ---
function netPanel(
  addBox: AddBox,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  collidable: boolean
): void {
  const m = addBox(x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, C_NET, collidable);
  const mat = m.material as THREE.MeshStandardMaterial;
  mat.transparent = true;
  mat.opacity = 0.5;
}

// --- ブルーシート（斜めに張った薄板・視覚） ---
function tarp(group: THREE.Group, x: number, y: number, z: number, tilt: number): void {
  const geo = new THREE.BoxGeometry(3.2, 0.05, 2.4);
  const mat = new THREE.MeshStandardMaterial({ color: C_TARP, roughness: 0.8 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.z = tilt;
  m.rotation.x = 0.15;
  group.add(m);
}

// --- カラーコーン＋コーンバー（視覚） ---
function coneRow(vcyl: VCyl, addBox: AddBox, x: number, z: number, y = 0): void {
  for (let i = 0; i < 3; i++) {
    vcyl(0.04, 0.22, 0.5, x + i * 1.4, y + 0.25, z, C_CONE);
    addBox(0.5, 0.5, 0.04, x + i * 1.4, y + 0.04, z, C_CONE, false);
  }
  // コーンバー（横棒）
  addBox(2.8, 0.05, 0.05, x + 1.4, y + 0.45, z, C_PANEL, false);
}

// --- 単管バリケード（視覚） ---
function barricade(vcyl: VCyl, x: number, z: number): void {
  vcyl(0.05, 0.05, 1.0, x - 1, 0.5, z, C_STEEL_LT);
  vcyl(0.05, 0.05, 1.0, x + 1, 0.5, z, C_STEEL_LT);
  vcyl(0.04, 0.04, 2.2, x, 0.9, z, C_PANEL, 0, Math.PI / 2);
}

// --- 安全第一の看板（白帯＋赤帯のパネル・エミッシブ） ---
function signBoard(addBox: AddBox, x: number, y: number, z: number): void {
  addBox(1.8, 0.6, 0.05, x, y + 0.4, z, 0xf4f4f4, false); // 白帯
  const red = addBox(1.8, 0.25, 0.06, x, y, z, 0xd11a1a, false)
    .material as THREE.MeshStandardMaterial;
  red.emissive = new THREE.Color(0xd11a1a); // 赤帯（エミッシブ）
  red.emissiveIntensity = 0.4;
}

// --- 仮設分電盤（黄色＋黒帯） ---
function distroBox(addBox: AddBox, x: number, baseY: number, z: number): void {
  addBox(0.7, 1.1, 0.4, x, baseY + 0.55, z, C_PANEL, false);
  addBox(0.72, 0.18, 0.42, x, baseY + 0.8, z, 0x1a1a1a, false);
}

// --- 撃てる的1体を追加 ---
function addTarget(
  group: THREE.Group,
  targets: Target[],
  x: number,
  y: number,
  z: number
): void {
  const geo = new THREE.BoxGeometry(1.2, 2.0, 0.6);
  const baseColor = new THREE.Color(0xff5a3c);
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor.clone(),
    emissive: new THREE.Color(0x551a10),
    roughness: 0.5,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  targets.push({ mesh, box, alive: true, respawnAt: 0, baseColor });
}

// 補助関数の型エイリアス（可読性のため）
type VCyl = (
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number,
  rotX?: number,
  rotZ?: number,
  emissive?: number,
  emissiveIntensity?: number
) => THREE.Mesh;

type AddBox = (
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  color: number,
  collidable?: boolean
) => THREE.Mesh;
