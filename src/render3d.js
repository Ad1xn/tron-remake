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
/* Nach den Bildern aus dem Video korrigiert. Die Wände dort sind
   NIEDRIGE, DECKENDE Bänder mit sichtbarer Oberseite — keine hohen
   Glasscheiben. Man sieht die Oberseite hell und die Flanke dunkler,
   das kommt vom Licht, nicht von einem Verlauf. */
const WALL_H     = 1.15;    // niedrig! vorher 5,0 — das war der Hauptfehler
const WALL_THICK = 0.30;    // dünn. 0,55 war noch zu dick.
const EDGE_H     = 0.06;    // die helle Kante obendrauf
const RIM_H      = 6.5;     // die Aussenmauer — im Original das helle
                            // Band am Horizont
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

/* Die Lichtmauer-Textur. Im gekauften Spiel heisst sie dir_wall.png:
   ein graues Feld mit einem weissen Blitz-Zickzack, der sich über die
   Wand wiederholt. Daher die hellen Schrägstreifen auf den Wänden in
   den Bildern aus dem Video. Hier nachgemalt statt kopiert — die Datei
   gehört zum gekauften Spiel und hat in diesem Projekt nichts zu
   suchen. */
let wallTexCache = null;
function wallTexture() {
  if (wallTexCache) return wallTexCache;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#8a8a8a";                 // Grundton, wird eingefärbt
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 4;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();                           // der Blitz
  g.moveTo(60, 0); g.lineTo(34, 30); g.lineTo(44, 36);
  g.lineTo(18, 64);
  g.stroke();
  wallTexCache = new THREE.CanvasTexture(c);
  wallTexCache.wrapS = wallTexCache.wrapT = THREE.RepeatWrapping;
  return wallTexCache;
}

/* Die Streifen der Aussenmauer, als kleine Textur selbst gemalt —
   kein Download, kein Bild im Projekt. */
