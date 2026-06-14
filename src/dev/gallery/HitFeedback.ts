import * as THREE from "three";

export type FeedbackZone = "head" | "body" | "graze" | "miss";

// 部位ごとの色とフロート表示文字。
const ZONE_COLOR: Record<FeedbackZone, number> = {
  head: 0xff3b30,
  body: 0x4ad6a0,
  graze: 0xffce5a,
  miss: 0x6b7280,
};
const ZONE_TEXT: Record<Exclude<FeedbackZone, "miss">, { label: string; color: string }> = {
  head: { label: "HEADSHOT", color: "#ffd23f" },
  body: { label: "BODY", color: "#7CFFB2" },
  graze: { label: "GRAZE", color: "#ffce5a" },
};

interface Marker {
  sprite: THREE.Sprite;
  born: number;
}
interface Popup {
  sprite: THREE.Sprite;
  born: number;
  y0: number;
}

// SHOOTING GALLERY の着弾フィードバック（DEV RANGE専用）。
// 命中点に光るマーカー、外し（壁/床）に弾痕、命中時に HEADSHOT/BODY/GRAZE のフロート表示。
export class HitFeedback {
  private markers: Marker[] = [];
  private popups: Popup[] = [];
  private holes: THREE.Mesh[] = [];

  private dotTex: THREE.Texture;
  private holeGeo: THREE.CircleGeometry;
  private holeMat: THREE.MeshBasicMaterial;
  private zoneTex: Record<"head" | "body" | "graze", THREE.Texture>;

  private readonly markerLife = 0.45; // 秒
  private readonly popupLife = 0.8;
  private readonly maxHoles = 80;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    this.dotTex = makeDotTexture();
    this.holeGeo = new THREE.CircleGeometry(0.07, 12);
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x0a0b0d, transparent: true, opacity: 0.85 });
    this.zoneTex = {
      head: makeTextTexture(ZONE_TEXT.head.label, ZONE_TEXT.head.color),
      body: makeTextTexture(ZONE_TEXT.body.label, ZONE_TEXT.body.color),
      graze: makeTextTexture(ZONE_TEXT.graze.label, ZONE_TEXT.graze.color),
    };
  }

  // 1発分の着弾。zone="miss" は壁/床の弾痕、それ以外は命中マーカー＋部位フロート。
  addImpact(point: THREE.Vector3, origin: THREE.Vector3, zone: FeedbackZone): void {
    if (zone === "miss") {
      this.addHole(point, origin);
      return;
    }
    this.addMarker(point, zone);
    this.addPopup(point, zone);
  }

  private addMarker(point: THREE.Vector3, zone: FeedbackZone): void {
    const mat = new THREE.SpriteMaterial({
      map: this.dotTex,
      color: ZONE_COLOR[zone],
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(point);
    sprite.scale.setScalar(0.22);
    this.scene.add(sprite);
    this.markers.push({ sprite, born: performance.now() / 1000 });
    if (this.markers.length > 60) this.disposeMarker(this.markers.shift()!);
  }

  private addPopup(point: THREE.Vector3, zone: FeedbackZone): void {
    if (zone === "miss") return;
    const mat = new THREE.SpriteMaterial({ map: this.zoneTex[zone], transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(point).add(new THREE.Vector3(0, 0.25, 0));
    sprite.scale.set(1.1, 0.34, 1);
    this.scene.add(sprite);
    this.popups.push({ sprite, born: performance.now() / 1000, y0: sprite.position.y });
    if (this.popups.length > 16) this.disposePopup(this.popups.shift()!);
  }

  private addHole(point: THREE.Vector3, origin: THREE.Vector3): void {
    const hole = new THREE.Mesh(this.holeGeo, this.holeMat);
    // 面のわずか手前（射手側）に置いて z ファイティングを避け、射手の方を向かせる。
    const toShooter = new THREE.Vector3().subVectors(origin, point).normalize();
    hole.position.copy(point).addScaledVector(toShooter, 0.02);
    hole.lookAt(origin);
    this.scene.add(hole);
    this.holes.push(hole);
    if (this.holes.length > this.maxHoles) {
      const old = this.holes.shift()!;
      this.scene.remove(old);
    }
  }

  update(now: number): void {
    // マーカー：拡大しながらフェード
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const a = (now - m.born) / this.markerLife;
      if (a >= 1) {
        this.disposeMarker(m);
        this.markers.splice(i, 1);
        continue;
      }
      (m.sprite.material as THREE.SpriteMaterial).opacity = 1 - a;
      m.sprite.scale.setScalar(0.22 + a * 0.25);
    }
    // フロート：上昇しながらフェード
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const a = (now - p.born) / this.popupLife;
      if (a >= 1) {
        this.disposePopup(p);
        this.popups.splice(i, 1);
        continue;
      }
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - a * a;
      p.sprite.position.y = p.y0 + a * 0.6;
    }
    // カメラ参照は将来の向き調整用（スプライトは常時ビルボード）。
    void this.camera;
  }

  // 的・プリセット切替時に世界上の演出を消す（統計DOMは別管理）。
  clearWorld(): void {
    for (const m of this.markers) this.disposeMarker(m);
    for (const p of this.popups) this.disposePopup(p);
    for (const h of this.holes) this.scene.remove(h);
    this.markers = [];
    this.popups = [];
    this.holes = [];
  }

  dispose(): void {
    this.clearWorld();
    this.dotTex.dispose();
    this.holeGeo.dispose();
    this.holeMat.dispose();
    this.zoneTex.head.dispose();
    this.zoneTex.body.dispose();
    this.zoneTex.graze.dispose();
  }

  private disposeMarker(m: Marker): void {
    this.scene.remove(m.sprite);
    (m.sprite.material as THREE.SpriteMaterial).dispose();
  }
  private disposePopup(p: Popup): void {
    this.scene.remove(p.sprite);
    (p.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

// 中心が明るく外周が透明な丸ドット。
function makeDotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.85)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 部位フロート文字（縁取り付き）。
function makeTextTexture(label: string, color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 80;
  const g = c.getContext("2d")!;
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 7;
  g.strokeStyle = "rgba(0,0,0,0.9)";
  g.strokeText(label, 128, 42);
  g.fillStyle = color;
  g.fillText(label, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
