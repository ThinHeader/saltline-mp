// Remote player avatars: procedural humanoid bodies, nametags,
// snapshot interpolation and client-side hit detection.
import { THREE, Vector3 } from "../vendor/three-r180.js";
import { clamp, damp, lerp } from "../core/math.js";

const INTERP_DELAY = 0.12;
const STAND_H = 1.8;
const CROUCH_H = 1.25;

function nameTagTexture(name, hue) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(6,10,14,0.72)";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = `hsl(${hue} 70% 55%)`;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.font = "700 62px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#e8eef2";
  g.fillText(String(name || "Breacher").slice(0, 14), 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAvatars(context) {
  const THREE = context.THREE;
  const root = new THREE.Group();
  root.name = "mp-avatars";
  context.scene.add(root);

  const map = new Map(); // id -> avatar

  // Procedural operator: helmet, chest rig, shoulder pads, segmented legs and a
  // proper rifle. Same low-poly box language as the rest of the game (no
  // textures, no downloaded assets), just enough pieces to read as a person at
  // 10-30m instead of a stack of crates.
  function buildBody(hue) {
    const g = new THREE.Group();
    const armor = 0x4f5a65,
      dark = 0x2d343b,
      light = 0x6a7480,
      accent = new THREE.Color().setHSL((hue / 360) % 1, 0.62, 0.46).getHex(),
      glow = new THREE.Color().setHSL((hue / 360) % 1, 0.95, 0.58);
    const matCache = new Map();
    const mat = (color, rough = 0.55, metal = 0.28, emissive = null, ei = 0) => {
      const key = color + "|" + rough + "|" + metal + "|" + (emissive ? 1 : 0);
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color,
          roughness: rough,
          metalness: metal,
          emissive: emissive || 0x000000,
          emissiveIntensity: emissive ? ei : 0,
        });
        matCache.set(key, m);
      }
      return m;
    };
    const box = (parent, w, h, d, color, x, y, z, opt) => {
      const o = opt || {};
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        mat(o.color != null ? o.color : color, o.rough, o.metal, o.emissive, o.ei),
      );
      m.position.set(x, y, z);
      m.castShadow = !o.noShadow;
      m.receiveShadow = false;
      parent.add(m);
      return m;
    };

    // ---- legs: pivot at the hip so they can swing while walking
    const legL = new THREE.Group(),
      legR = new THREE.Group();
    legL.position.set(-0.12, 0.92, 0);
    legR.position.set(0.12, 0.92, 0);
    const buildLeg = (parent) => {
      box(parent, 0.17, 0.4, 0.2, armor, 0, -0.2, 0); // thigh
      box(parent, 0.18, 0.09, 0.21, light, 0, -0.41, -0.01); // knee pad
      box(parent, 0.15, 0.34, 0.18, dark, 0, -0.62, 0.01); // shin
      box(parent, 0.18, 0.11, 0.3, dark, 0, -0.83, -0.05); // boot
    };
    buildLeg(legL);
    buildLeg(legR);
    g.add(legL, legR);

    // ---- core
    box(g, 0.44, 0.13, 0.31, dark, 0, 1.0, 0); // belt
    box(g, 0.38, 0.17, 0.26, armor, 0, 1.13, 0); // waist
    box(g, 0.48, 0.35, 0.3, armor, 0, 1.37, 0); // chest
    box(g, 0.3, 0.09, 0.03, accent, 0, 1.41, -0.16); // team stripe
    box(g, 0.32, 0.36, 0.17, dark, 0, 1.34, 0.22); // backpack
    box(g, 0.07, 0.07, 0.03, glow, 0, 1.46, 0.31, {
      emissive: glow,
      ei: 2.2,
      noShadow: true,
    }); // backpack lamp
    box(g, 0.05, 0.2, 0.05, light, 0.2, 1.2, 0.2, { noShadow: true }); // sling

    // ---- shoulders
    box(g, 0.18, 0.12, 0.29, light, -0.31, 1.5, 0);
    box(g, 0.18, 0.12, 0.29, light, 0.31, 1.5, 0);

    // ---- left arm (relaxed, static)
    box(g, 0.12, 0.33, 0.14, armor, -0.3, 1.28, 0);
    box(g, 0.11, 0.28, 0.13, dark, -0.3, 1.0, -0.03);
    box(g, 0.12, 0.14, 0.15, dark, -0.3, 0.83, -0.06);

    // ---- right arm: pivot at the shoulder, raised to the grip
    const armR = new THREE.Group();
    armR.position.set(0.31, 1.48, 0);
    box(armR, 0.12, 0.31, 0.14, armor, 0, -0.17, -0.06);
    box(armR, 0.11, 0.28, 0.13, dark, 0, -0.4, -0.14);
    box(armR, 0.12, 0.14, 0.15, dark, 0, -0.56, -0.19);
    g.add(armR);

    // ---- head
    box(g, 0.12, 0.09, 0.12, dark, 0, 1.57, 0); // neck
    box(g, 0.25, 0.26, 0.27, armor, 0, 1.73, 0.01); // helmet
    box(g, 0.09, 0.05, 0.26, light, 0, 1.87, 0.01); // helmet crest
    box(g, 0.2, 0.07, 0.04, glow, 0, 1.73, -0.14, {
      emissive: glow,
      ei: 3.4,
      noShadow: true,
    }); // visor
    box(g, 0.03, 0.1, 0.09, dark, 0.14, 1.72, 0); // ear pod
    box(g, 0.03, 0.1, 0.09, dark, -0.14, 1.72, 0);

    // ---- rifle, held across the chest
    const rifle = box(g, 0.08, 0.14, 0.52, 0x2a2e34, 0.13, 1.3, -0.34, {
      rough: 0.45,
      metal: 0.7,
    });
    box(g, 0.04, 0.04, 0.34, 0x1b1e22, 0.13, 1.33, -0.74, { metal: 0.8 });
    box(g, 0.07, 0.09, 0.22, 0x33383f, 0.13, 1.31, -0.56);
    box(g, 0.06, 0.17, 0.1, 0x1b1e22, 0.13, 1.17, -0.3); // magazine
    box(g, 0.05, 0.07, 0.12, 0x1b1e22, 0.13, 1.4, -0.36); // optic
    box(g, 0.02, 0.02, 0.02, glow, 0.13, 1.43, -0.42, {
      emissive: glow,
      ei: 2,
      noShadow: true,
    }); // reticle glow

    return { group: g, legL, legR, armR, rifle };
  }

  function add(id, name, index) {
    if (map.has(id)) return map.get(id);
    const hue = (index * 63 + 12) % 360;
    const body = buildBody(hue);
    root.add(body.group);
    const spriteMat = new THREE.SpriteMaterial({
      map: nameTagTexture(name, hue),
      transparent: true,
      depthWrite: false,
    });
    const tag = new THREE.Sprite(spriteMat);
    tag.scale.set(1.15, 0.29, 1);
    tag.position.y = 2.08;
    body.group.add(tag);
    const a = {
      id,
      name,
      hue,
      body,
      tag,
      alive: true,
      crouch: 0,
      walkPhase: 0,
      lastPos: new Vector3(),
      speed: 0,
      snaps: [], // {rt, pos, yaw, pitch, crouch, alive, sprint}
    };
    map.set(id, a);
    return a;
  }

  function remove(id) {
    const a = map.get(id);
    if (!a) return;
    root.remove(a.body.group);
    map.delete(id);
  }

  function clear() {
    for (const id of [...map.keys()]) remove(id);
  }

  function snapshot(id, s) {
    const a = map.get(id);
    if (!a) return;
    // s = [x,y,z,yaw,pitch,crouch,sprint,alive]
    a.snaps.push({
      rt: performance.now() / 1000,
      pos: new Vector3(s[0], s[1], s[2]),
      yaw: s[3],
      pitch: s[4],
      crouch: !!s[5],
      sprint: !!s[6],
      alive: !!s[7],
    });
    if (a.snaps.length > 30) a.snaps.shift();
  }

  function applyState(a, pos, yaw, crouch, alive, dt) {
    const g = a.body.group;
    g.visible = alive;
    a.alive = alive;
    if (!alive) return;
    a.speed = pos.distanceTo(a.lastPos) / Math.max(dt, 1e-4);
    a.lastPos.copy(pos);
    g.position.copy(pos);
    g.rotation.y = yaw;
    a.crouch = damp(a.crouch, crouch ? 1 : 0, 10, dt);
    const h = lerp(1, CROUCH_H / STAND_H, a.crouch);
    g.scale.set(1, h, 1);
    a.tag.position.y = 2.08 / h;
    // walk swing
    if (a.speed > 0.4) {
      a.walkPhase += a.speed * dt * 2.4;
      const sw =
        Math.sin(a.walkPhase * Math.PI) * clamp(a.speed / 6, 0.15, 0.8);
      a.body.legL.rotation.x = sw;
      a.body.legR.rotation.x = -sw;
      a.body.armR.rotation.x = -sw * 0.4;
    } else {
      a.body.legL.rotation.x = damp(a.body.legL.rotation.x, 0, 8, dt);
      a.body.legR.rotation.x = damp(a.body.legR.rotation.x, 0, 8, dt);
    }
  }

  function update(dt) {
    const now = performance.now() / 1000;
    const renderT = now - INTERP_DELAY;
    for (const a of map.values()) {
      if (!a.snaps.length) continue;
      // find surrounding snapshots
      let s0 = a.snaps[0],
        s1 = a.snaps[a.snaps.length - 1];
      for (let i = 0; i < a.snaps.length - 1; i++) {
        if (a.snaps[i].rt <= renderT && a.snaps[i + 1].rt >= renderT) {
          s0 = a.snaps[i];
          s1 = a.snaps[i + 1];
          break;
        }
      }
      let pos, yaw, crouch, alive;
      if (s0 === s1 || s1.rt <= s0.rt) {
        pos = s0.pos;
        yaw = s0.yaw;
        crouch = s0.crouch;
        alive = s0.alive;
      } else {
        const f = clamp((renderT - s0.rt) / (s1.rt - s0.rt), 0, 1);
        pos = s0.pos.clone().lerp(s1.pos, f);
        let dy = s1.yaw - s0.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        yaw = s0.yaw + dy * f;
        crouch = f > 0.5 ? s1.crouch : s0.crouch;
        alive = s1.alive || s0.alive;
      }
      // extrapolate if newest snapshot is older than delay (laggy sender)
      if (renderT > s1.rt) {
        const lead = Math.min(renderT - s1.rt, 0.25);
        pos = pos.clone();
        pos.x += Math.sin(yaw) * 0; // velocity estimate from snaps
        const prev = a.snaps[Math.max(0, a.snaps.length - 3)];
        if (prev && prev.rt < s1.rt) {
          const vdt = s1.rt - prev.rt;
          if (vdt > 0.01) {
            pos.x += ((s1.pos.x - prev.pos.x) / vdt) * lead;
            pos.z += ((s1.pos.z - prev.pos.z) / vdt) * lead;
          }
        }
      }
      // trim old snaps
      while (a.snaps.length > 2 && a.snaps[1].rt < renderT - 0.5)
        a.snaps.shift();
      applyState(a, pos, yaw, crouch, alive, dt);
    }
  }

  // Analytic capsule-ish hit test against alive avatars.
  // Returns { id, dist, point, part } or null.
  function raycast(origin, dir, maxDist) {
    const THREE_ = context.THREE;
    let best = null;
    for (const a of map.values()) {
      if (!a.alive || !a.body.group.visible) continue;
      const p = a.body.group.position;
      const topH = lerp(1.62, 1.1, a.crouch);
      // head sphere
      const headC = new Vector3(p.x, p.y + topH, p.z);
      let hit = sphereHit(origin, dir, headC, 0.24, maxDist);
      if (hit && (!best || hit.dist < best.dist))
        best = { ...hit, id: a.id, part: "head" };
      // body: two stacked spheres + cylinder approx via 3 spheres
      const r = 0.36;
      const centers = [0.45, 0.95, lerp(1.35, 0.9, a.crouch)];
      for (const cy of centers) {
        const c = new Vector3(p.x, p.y + cy, p.z);
        const h = sphereHit(origin, dir, c, r, maxDist);
        if (h && (!best || h.dist < best.dist))
          best = { ...h, id: a.id, part: "body" };
      }
    }
    if (best) best.point = origin.clone().addScaledVector(dir, best.dist);
    return best;
  }

  function sphereHit(origin, dir, center, radius, maxDist) {
    const oc = center.clone().sub(origin);
    const t = oc.dot(dir);
    if (t < 0 || t > maxDist) return null;
    const d2 = oc.lengthSq() - t * t;
    if (d2 > radius * radius) return null;
    const dist = t - Math.sqrt(radius * radius - d2);
    return { dist: Math.max(0.01, dist) };
  }

  // Short-range cone check for melee: closest live avatar inside range and arc.
  function meleeTarget(origin, dir, range = 2.6, arc = 0.55) {
    let best = null;
    for (const a of map.values()) {
      if (!a.alive || !a.body.group.visible) continue;
      const p = a.body.group.position;
      const center = new Vector3(p.x, p.y + lerp(1.05, 0.8, a.crouch), p.z);
      const to = center.clone().sub(origin);
      const d = to.length();
      if (d > range || d < 1e-4) continue;
      if (to.divideScalar(d).dot(dir) < arc) continue;
      if (!best || d < best.dist)
        best = { id: a.id, dist: d, point: center.clone() };
    }
    return best;
  }

  function alivePositions() {
    const out = [];
    for (const a of map.values())
      if (a.alive) out.push(a.body.group.position.clone());
    return out;
  }

  function count() {
    return map.size;
  }

  return {
    add,
    remove,
    clear,
    snapshot,
    update,
    raycast,
    meleeTarget,
    alivePositions,
    count,
    map,
  };
}

export { createAvatars };
