/* =========================================================================
   RENDER3D — die Bühne. Ändert NIE den Spielzustand.
   =========================================================================
   Eine Einheit ist ein METER (früher: ein Kästchen). Die Arena ist 200 m
   breit, ein Bike ist knapp zwei Meter lang — deshalb sieht man von oben
   fast nichts und deshalb ist die Verfolgerkamera hier der Normalfall,
   genau wie im Original.

   Der wichtigste Unterschied zur Rasterfassung: eine Lichtmauer ist
   keine Reihe von Klötzchen mehr, sondern eine dünne WAND pro Strecke.
   Sie wird jeden Frame aus dem Zustand neu aufgebaut — bei ein paar
   hundert Strecken kostet das nichts und spart jede Buchhaltung darüber,
   welches Stück schon steht (und welches hinten schon wieder weg ist,
   denn die Mauern sind endlich lang).
   ========================================================================= */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PALETTE, RULES } from "./config.js";

/* Maße der Bühne, alles in Metern. */
const WALL_H     = 4.0;     // Höhe einer Lichtmauer
const WALL_THICK = 0.30;    // …und ihre Dicke. DAS ist die "dünne Linie".
const EDGE_H     = 0.16;    // die helle Kante obendrauf
const RIM_H      = 5.0;     // die Aussenmauer
const BIKE_SCALE = 1.7;     // Modell ist ~1,2 Einheiten lang → ~2 m
const MAX_SEGS   = 4000;    // Vorrat an Wand-Instanzen
/* ==================================================================
   EIN BIKE BAUEN
   ==================================================================
   Kein Download, kein 3D-Programm: das Modell besteht aus Kegel,
   Kapsel, Ringen und abgerundeten Kisten. Ein Lightcycle ist dafür
   das perfekte Motiv — flach, kantig, und das Wichtigste daran
   leuchtet sowieso.

   Das Modell zeigt in +x. Gedreht wird später die ganze Gruppe.

   Steht absichtlich ausserhalb von createRenderer und ist exportiert:
   so kann tools/bike-preview.html dasselbe Modell gross anzeigen,
   während man daran schraubt.
   ================================================================== */
export function buildBike(colorHex) {
  const yaw  = new THREE.Group();       // Blickrichtung
  const lean = new THREE.Group();       // Neigung in der Kurve
  yaw.add(lean);

  const shell = new THREE.MeshStandardMaterial({
    color: 0x0b1224, metalness: 0.85, roughness: 0.28,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x05080f, metalness: 0.35, roughness: 0.7,
  });
  const neon = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 2.6, roughness: 0.4,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0d1630, emissive: colorHex, emissiveIntensity: 0.4,
    metalness: 0.7, roughness: 0.1,
  });

  /* Räder zuerst, sie geben die Höhe vor. Absichtlich klein: bei einem
     Lightcycle verschwinden die Räder fast in der Karosserie. Grosse
     Räder lassen das Modell sofort wie ein Spielzeugmotorrad aussehen.
     Ein Torus liegt von Haus aus in der xy-Ebene — genau richtig für
     ein Rad, das in x-Richtung rollt. */
  const R = 0.17;
  for (const px of [0.4, -0.4]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 8, 20), dark);
    tire.position.set(px, R + 0.05, 0);
    lean.add(tire);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.06, 0.022, 6, 20), neon);
    rim.position.set(px, R + 0.05, 0);
    lean.add(rim);
  }

  // Karosserie: ein langer, flacher Riegel über den Rädern.
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.16, 0.2, 0.26, 3, 0.09), shell);
  body.position.y = 0.3;
  lean.add(body);

  // Die zwei Lichtlinien an den Flanken — das Erkennungszeichen.
  for (const pz of [0.14, -0.14]) {
    const line = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.05, 0.035, 2, 0.016), neon);
    line.position.set(0, 0.3, pz);
    lean.add(line);
  }

  // Nase: flacher Keil nach vorn. Der Kegel zeigt von Haus aus nach
  // oben; erst um x drehen (macht aus dem Viereck eine Raute), dann
  // um z nach vorn kippen.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), neon);
  nose.rotation.set(Math.PI / 4, 0, -Math.PI / 2);
  nose.position.set(0.63, 0.3, 0);
  lean.add(nose);

  // Kanzel und darin ein flach liegender Fahrer.
  const canopy = new THREE.Mesh(new RoundedBoxGeometry(0.54, 0.12, 0.22, 3, 0.055), shell);
  canopy.position.set(-0.02, 0.44, 0);
  lean.add(canopy);

  const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.24, 4, 10), shell);
  rider.rotation.z = Math.PI / 2 - 0.12;
  rider.position.set(-0.06, 0.53, 0);
  lean.add(rider);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), glass);
  helmet.position.set(0.16, 0.54, 0);
  lean.add(helmet);

  // Triebwerk hinten — von hier "fällt" die Lichtmauer heraus.
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.09, 12), neon);
  jet.rotation.z = Math.PI / 2;
  jet.position.set(-0.62, 0.3, 0);
  lean.add(jet);

  // Ein wenig echtes Licht, damit das Bike den Boden anleuchtet.
  const lamp = new THREE.PointLight(colorHex, 2.2, 5.5, 2);
  lamp.position.set(0, 0.45, 0);
  yaw.add(lamp);

  return { yaw, lean, lamp, neon };
}

