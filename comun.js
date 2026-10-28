/* Utilidades compartidas del dashboard: formato, DOM, escalas de color, tooltip y exportación.
   Expone window.OBS. Toda imagen exportada lleva la atribución a CivicAPI y la hora del dato. */
window.OBS = (function () {
  "use strict";

  const LOCAL = "es-AR";
  const num = (x, dec) => x.toLocaleString(LOCAL, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const vacio = (x) => x == null || Number.isNaN(x);

  const fmt = {
    pct: (x) => (vacio(x) ? "—" : num(x, 1) + "%"),
    pp: (x) => (vacio(x) ? "—" : (x > 0 ? "+" : "") + num(x, 1)),
    dec: (x) => (vacio(x) ? "—" : num(x, 1)),
    int: (x) => (vacio(x) ? "—" : Math.round(x).toLocaleString(LOCAL)),
    usd: (x) => (vacio(x) ? "—" : "US$ " + Math.round(x).toLocaleString(LOCAL)),
    hora: (s) => (s ? new Date(s).toLocaleString(LOCAL, { dateStyle: "short", timeStyle: "medium" }) : "—"),
    horaCorta: (s) => (s ? new Date(s).toLocaleTimeString(LOCAL, { hour: "2-digit", minute: "2-digit" }) : "—"),
  };

  function el(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos.flat()) {
      if (h == null) continue;
      n.append(h instanceof Node ? h : document.createTextNode(String(h)));
    }
    return n;
  }

  function css(nombre, defecto = "") {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
  }

  // --- escalas (paleta de referencia: azul y rojo con gris neutro; secuencial en azul) ------------
  function escalaDivergente(tope = 30) {
    return d3.scaleLinear().domain([-tope, 0, tope]).range([css("--rep"), css("--neutro"), css("--dem")])
      .interpolate(d3.interpolateLab).clamp(true);
  }
  function escalaSecuencial(min = 0, max = 100) {
    return d3.scaleLinear().domain([min, max]).range([css("--sec-bajo"), css("--sec-alto")])
      .interpolate(d3.interpolateLab).clamp(true);
  }

  // --- tooltip --------------------------------------------------------------------------------------
  let tip = null;
  function mostrarTip(ev, lineas) {
    tip = tip || document.getElementById("tooltip");
    tip.replaceChildren(...lineas.filter((l) => l != null).map((l, i) => el(i ? "div" : "strong", {}, l)));
    tip.hidden = false;
    const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(ev.clientY + 12, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function ocultarTip() { (tip || document.getElementById("tooltip")).hidden = true; }

  // --- exportación ----------------------------------------------------------------------------------
  const ATRIBUCION = "Datos: CivicAPI (civicapi.org) · Observatorio Electoral, FCEJS-UNSL";
  let momentoDatos = null; // hora del último estado, para el pie de las exportaciones
  function fijarMomento(s) { momentoDatos = s; }

  function pie(extra) {
    return [ATRIBUCION, momentoDatos ? "Dato de " + fmt.hora(momentoDatos) : null, extra].filter(Boolean).join(" · ");
  }

  function nombreArchivo(base, ext) {
    const marca = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
    return `${base.replace(/[^\w-]+/g, "_").slice(0, 60)}_${marca}.${ext}`;
  }

  function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const PROPS_SVG = ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-dasharray", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline"];

  /* SVG autocontenido: estilos computados en línea, fondo, título arriba y atribución abajo. */
  function svgAutocontenido(svgNode, titulo, nota) {
    const vb = svgNode.viewBox && svgNode.viewBox.baseVal && svgNode.viewBox.baseVal.width
      ? svgNode.viewBox.baseVal
      : { x: 0, y: 0, width: svgNode.clientWidth || 800, height: svgNode.clientHeight || 500 };
    const W = vb.width, H = vb.height, cab = 56, base = 40;
    const clon = svgNode.cloneNode(true);
    const orig = svgNode.querySelectorAll("*");
    const copia = clon.querySelectorAll("*");
    orig.forEach((n, i) => {
      const cs = getComputedStyle(n);
      for (const p of PROPS_SVG) {
        const v = cs.getPropertyValue(p);
        if (v && v !== "none" || p === "fill") copia[i].setAttribute(p, v);
      }
      copia[i].removeAttribute("class");
    });
    const ns = "http://www.w3.org/2000/svg";
    const raiz = document.createElementNS(ns, "svg");
    raiz.setAttribute("xmlns", ns);
    raiz.setAttribute("width", W);
    raiz.setAttribute("height", H + cab + base);
    raiz.setAttribute("viewBox", `0 0 ${W} ${H + cab + base}`);
    const fuente = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    const fondo = document.createElementNS(ns, "rect");
    Object.entries({ width: W, height: H + cab + base, fill: css("--surface", "#ffffff") }).forEach(([k, v]) => fondo.setAttribute(k, v));
    raiz.append(fondo);
    const texto = (t, y, tam, color, peso) => {
      const n = document.createElementNS(ns, "text");
      Object.entries({ x: 16, y, "font-size": tam, fill: color, "font-family": fuente, "font-weight": peso || 400 })
        .forEach(([k, v]) => n.setAttribute(k, v));
      n.textContent = t;
      raiz.append(n);
    };
    texto(titulo, 26, 20, css("--texto", "#0b0b0b"), 600);
    if (nota) texto(nota, 46, 13, css("--texto-2", "#52514e"));
    clon.setAttribute("x", 0);
    clon.setAttribute("y", cab);
    clon.setAttribute("width", W);
    clon.setAttribute("height", H);
    clon.setAttribute("viewBox", `${vb.x} ${vb.y} ${W} ${H}`);
    raiz.append(clon);
    texto(pie(), H + cab + 26, 12, css("--texto-3", "#74736d"));
    return raiz;
  }

  function exportarSVG(svgNode, titulo, nota) {
    const s = new XMLSerializer().serializeToString(svgAutocontenido(svgNode, titulo, nota));
    descargar(new Blob([s], { type: "image/svg+xml;charset=utf-8" }), nombreArchivo(titulo, "svg"));
  }

  function exportarPNG(svgNode, titulo, nota, escala = 2) {
    const raiz = svgAutocontenido(svgNode, titulo, nota);
    const W = +raiz.getAttribute("width"), H = +raiz.getAttribute("height");
    const s = new XMLSerializer().serializeToString(raiz);
    const img = new Image();
    img.onload = () => {
      const lienzo = el("canvas", { width: W * escala, height: H * escala });
      const ctx = lienzo.getContext("2d");
      ctx.scale(escala, escala);
      ctx.drawImage(img, 0, 0);
      lienzo.toBlob((b) => descargar(b, nombreArchivo(titulo, "png")), "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
  }

  /* CSV para Excel en español: separador ";" , coma decimal y BOM UTF-8. */
  function exportarCSV(filas, columnas, titulo) {
    const celda = (v) => {
      if (v == null || (typeof v === "number" && Number.isNaN(v))) return "";
      if (typeof v === "number") return String(Math.round(v * 10000) / 10000).replace(".", ",");
      const t = String(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lineas = [
      columnas.map((c) => celda(c.etiqueta)).join(";"),
      ...filas.map((f) => columnas.map((c) => celda(typeof c.valor === "function" ? c.valor(f) : f[c.id])).join(";")),
      "",
      celda(pie()),
    ];
    descargar(new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" }), nombreArchivo(titulo, "csv"));
  }

  /* PNG de un bloque HTML (recuadro de detalle, comparador) con html2canvas, cargado a demanda. */
  let promesaH2C = null;
  function cargarHtml2canvas() {
    promesaH2C = promesaH2C || new Promise((ok, mal) => {
      const s = el("script", { src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" });
      s.onload = () => ok(window.html2canvas);
      s.onerror = mal;
      document.head.append(s);
    });
    return promesaH2C;
  }
  async function exportarNodoPNG(nodo, titulo) {
    const h2c = await cargarHtml2canvas();
    const marco = el("div", { class: "exportando", style: `background:${css("--surface")};padding:16px;width:${nodo.offsetWidth + 32}px` },
      nodo.cloneNode(true), el("p", { class: "pie-export" }, pie()));
    document.body.append(marco);
    try {
      const lienzo = await h2c(marco, { backgroundColor: css("--surface"), scale: 2 });
      lienzo.toBlob((b) => descargar(b, nombreArchivo(titulo, "png")), "image/png");
    } finally {
      marco.remove();
    }
  }

  /* Botonera de exportación: [{texto, accion}] */
  function botonera(acciones) {
    return el("div", { class: "botonera" }, acciones.map((a) =>
      el("button", { type: "button", class: "boton-mini", title: a.titulo || a.texto, onclick: a.accion }, a.texto)));
  }

  // --- configuración del país (web/vivo/paises/<codigo>.json) -----------------------------------------
  let config = null;
  function fijarConfig(c) { config = c; }
  function cfg() { return config; }

  /* Elección de referencia del cambio: la publica el runner ({anio, sufijo}). Los atributos de cada
     lugar traen `pct_<bloque><sufijo>` y `total<sufijo>`. */
  function ref() {
    const r = (window.OBS && OBS.datos.estado && OBS.datos.estado.referencia) || {};
    const anio = r.anio || null;
    return { anio, sufijo: r.sufijo || (anio ? String(anio).slice(2) : ""), nombre: (config && config.referencia_nombre) || "" };
  }

  function bloques() { return (config && config.bloques) || []; }
  function bloque(id) { return bloques().find((b) => b.id === id) || { id, nombre: id, plural: id, corto: id }; }
  function par() { return (config && config.par && config.par.length === 2) ? config.par : null; }

  function oscuro() {
    const tema = document.documentElement.getAttribute("data-theme");
    if (tema) return tema === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function colorBloque(id) {
    const b = bloque(id);
    return (oscuro() ? b.color_oscuro : b.color) || b.color || css("--texto-3");
  }

  /* Formatos por nombre, para las variables declaradas en la configuración. */
  function formato(nombre) {
    return { int: fmt.int, pct: fmt.pct, dec: fmt.dec, usd: fmt.usd, pp: fmt.pp }[nombre] || fmt.dec;
  }

  /* Texto con enlaces en formato [texto](https://...) -> nodos; el resto se inserta como texto. */
  function conEnlaces(texto) {
    const nodos = [];
    let resto = String(texto || "");
    const patron = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
    let m;
    while ((m = patron.exec(resto))) {
      if (m.index) nodos.push(document.createTextNode(resto.slice(0, m.index)));
      nodos.push(el("a", { href: m[2], rel: "noopener" }, m[1]));
      resto = resto.slice(m.index + m[0].length);
    }
    if (resto) nodos.push(document.createTextNode(resto));
    return nodos;
  }

  return {
    ref, fijarConfig, cfg, bloques, bloque, par, colorBloque, formato, conEnlaces, oscuro, fmt, el, css, escalaDivergente, escalaSecuencial, mostrarTip, ocultarTip,
    exportarSVG, exportarPNG, exportarCSV, exportarNodoPNG, botonera, fijarMomento, pie, vacio,
    datos: {}, // lo completa app.js: estado, historial, condados, estadosAtr, geo, fipsPorAbrev
  };
})();