let stripeCache = null;
function stripeTexture() {
  if (stripeCache) return stripeCache;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 8;
  const g = c.getContext("2d");
  g.fillStyle = "#060a18";
  g.fillRect(0, 0, 64, 8);
  for (let i = 0; i < 64; i += 8) {
    // Aus der Ferne ein helles Band, von nahem nicht blendend.
    g.fillStyle = i % 16 === 0 ? "#9fb0d8" : "#46578a";
    g.fillRect(i, 0, 3, 8);
  }
  stripeCache = new THREE.CanvasTexture(c);
  stripeCache.wrapS = stripeCache.wrapT = THREE.RepeatWrapping;
  stripeCache.magFilter = THREE.LinearFilter;
  return stripeCache;
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

  /* Licht fast senkrecht von oben: dadurch ist die Oberseite jeder Wand
     hell und die Flanke dunkel — der Look aus dem Video. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(30, 300, 60);
  scene.add(key);

  /* Bloom: das Leuchten. Ohne diesen Pass sieht Neon aus wie bunte
     Klötzchen, mit ihm wie Licht. */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.9, 0.55);
  composer.addPass(bloom);

  const board = new THREE.Group();
  scene.add(board);

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const edgeColor = new THREE.Color();

  let game = null;
  let stage = null;              // alles, was pro Runde neu entsteht
  /* DREI KAMERAS, mit C der Reihe nach:
       "bike"   hinter und über dem eigenen Bike, Blick schräg nach
                unten — die Werte dafür stehen in settings_visual.cfg
                (CAMERA_CUSTOM_*) und das ist die Standardansicht
       "drone"  senkrecht von weit oben auf das eigene Bike. Damit sieht
                man das ganze Labyrinth und kann Spielzüge planen.
       "cockpit" sitzt am Bike selbst (Ich-Perspektive)
     Dazu Glance: kurz nach links, rechts oder hinten schauen, solange
     die Taste gehalten wird. */
  const MODES = ["bike", "drone", "cockpit"];
  let mode = "bike";
  let glance = 0;                // 0 = nach vorn, 1 = links, -1 = rechts, 2 = hinten
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
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    /* Das Gitter auf dem Boden. Zehn Meter Raster — es gibt dem Auge
       einen Maßstab für Tempo, sonst merkt man 90 m/s nicht. */
    /* Der Boden. floor.png im gekauften Spiel ist SCHWARZ mit einer
       dünnen hellen Kante — also eine Kachel mit angedeutetem Gitter.
       Genau so: fast schwarz, mit einer kaum sichtbaren Linie alle
       20 m. In den Bildern aus dem Video sieht man davon fast nichts. */
    const grid = new THREE.GridHelper(A, Math.round(A / 20), 0x101a33, 0x0a1226);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    group.add(grid);

    /* --- Aussenmauer ---------------------------------------------- */
    /* Im Original ist das kein blauer Block, sondern ein helles Band mit
       feinen senkrechten Streifen — man sieht daran, wie schnell man
       daran vorbeifährt. Die Streifen sind eine winzige Textur, die in
       Fahrtrichtung wiederholt wird. */
    const rimMat = new THREE.MeshBasicMaterial({
      map: stripeTexture(), transparent: true, opacity: 0.34,
      side: THREE.DoubleSide, toneMapped: false, depthWrite: false,
    });
    const half = A / 2;
    for (const [w, d, x, z, rep] of [
      [A, WALL_THICK, 0, -half, A / 8], [A, WALL_THICK, 0, half, A / 8],
      [WALL_THICK, A, -half, 0, A / 8], [WALL_THICK, A, half, 0, A / 8],
    ]) {
      const mat = rimMat.clone();
      mat.map = rimMat.map.clone();
      mat.map.needsUpdate = true;
      mat.map.repeat.set(rep, 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, RIM_H, d), mat);
      m.position.set(x, RIM_H / 2, z);
      group.add(m);
    }

    /* --- Lichtmauern ---------------------------------------------- */
    /* Zwei Instanz-Netze: der durchscheinende Körper und die helle
       Kante obendrauf. Beide werden jeden Frame neu belegt. */
    /* BELEUCHTET und deckend. Genau daher kommt der Look im Video:
       die Oberseite fängt das Licht von oben, die Flanken bleiben
       dunkler — eine Wand sieht dadurch wie ein Körper aus und nicht
       wie eine Folie. (Vorher unbeleuchtet und durchscheinend, mit
       einem Verlauf: das war der zweite Hauptfehler.) */
    const wallBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ side: THREE.FrontSide, map: wallTexture() }),
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

    /* --- Zonen ---------------------------------------------------- */
    /* Die Win-Zone ist ein ZIEL, kein Hindernis — deshalb grün und
       einladend, nicht rot. Die Fortress-Zonen tragen die Teamfarbe und
       zeigen mit einer Bodenscheibe, wie weit sie erobert sind. */
    const mkZone = (color) => {
      const g2 = new THREE.Group();
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, RULES.ZONE_HEIGHT, 48, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.28,
          side: THREE.DoubleSide, toneMapped: false,
        })
      );
      wall.position.y = RULES.ZONE_HEIGHT / 2;
      g2.add(wall);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.22, toneMapped: false,
        })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      g2.add(disc);
      g2.visible = false;
      group.add(g2);
      return { group: g2, wall, disc };
    };

    const winZone = mkZone(PALETTE.ZONE_WIN);
    const teamZones = (game.zones || []).map((z) =>
      mkZone(PALETTE.TEAM[z.team % PALETTE.TEAM.length]));

    /* --- Die Bikes ------------------------------------------------ */
    const bikes = game.cycles.map((c) => {
      const b = buildBike(c.color);
      b.yaw.scale.setScalar(BIKE_SCALE);
      /* Das Lämpchen am Bike RAUS. Bei 16 Fahrern hängen sonst 16
         Punktlichter in der Szene, und seit die Wände beleuchtet sind,
         rechnet jeder Wand-Pixel alle 16 durch. Im Video leuchten die
         Bikes den Boden auch nicht an — der ist schwarz. */
      if (b.lamp && b.lamp.parent) b.lamp.parent.remove(b.lamp);
      group.add(b.yaw);
      return b;
    });

    /* --- Explosionssplitter --------------------------------------- */
    /* EIN Material pro Fahrerfarbe, nicht eines pro Splitter. Bei 16
       Fahrern und 26 Splittern pro Explosion wären das sonst hunderte
       Materialien in wenigen Sekunden — jedes davon Arbeit für den
       Browser und Müll für die Speicherbereinigung. */
    const shardGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const shardMats = new Map();
    for (const c of game.cycles) {
      shardMats.set(c.color, new THREE.MeshBasicMaterial({
        color: c.color, toneMapped: false, transparent: true,
      }));
    }
    const shards = [];
    const waves = [];

    board.add(group);
    stage = { group, wallBody, wallEdge, winZone, teamZones, bikes,
              shardGeo, shardMats, shards, waves };
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

    /* Immer die echte Dicke. Die künstliche Verbreiterung für die
       Draufsicht ist weggefallen, seit die Übersicht schräg schaut: aus
       einem flachen Winkel zeigt jede Wand ihre Höhe und ist dadurch von
       selbst sichtbar. */
    const thick = WALL_THICK;

    for (const c of game.cycles) {
      /* Der Körper etwas gedeckter, die Oberkante voll: im Video sind die
         Wände dunkelrot und olivgrün, nicht neonbunt. Der helle Streifen
         obendrauf macht den Kontrast. */
      tmpColor.setHex(c.color).multiplyScalar(0.62);
      edgeColor.setHex(c.color);
      for (const s of c.walls) {
        const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
        if (len < 0.02 || n >= MAX_SEGS) continue;

        const mx = wx((s.x1 + s.x2) / 2);
        const mz = wz((s.y1 + s.y2) / 2);
        const sx = s.horiz ? len : thick;
        const sz = s.horiz ? thick : len;

        dummy.position.set(mx, WALL_H / 2, mz);
        dummy.scale.set(sx, WALL_H, sz);
        dummy.updateMatrix();
        wallBody.setMatrixAt(n, dummy.matrix);
        wallBody.setColorAt(n, tmpColor);

        dummy.position.set(mx, WALL_H + EDGE_H / 2, mz);
        dummy.scale.set(sx, EDGE_H, sz * 1.05);
        dummy.updateMatrix();
        wallEdge.setMatrixAt(n, dummy.matrix);
        wallEdge.setColorAt(n, edgeColor);

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

    /* Nicht mehr als ein paar Explosionen gleichzeitig — bei 16 Fahrern
       stirbt gern die halbe Arena im selben Moment. */
    if (stage.shards.length > 200) return;
    const mat = stage.shardMats.get(cycle.color);

    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(stage.shardGeo, mat);
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
      new THREE.RingGeometry(0.6, 1.0, 32),
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

  const fovMul = { x: 1, y: 0.6 };     // Tangens der halben Öffnungswinkel
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
    const c = followed();
    if (!c) return;

    /* Blickrichtung = Fahrtrichtung, um den Glance gedreht. */
    const viewDir = glance === 0 ? c.dir
      : glance === 1 ? (c.dir + 1) % 4
      : glance === -1 ? (c.dir + 3) % 4
      : (c.dir + 2) % 4;

    const dir = AXIS_VEC[c.dir];
    const vd = AXIS_VEC[viewDir];
    const speedT = Math.min((c.speed - RULES.SPEED) / 40, 1.5);

    if (mode === "drone") {
      /* ÜBERSICHT: schräg von hinten-oben, und sie FÄHRT MIT.

         Vorher stand sie senkrecht über der Arenamitte und rührte sich
         nicht. Zwei Probleme: von ganz oben ist eine 30 cm dünne Wand
         schmaler als ein Bildschirmpunkt (ich musste die Wände künstlich
         verbreitern, damit überhaupt etwas zu sehen war), und man verlor
         den Bezug zum eigenen Bike.

         Schräg gelöst beides: die Wände zeigen ihre Höhe und sind damit
         von selbst sichtbar, und weil die Kamera weit hinten und hoch
         hängt, sieht man trotzdem ein grosses Stück Feld. Das eigene
         Bike sitzt im unteren Drittel — vor einem liegt also das meiste. */
      const back = RULES.CAM_DRONE_BACK + RULES.CAM_DRONE_BACK_SPEED * c.speed;
      const high = RULES.CAM_DRONE_HIGH + RULES.CAM_DRONE_HIGH_SPEED * c.speed;
      const ahead = RULES.CAM_DRONE_AHEAD;

      camera.up.set(0, 1, 0);
      eye.set(wx(c.x) - dir.x * back, high, wz(c.y) - dir.z * back);
      aim.set(wx(c.x) + vd.x * ahead, 0, wz(c.y) + vd.z * ahead);
    } else if (mode === "cockpit") {
      camera.up.set(0, 1, 0);
      /* Ich-Perspektive: knapp über dem Bike, Blick nach vorn. Damit
         sieht man die eigene Wand gar nicht — dafür ist Glance da. */
      eye.set(wx(c.x) + dir.x * 0.4, 1.2, wz(c.y) + dir.z * 0.4);
      aim.set(wx(c.x) + vd.x * 40, 1.2, wz(c.y) + vd.z * 40);
    } else {
      /* Smart: hinter dem Bike, hoch genug, um ÜBER der eigenen Wand zu
         sitzen — die läuft vom Bike aus nach hinten, also genau durch
         die Kamera. Zu tief und man schaut sie von innen an. */
      /* DIE ECHTEN WERTE, aus settings_visual.cfg des gekauften Spiels:

           CAMERA_CUSTOM_BACK            6     + 0.5 je m/s
           CAMERA_CUSTOM_RISE            4     + 0.4 je m/s
           CAMERA_CUSTOM_PITCH          -0.58  (Bogenmass, also −33°)

         Entscheidend ist der FESTE Neigungswinkel: die Kamera schaut
         immer gleich steil nach unten. Ich hatte stattdessen auf einen
         Punkt vor dem Bike gezielt — dadurch änderte sich die Neigung
         ständig mit Tempo und Abstand, und es sah nie richtig aus.
         Und Abstand UND Höhe wachsen mit dem Tempo: bei 30 m/s sind das
         21 m hinter und 16 m über dem Bike, bei 60 m/s 36 und 28. */
      const back = RULES.CAM_BACK + RULES.CAM_BACK_SPEED * c.speed;
      const high = RULES.CAM_RISE + RULES.CAM_RISE_SPEED * c.speed;
      eye.set(wx(c.x) - dir.x * back, high, wz(c.y) - dir.z * back);

      /* Blickrichtung. Im Original steht das so:

             gluLookAt(0,0,0,  dir.x, dir.y, rise,  top.x, top.y, 1)

         rise ist also die SENKRECHTE KOMPONENTE des Blickvektors, dessen
         waagerechter Teil die Länge 1 hat — eine Steigung, kein Winkel.
         CAMERA_CUSTOM_PITCH -0.58 heisst damit atan(0,58) = 30,1° nach
         unten, nicht 33°. Ich hatte es als Bogenmass gerechnet. */
      const L = 40;
      aim.set(
        eye.x + vd.x * L,
        eye.y + RULES.CAM_PITCH * L,
        eye.z + vd.z * L
      );
    }

    if (!eyeSmooth) { eyeSmooth = eye.clone(); aimSmooth = aim.clone(); }
    // Nachziehen, aber schnell genug, dass eine Kurve nicht schmiert.
    // In der Draufsicht fast gar nicht, sonst schwimmt das ganze Bild.
    /* Die Übersicht zieht ruhiger nach als die Bike-Kamera — bei der
       Höhe würde jede Kurve sonst das halbe Bild herumreissen. */
    const k = 1 - Math.pow(mode === "drone" ? 0.08 : 0.0025, dt);
    eyeSmooth.lerp(eye, k);
    aimSmooth.lerp(aim, k);

    camera.position.copy(eyeSmooth);
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake * 1.4;
      camera.position.y += (Math.random() - 0.5) * shake * 1.0;
    }
    camera.lookAt(aimSmooth);
    /* Das Sichtfeld öffnet sich mit dem Tempo. Billigster und
       wirksamster Trick, damit 50 m/s auch nach 50 m/s aussehen. */
    camera.fov = (mode === "cycle" ? 78 : 56) + speedT * 10;
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
      // (kein Lämpchen mehr, siehe buildStage)
    });

    /* --- Zonen ---------------------------------------------------- */
    const wz2 = game.winZone;
    stage.winZone.group.visible = wz2.active && wz2.r > 0.5;
    if (stage.winZone.group.visible) {
      stage.winZone.group.position.set(wx(wz2.x), 0, wz(wz2.y));
      stage.winZone.wall.scale.set(wz2.r, 1, wz2.r);
      stage.winZone.disc.scale.setScalar(wz2.r);
      stage.winZone.wall.material.opacity = 0.22 + 0.12 * Math.sin(clock * 4);
      stage.winZone.group.rotation.y = clock * 0.4;
    }

    game.zones.forEach((z, i) => {
      const v = stage.teamZones[i];
      if (!v) return;
      v.group.visible = !z.conquered;
      v.group.position.set(wx(z.x), 0, wz(z.y));
      v.wall.scale.set(z.r, 1, z.r);
      // Die Bodenscheibe wächst mit dem Eroberungsstand: man SIEHT,
      // wie die eigene Festung fällt.
      v.disc.scale.setScalar(Math.max(0.001, z.r * z.conquest));
      v.disc.material.opacity = 0.25 + 0.5 * z.conquest;
      v.wall.material.opacity = 0.2 + 0.25 * z.conquest
        + (z.inside.attackers ? 0.1 * Math.sin(clock * 12) : 0);
    });

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
      // Das Material ist geteilt, also darf die Deckkraft nicht pro
      // Splitter geändert werden — dafür schrumpfen sie.
      s.mesh.scale.setScalar(Math.max(0.01, s.life * 1.2));
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

  /* DAS SICHTFELD — der grösste einzelne Fehler an meiner Kamera.
     Im Original ist START_FOV = 90, und zwar WAAGERECHT ("usually, fov is
     the horizontal fov"). Three.js will den senkrechten Wert. Die
     Umrechnung steht im Original so:

         ensureVertical = max(aspect / 1.5, 1)     // Breitbild bekommt mehr
         xmul = ensureVertical * tan(fov/2)
         ymul = xmul / aspect                       // senkrechte Hälfte

     Ich bin mit 56° gefahren. Bei 90° sieht man von derselben Stelle ein
     Vielfaches des Feldes — DAS ist der Grund, warum in den Bildern aus
     dem Video ein ganzes Labyrinth auf den Schirm passt, obwohl die
     Kamera nur 16 m über dem Bike hängt. */
  function setFov() {
    const aspect = camera.aspect || 1;
    const ensureVertical = Math.max(aspect / 1.5, 1);
    const xmul = ensureVertical * Math.tan((Math.PI / 360) * RULES.FOV);
    const ymul = xmul / aspect;
    fovMul.x = xmul; fovMul.y = ymul;
    const fov = 2 * Math.atan(ymul) * 180 / Math.PI;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
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
    setFov();
  }

  function setGame(next) {
    game = next;
    eyeSmooth = aimSmooth = null;
    buildStage();
    resize();
  }

  function follow(cycleId) { followId = cycleId | 0; eyeSmooth = null; }
  function setMode(next) {
    mode = MODES.includes(next) ? next : "bike";
    eyeSmooth = null;
  }
  function toggleMode() {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    return mode;
  }
  function setGlance(g) { glance = g | 0; }

  /* Welt → Bildschirm, für die Namen und Gummi-Zahlen über den Bikes.
     Das Original zeigt genau das: kleine Zahlen an den anderen Fahrern. */
  function project(x, y, height = 2.2) {
    const v = new THREE.Vector3(wx(x), height, wz(y)).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
      visible: v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2,
    };
  }

  return {
    setGame, render, resize, explode,
    follow, setMode, toggleMode, setGlance, project,
    get mode() { return mode; },
    get followId() { const c = followed(); return c ? c.id : 0; },
    scene, camera,
  };
}