/* ==================================================================
   DIE BÜHNE
   ================================================================== */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(PALETTE.BACKGROUND, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  /* Nebel. Die Grenzen MÜSSEN mit der Arena skalieren — mit festen
     Werten ist bei 200 m Kantenlänge entweder alles neblig oder nichts. */
  scene.fog = new THREE.Fog(PALETTE.BACKGROUND, 60, 600);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 1200);

  scene.add(new THREE.HemisphereLight(0x4466ff, 0x05070f, 0.5));
  const key = new THREE.DirectionalLight(0x9fd0ff, 0.45);
  key.position.set(60, 180, 100);
  scene.add(key);

  /* Bloom: das Leuchten. Ohne diesen Pass sieht Neon aus wie bunte
     Klötzchen, mit ihm wie Licht. */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.8, 0.3);
  composer.addPass(bloom);

  const board = new THREE.Group();
  scene.add(board);

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  let game = null;
  let stage = null;              // alles, was pro Runde neu entsteht
  let mode = "chase";            // "chase" | "top"
  let followId = 0;              // wem die Kamera folgt (0 = erstes Bike)
  let shake = 0;
  let clock = 0;
  let lastW = 0, lastH = 0;

  /* Spielkoordinate → Weltkoordinate. Die Arena liegt zentriert um den
     Ursprung, y des Spiels ist z der Szene. */
  const wx = (x) => x - game.arena / 2;
  const wz = (y) => y - game.arena / 2;


  /* ==================================================================
     ARENA AUFBAUEN
     ================================================================== */
  function buildStage() {
    if (stage) board.remove(stage.group);

    const group = new THREE.Group();
    const A = game.arena;

    scene.fog.near = A * 0.55;
    scene.fog.far = A * 3.2;

    /* --- Boden ---------------------------------------------------- */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(A, A),
      new THREE.MeshStandardMaterial({
        color: PALETTE.FLOOR, metalness: 0.4, roughness: 0.6,
        emissive: 0x060c20, emissiveIntensity: 1,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    /* Das Gitter auf dem Boden. Zehn Meter Raster — es gibt dem Auge
       einen Maßstab für Tempo, sonst merkt man 90 m/s nicht. */
    const grid = new THREE.GridHelper(A, Math.round(A / 10), 0x2a4890, 0x1b2f66);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    group.add(grid);

    /* --- Aussenmauer ---------------------------------------------- */
    const rimMat = new THREE.MeshBasicMaterial({
      color: PALETTE.RIM, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const half = A / 2;
    for (const [w, d, x, z] of [
      [A, WALL_THICK, 0, -half], [A, WALL_THICK, 0, half],
      [WALL_THICK, A, -half, 0], [WALL_THICK, A, half, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, RIM_H, d), rimMat);
      m.position.set(x, RIM_H / 2, z);
      group.add(m);
    }

    /* --- Lichtmauern ---------------------------------------------- */
    /* Zwei Instanz-Netze: der durchscheinende Körper und die helle
       Kante obendrauf. Beide werden jeden Frame neu belegt. */
    /* WICHTIG: unbeleuchtetes Material. setColorAt() setzt die
       DIFFUS-Farbe — in einer Szene, die fast nur aus Eigenleuchten
       besteht, wäre eine Wand damit schwarz. MeshBasicMaterial
       ignoriert Licht und zeigt genau die gesetzte Farbe, und der
       Bloom-Pass macht daraus das Glühen. */
    const wallBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.30, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
      MAX_SEGS
    );
    const wallEdge = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_SEGS
    );
    for (const m of [wallBody, wallEdge]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      group.add(m);
    }

    /* --- Die Todeszone -------------------------------------------- */
    const zone = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 3.2, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff2d55, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, toneMapped: false,
      })
    );
    zone.visible = false;
    group.add(zone);

    /* --- Die Bikes ------------------------------------------------ */
    const bikes = game.cycles.map((c) => {
      const b = buildBike(c.color);
      b.yaw.scale.setScalar(BIKE_SCALE);
      group.add(b.yaw);
      return b;
    });

    /* --- Explosionssplitter --------------------------------------- */
    const shardGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const shards = [];
    const waves = [];

    board.add(group);
    stage = { group, wallBody, wallEdge, zone, bikes, shardGeo, shards, waves };
  }


  /* ==================================================================
     WÄNDE: aus dem Zustand, jeden Frame
     ==================================================================
     Eine Strecke wird zu einer flachen Kiste: so lang wie die Strecke,
     WALL_THICK dünn, WALL_H hoch. Weil hinten laufend abgeschnitten
     wird (endliche Wandlänge), ist Neuaufbauen einfacher und billiger
     als mitzuzählen, was sich geändert hat.
     ================================================================== */
  function rebuildWalls() {
    const { wallBody, wallEdge } = stage;
    let n = 0;

    for (const c of game.cycles) {
      tmpColor.setHex(c.color);
      for (const s of c.walls) {
        const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
        if (len < 0.02 || n >= MAX_SEGS) continue;

        const mx = wx((s.x1 + s.x2) / 2);
        const mz = wz((s.y1 + s.y2) / 2);
        const sx = s.horiz ? len : WALL_THICK;
        const sz = s.horiz ? WALL_THICK : len;

        dummy.position.set(mx, WALL_H / 2, mz);
        dummy.scale.set(sx, WALL_H, sz);
        dummy.updateMatrix();
        wallBody.setMatrixAt(n, dummy.matrix);
        wallBody.setColorAt(n, tmpColor);

        dummy.position.set(mx, WALL_H + EDGE_H / 2, mz);
        dummy.scale.set(sx, EDGE_H, sz);
        dummy.updateMatrix();
        wallEdge.setMatrixAt(n, dummy.matrix);
        wallEdge.setColorAt(n, tmpColor);

        n++;
      }
    }

    wallBody.count = wallEdge.count = n;
    wallBody.instanceMatrix.needsUpdate = true;
    wallEdge.instanceMatrix.needsUpdate = true;
    if (wallBody.instanceColor) wallBody.instanceColor.needsUpdate = true;
    if (wallEdge.instanceColor) wallEdge.instanceColor.needsUpdate = true;
  }


  /* ==================================================================
     EXPLOSION
     ================================================================== */
  function explode(cycle) {
    const x = wx(cycle.x), z = wz(cycle.y);

    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(stage.shardGeo, new THREE.MeshBasicMaterial({
        color: cycle.color, toneMapped: false, transparent: true,
      }));
      m.position.set(x, 1.2, z);
      const a = Math.random() * Math.PI * 2;
      const up = 6 + Math.random() * 14;
      const out = 6 + Math.random() * 16;
      stage.group.add(m);
      stage.shards.push({
        mesh: m, life: 1,
        v: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out),
        spin: new THREE.Vector3(Math.random(), Math.random(), Math.random())
          .multiplyScalar(9),
      });
    }

    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.0, 40),
      new THREE.MeshBasicMaterial({
        color: cycle.color, transparent: true, side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(x, 0.4, z);
    stage.group.add(wave);
    stage.waves.push({ mesh: wave, life: 1 });

    shake = Math.min(1.6, shake + 1);
  }


  /* ==================================================================
     KAMERA
     ==================================================================
     Verfolgerkamera: hinter dem Bike, leicht darüber, Blick nach vorn.
     Das Sichtfeld öffnet sich mit dem Tempo — der billigste und
     wirksamste Trick, um 90 m/s auch nach 90 m/s aussehen zu lassen.
     ================================================================== */
  /* Richtungsvektoren in Weltkoordinaten, passend zu AXES der Engine. */
  const AXIS_VEC = [
    { x:  1, z:  0 },   // 0 rechts
    { x:  0, z: -1 },   // 1 hoch
    { x: -1, z:  0 },   // 2 links
    { x:  0, z:  1 },   // 3 runter
  ];
  const YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let eyeSmooth = null, aimSmooth = null;

  function followed() {
    const alive = game.cycles.filter((c) => c.alive);
    if (followId) {
      const c = game.cycles.find((k) => k.id === followId);
      if (c && c.alive) return c;
    }
    return alive[0] || game.cycles[0];
  }

  function placeCamera(dt) {
    const A = game.arena;

    if (mode === "top") {
      camera.fov = 45;
      camera.position.set(0, A * 0.95, A * 0.62);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      return;
    }

    const c = followed();
    if (!c) return;

    const dir = AXIS_VEC[c.dir];
    const speedT = Math.min((c.speed - RULES.SPEED) / 60, 1.2);

    /* Hoch genug, um ÜBER der eigenen Wand zu sitzen — die läuft ja
       vom Bike aus nach hinten, also genau durch die Kamera. Zu tief
       und man schaut die eigene Wand von innen an. */
    const back = 17 + speedT * 6;
    const high = 9.5 + speedT * 1.5;
    const ahead = 26 + speedT * 26;

    eye.set(wx(c.x) - dir.x * back, high, wz(c.y) - dir.z * back);
    aim.set(wx(c.x) + dir.x * ahead, 0.8, wz(c.y) + dir.z * ahead);

    if (!eyeSmooth) { eyeSmooth = eye.clone(); aimSmooth = aim.clone(); }
    // Nachziehen, aber schnell genug, dass eine Kurve nicht schmiert.
    const k = 1 - Math.pow(0.0025, dt);
    eyeSmooth.lerp(eye, k);
    aimSmooth.lerp(aim, k);

    camera.position.copy(eyeSmooth);
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake * 1.4;
      camera.position.y += (Math.random() - 0.5) * shake * 1.0;
    }
    camera.lookAt(aimSmooth);
    camera.fov = 62 + speedT * 12;
    camera.updateProjectionMatrix();
  }



  /* ==================================================================
     ZEICHNEN
     ==================================================================
     Kein alpha, kein Zwischenschritt: die Physik läuft mit 125 Hz und
     rechnet in Kommazahlen, die Positionen sind also schon flüssig.
     ================================================================== */
  function render(dtMs) {
    if (!game || !stage || !hasSize()) return;
    const dt = Math.min(dtMs, 60) / 1000;
    clock += dt;

    rebuildWalls();

    /* --- Bikes ---------------------------------------------------- */
    game.cycles.forEach((c, i) => {
      const b = stage.bikes[i];
      b.yaw.visible = c.alive;
      if (!c.alive) return;

      b.yaw.position.set(wx(c.x), 0, wz(c.y));
      b.yaw.rotation.y = YAW[c.dir];

      // Neigung: kurz nach einer Kurve kippt das Bike, dann richtet es
      // sich wieder auf. Rein optisch, der Zustand weiss nichts davon.
      const since = game.time - c.turnAt;
      const lean = since >= 0 && since < 0.28 ? (1 - since / 0.28) : 0;
      b.lean.rotation.x = THREE.MathUtils.lerp(b.lean.rotation.x,
        lean * 0.5 * (c.turnSign || 1), 0.25);

      // Das Gummi als Warnlicht: wird es knapp, flackert das Neon rot.
      const rf = c.rubber / RULES.RUBBER;
      if (rf < 0.5) {
        const beat = 0.5 + 0.5 * Math.sin(clock * 22);
        b.neon.emissiveIntensity = 2.6 + (1 - rf) * beat * 4;
        b.neon.color.setHex(PALETTE.RUBBER).lerp(tmpColor.setHex(c.color), rf * 2);
      } else {
        b.neon.emissiveIntensity = 2.6;
        b.neon.color.setHex(c.color);
      }
      b.lamp.intensity = 2.2 + Math.min(c.speed / RULES.SPEED - 1, 2) * 1.5;
    });

    /* --- Todeszone ------------------------------------------------ */
    const z = game.zone;
    stage.zone.visible = z.active && z.r > 0.5;
    if (stage.zone.visible) {
      stage.zone.position.set(wx(z.x), 1.6, wz(z.y));
      stage.zone.scale.set(z.r, 1 + 0.08 * Math.sin(clock * 6), z.r);
      stage.zone.rotation.y = clock * 0.6;
      stage.zone.material.opacity = 0.35 + 0.15 * Math.sin(clock * 5);
    }

    /* --- Splitter ------------------------------------------------- */
    for (let i = stage.shards.length - 1; i >= 0; i--) {
      const s = stage.shards[i];
      s.life -= dt * 0.9;
      if (s.life <= 0) { stage.group.remove(s.mesh); stage.shards.splice(i, 1); continue; }
      s.v.y -= 34 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      if (s.mesh.position.y < 0.2) { s.mesh.position.y = 0.2; s.v.y *= -0.4; s.v.multiplyScalar(0.7); }
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.material.opacity = Math.max(0, s.life);
      s.mesh.scale.setScalar(0.6 + s.life * 0.8);
    }

    /* --- Druckwellen ---------------------------------------------- */
    for (let i = stage.waves.length - 1; i >= 0; i--) {
      const w = stage.waves[i];
      w.life -= dt * 1.5;
      if (w.life <= 0) { stage.group.remove(w.mesh); stage.waves.splice(i, 1); continue; }
      const r = (1 - w.life) * 26;
      w.mesh.scale.setScalar(1 + r);
      w.mesh.material.opacity = w.life * 0.7;
    }

    shake = Math.max(0, shake - dt * 2.4);

    placeCamera(dt);
    composer.render();
  }


  /* ==================================================================
     RAHMEN
     ================================================================== */
  function hasSize() {
    return canvas.clientWidth > 0 && canvas.clientHeight > 0;
  }

  function resize() {
    if (!hasSize()) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setGame(next) {
    game = next;
    eyeSmooth = aimSmooth = null;
    buildStage();
    resize();
  }

  function follow(cycleId) { followId = cycleId | 0; eyeSmooth = null; }
  function setMode(next) { mode = next === "top" ? "top" : "chase"; eyeSmooth = null; }
  function toggleMode() { setMode(mode === "top" ? "chase" : "top"); return mode; }

  return {
    setGame, render, resize, explode,
    follow, setMode, toggleMode,
    get mode() { return mode; },
    scene, camera,
  };
}
