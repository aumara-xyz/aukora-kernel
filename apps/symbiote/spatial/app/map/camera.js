// Aukora Spatial — minimal mat4 math + hand-written orbit camera.
// Behavioral spec follows OrbitControls (inertia, damping, wheel dolly) without
// vendoring it: ~200 lines is the whole cost of owning the camera.

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(out, eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[j * 4 + i] =
        a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
  }
  out.set(r);
  return out;
}

const FOV = Math.PI / 4;

export class OrbitCamera {
  constructor(canvas) {
    this.canvas = canvas;
    this.target = [0, 0, 0];
    this.dist = 120;
    this.theta = 0.6;
    this.phi = 1.15;
    this.vTheta = 0;
    this.vPhi = 0;
    this.vDist = 0;
    this.fly = null; // { fromT, toT, fromD, toD, t }
    this.moving = true;
    this._vp = new Float32Array(16);
    this._view = new Float32Array(16);
    this._proj = new Float32Array(16);
    this._attach();
  }

  _attach() {
    const c = this.canvas;
    let mode = null; // 'rotate' | 'pan'
    let lastX = 0, lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
      lastX = e.clientX; lastY = e.clientY;
      this.fly = null;
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (mode === 'rotate') {
        this.vTheta = -dx * 0.005;
        this.vPhi = -dy * 0.005;
        this.theta += this.vTheta;
        this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi + this.vPhi));
      } else {
        // pan in the camera plane, scaled to world units at target depth
        const scale = (2 * Math.tan(FOV / 2) * this.dist) / c.clientHeight;
        const [rx, ry, rz, ux, uy, uz] = this._basis();
        this.target[0] -= (dx * rx - dy * ux) * scale;
        this.target[1] -= (dx * ry - dy * uy) * scale;
        this.target[2] -= (dx * rz - dy * uz) * scale;
      }
      this.moving = true;
    });
    const end = () => { mode = null; c.classList.remove('dragging'); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.vDist = Math.max(-0.4, Math.min(0.4, e.deltaY * 0.0012));
      this.dist = Math.min(600, Math.max(8, this.dist * Math.exp(this.vDist)));
      this.fly = null;
      this.moving = true;
    }, { passive: false });
  }

  _basis() {
    // camera right + up vectors from spherical angles
    const st = Math.sin(this.theta), ct = Math.cos(this.theta);
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const fx = -sp * st, fy = -cp, fz = -sp * ct; // forward (target - eye), normalized
    const rx = ct, ry = 0, rz = -st;              // right (horizontal)
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return [rx, ry, rz, ux, uy, uz];
  }

  eye() {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    return [
      this.target[0] + this.dist * sp * Math.sin(this.theta),
      this.target[1] + this.dist * cp,
      this.target[2] + this.dist * sp * Math.cos(this.theta),
    ];
  }

  flyTo(target, dist) {
    this.fly = {
      fromT: [...this.target], toT: [...target],
      fromD: this.dist, toD: dist ?? this.dist,
      t: 0,
    };
    this.moving = true;
  }

  // Advance inertia + fly animation; returns true while frames are still needed.
  update() {
    let active = false;
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + 0.045);
      const e = 1 - Math.pow(1 - this.fly.t, 3); // ease-out cubic
      for (let i = 0; i < 3; i++) this.target[i] = this.fly.fromT[i] + (this.fly.toT[i] - this.fly.fromT[i]) * e;
      this.dist = this.fly.fromD + (this.fly.toD - this.fly.fromD) * e;
      if (this.fly.t >= 1) this.fly = null;
      active = true;
    }
    // inertia
    this.vTheta *= 0.92; this.vPhi *= 0.92; this.vDist *= 0.86;
    if (Math.abs(this.vTheta) > 0.0004 || Math.abs(this.vPhi) > 0.0004) {
      this.theta += this.vTheta;
      this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi + this.vPhi));
      active = true;
    }
    if (Math.abs(this.vDist) > 0.002) {
      this.dist = Math.min(600, Math.max(8, this.dist * Math.exp(this.vDist)));
      active = true;
    }
    if (this.moving) { active = true; this.moving = false; }
    return active;
  }

  viewProj(width, height) {
    perspective(this._proj, FOV, width / Math.max(1, height), 0.5, 4000);
    lookAt(this._view, this.eye(), this.target, [0, 1, 0]);
    return multiply(this._vp, this._proj, this._view);
  }

  pixFactor(height) {
    return height / (2 * Math.tan(FOV / 2));
  }
}
