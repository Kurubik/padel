import * as THREE from "three";

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  return { c, g };
}

/** The playing surface with every padel line drawn in court metres. */
export function makeCourtTexture(): THREE.CanvasTexture {
  const W = 640;
  const H = 1280;
  const { c, g } = canvas(W, H);
  const px = W / 10;
  const py = H / 20;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1d4485");
  grad.addColorStop(0.5, "#193a73");
  grad.addColorStop(1, "#122d5c");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Subtle banding so the surface does not read as flat.
  g.globalAlpha = 0.06;
  for (let i = 0; i < 22; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#000000";
    g.fillRect(0, (i / 22) * H, W, H / 44);
  }
  g.globalAlpha = 1;
  const line = "#eef3ff";
  g.strokeStyle = line;
  g.lineCap = "butt";
  const lw = Math.max(3, Math.round(px * 0.055));
  g.lineWidth = lw;
  // Perimeter.
  g.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
  // Service lines, 3 m either side of the net.
  for (const y of [7, 13]) {
    g.beginPath();
    g.moveTo(0, y * py);
    g.lineTo(W, y * py);
    g.stroke();
  }
  // Centre service line between the two service lines.
  g.beginPath();
  g.moveTo(W / 2, 7 * py);
  g.lineTo(W / 2, 13 * py);
  g.stroke();
  // Net band.
  g.globalAlpha = 0.5;
  g.fillStyle = "#0a1a36";
  g.fillRect(0, 10 * py - 3, W, 6);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Woven wire mesh used above the glass on every wall. */
export function makeMeshTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "rgba(206, 222, 255, 0.75)";
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * S;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeNetTexture(): THREE.CanvasTexture {
  const S = 96;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "rgba(232, 240, 255, 0.9)";
  g.lineWidth = 1.6;
  for (let i = 0; i <= 12; i++) {
    const p = (i / 12) * S;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
  }
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * S;
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft additive sprite that keeps the ball readable against any background. */
export function makeBallGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(240, 255, 160, 0.95)");
  grad.addColorStop(0.35, "rgba(217, 255, 47, 0.5)");
  grad.addColorStop(1, "rgba(217, 255, 47, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeShadowTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  grad.addColorStop(0.6, "rgba(0, 0, 0, 0.22)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Numeric scoreboard texture for the back-wall scoreboard look on the HUD? kept for future use. */
export function makeRingTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.strokeStyle = "rgba(217, 255, 47, 0.95)";
  g.lineWidth = 7;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
