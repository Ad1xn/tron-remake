/* =========================================================================
   NETZBILD — das Netz ansehen, während es fährt.
   =========================================================================
   Links die 16 Sensoren, in der Mitte die verdeckte Schicht, rechts die
   drei Ausgänge. Die Kanten zeigen die GEWICHTE (blau = zieht hoch, rot
   = drückt runter, Dicke = Stärke), die Knoten die AKTIVIERUNG im
   gerade gezeichneten Moment.

   Warum das mehr ist als Dekoration: man sieht, worauf das Netz
   tatsächlich hört. Bleibt ein Eingang immer dunkel, ist der Sensor
   wertlos. Hängen alle Ausgänge an denselben zwei Eingängen, ist das
   Netz simpler als gedacht. Beides steht in keiner Verlustkurve.

   Gezeichnet wird auf Canvas, nicht als SVG: 456 Kanten als DOM-Knoten
   wären bei 60 Bildern pro Sekunde zu teuer.
   ========================================================================= */

import { SENSOR_NAMES, ACTIONS } from "./features.js";
import { vorwaerts, softmax } from "./net.js";

const KURZ = {
  zeit_vorn: "vorn", zeit_links: "links", zeit_rechts: "rechts",
  gummi: "gummi", tempo: "tempo", bremse: "bremse",
  gegner_vorn: "geg vorn", gegner_rechts: "geg rechts",
  gegner_naehe: "geg nah", gegner_kurs: "geg kurs",
  zone_naehe: "zone", zone_aktiv: "zone an",
  wand_links: "wand li", wand_rechts: "wand re",
  rand_naehe: "rand", zeit: "zeit",
};

export function erzeugeNetzbild(canvas) {
  const ctx = canvas.getContext("2d");
  let netz = null;
  const zw = { h: null, roh: null, p: null };

  function mass() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  /* Knotenplätze: drei Spalten, jede gleichmässig verteilt. */
  function plaetze(w, h) {
    const links = 86, rechts = w - 54, mitte = (links + rechts) / 2;
    const reihe = (n, x) => Array.from({ length: n }, (_, i) => ({
      x, y: 16 + ((h - 32) * (i + 0.5)) / n,
    }));
    return {
      ein: reihe(netz.ein, links),
      verdeckt: reihe(netz.verdeckt, mitte),
      aus: reihe(netz.aus, rechts),
    };
  }

  /* Blau zieht hoch, rot drückt runter. Die Deckkraft wächst mit dem
     Betrag — schwache Kanten verschwinden fast, sonst ist alles Brei. */
  const kante = (g, max) => {
    const t = Math.min(Math.abs(g) / (max || 1), 1);
    const a = 0.04 + 0.5 * t * t;
    return g >= 0 ? `rgba(90,170,255,${a})` : `rgba(255,80,90,${a})`;
  };

  return {
    setNetz(n) {
      netz = n;
      zw.h = new Float64Array(n.verdeckt);
      zw.roh = new Float64Array(n.aus);
      zw.p = new Float64Array(n.aus);
    },

    /* `x` sind die 16 Sensoren des Bikes, dem gerade zugesehen wird.
       Ohne x werden nur die Gewichte gezeigt, ohne Aktivierung. */
    zeichne(x = null) {
      if (!netz) return;
      const { w, h } = mass();
      ctx.clearRect(0, 0, w, h);
      const P = plaetze(w, h);

      if (x) { vorwaerts(netz, x, zw); softmax(zw.roh, zw.p); }

      let max1 = 0, max2 = 0;
      for (const g of netz.w1) max1 = Math.max(max1, Math.abs(g));
      for (const g of netz.w2) max2 = Math.max(max2, Math.abs(g));

      /* --- Kanten zuerst, damit die Knoten darüber liegen --- */
      ctx.lineWidth = 1;
      for (let j = 0; j < netz.verdeckt; j++) {
        for (let i = 0; i < netz.ein; i++) {
          const g = netz.w1[j * netz.ein + i];
          if (Math.abs(g) < max1 * 0.12) continue;      // Brei ausdünnen
          ctx.strokeStyle = kante(g, max1);
          ctx.beginPath();
          ctx.moveTo(P.ein[i].x, P.ein[i].y);
          ctx.lineTo(P.verdeckt[j].x, P.verdeckt[j].y);
          ctx.stroke();
        }
      }
      for (let k = 0; k < netz.aus; k++) {
        for (let j = 0; j < netz.verdeckt; j++) {
          const g = netz.w2[k * netz.verdeckt + j];
          if (Math.abs(g) < max2 * 0.12) continue;
          ctx.strokeStyle = kante(g, max2);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(P.verdeckt[j].x, P.verdeckt[j].y);
          ctx.lineTo(P.aus[k].x, P.aus[k].y);
          ctx.stroke();
        }
      }

      /* --- Knoten --- */
      const punkt = (p, wert, r, farbe) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = farbe;
        ctx.fill();
        if (wert > 0.02) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 2 + wert * 5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(120,200,255,${0.15 + wert * 0.5})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      };

      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.textBaseline = "middle";
      P.ein.forEach((p, i) => {
        const v = x ? Math.min(Math.abs(x[i]), 1) : 0;
        punkt(p, v, 3.5, `rgba(${80 + v * 160},${180 + v * 60},255,${0.35 + v * 0.65})`);
        ctx.fillStyle = "#4d5f85";
        ctx.textAlign = "right";
        ctx.fillText(KURZ[SENSOR_NAMES[i]] || SENSOR_NAMES[i], p.x - 8, p.y);
      });

      P.verdeckt.forEach((p, j) => {
        const v = zw.h ? Math.min(Math.abs(zw.h[j]), 1) : 0;
        punkt(p, v, 3, `rgba(${110 + v * 120},${200},${255},${0.3 + v * 0.7})`);
      });

      const beste = zw.p ? [...zw.p].indexOf(Math.max(...zw.p)) : -1;
      P.aus.forEach((p, k) => {
        const v = zw.p ? zw.p[k] : 0;
        punkt(p, v, 5, k === beste
          ? `rgba(120,255,140,${0.5 + v * 0.5})`
          : `rgba(150,190,230,${0.2 + v * 0.5})`);
        ctx.fillStyle = k === beste ? "#7dffa0" : "#4d5f85";
        ctx.textAlign = "left";
        ctx.fillText(ACTIONS[k], p.x + 10, p.y);
      });
    },
  };
}
