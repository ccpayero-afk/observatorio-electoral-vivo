/* Dashboard en vivo · Observatorio Electoral FCEJS-UNSL.
   Genérico por país: todo lo propio del país sale de paises/<codigo>.json (fuerzas, colores, mapa,
   unidades, pestañas, variables y textos). Lee datos/estado.json (formato v2 del runner común)
   y lo actualiza periódicamente. No declara ganadores. */
(function () {
  "use strict";

  const { fmt, el, css, escalaSecuencial, mostrarTip, ocultarTip, botonera, bloques, bloque, par, colorBloque, conEnlaces } = OBS;

  const params = new URLSearchParams(location.search);
  const PAIS = (params.get("pais") || "us").replace(/[^a-z]/g, "");
  // Cada 60 s; `?refresco=5` en la URL acelera la página para simulacros y demostraciones.
  const REFRESCO_MS = 1000 * (Number(params.get("refresco")) || 60);
  // Laboratorio de escrutinio (?laboratorio=1): niveles precalculados con `obselec laboratorio`.
  const LAB = params.has("laboratorio");

  let C = null; // configuración del país
  let geo = null;
  let estado = null;
  let historial = {};
  let unidAtr = new Map(); // código de unidad -> atributos y referencia
  let regAtr = new Map(); // código de región -> atributos, referencia, geo y nombre
  let pestana = null;
  let modo = "ventaja";
  let seleccion = null; // id de elección
  let sinDatos = null; // región elegida sin elección en la pestaña: {geo, nombre, motivo}
  const filtros = { texto: "", agrupacion: "", pobMin: null, pobMax: null, disputado: null, avanceMin: null };
  let labIndice = null;
  let labNivel = null;
  let labHistorial = {};
  let labReproduciendo = null;

  // --- votos y porcentajes ---------------------------------------------------------------------------
  const B = () => bloques().map((b) => b.id);
  function votosBloque(c, b) {
    return (c.totales || []).filter((t) => t.bloque === b).reduce((s, t) => s + t.votos, 0);
  }
  function votosCarrera(c) {
    return (c.totales || []).reduce((s, t) => s + t.votos, 0);
  }
  /* Porcentaje por bloque en el conteo, o null sin votos. */
  function pctCarrera(c) {
    const total = c ? votosCarrera(c) : 0;
    if (!total) return null;
    return Object.fromEntries(B().map((b) => [b, (100 * votosBloque(c, b)) / total]));
  }
  /* Porcentaje proyectado por bloque (publicado, o cualquiera en el laboratorio), o null. */
  function pctProyeccion(c) {
    const p = c && c.proyeccion;
    if (!p || !(p.bloques || []).length || (!p.publicada && !LAB)) return null;
    return Object.fromEntries(p.bloques.map((b) => [b.bloque, b.pct]));
  }
  function difPar(p, a, b) {
    const pr = a ? [a, b] : par();
    if (!p || !pr || p[pr[0]] == null || p[pr[1]] == null) return null;
    return p[pr[0]] - p[pr[1]];
  }
  function ventaja(p) {
    if (!p) return null;
    const orden = Object.entries(p).filter(([, v]) => v != null).sort((x, y) => y[1] - x[1]);
    if (!orden.length) return null;
    return { lider: orden[0][0], segundo: orden[1] ? orden[1][0] : null, margen: orden[1] ? orden[0][1] - orden[1][1] : orden[0][1] };
  }
  function refPct(a) {
    const s = OBS.ref().sufijo;
    if (!a || !s) return null;
    const p = Object.fromEntries(B().map((b) => [b, a[`pct_${b}${s}`]]));
    return Object.values(p).some((v) => v != null) ? p : null;
  }
  function totalRef(a) {
    const s = OBS.ref().sufijo;
    return a && s ? a[`total${s}`] : null;
  }
  function textoVentaja(v) {
    if (!v) return "sin votos todavía";
    if (v.margen < 0.05) return "empate";
    return `${bloque(v.lider).plural || bloque(v.lider).nombre} adelante por ${fmt.dec(v.margen)} pts`;
  }
  function textoCobertura(c) {
    const t = c.cobertura || "sin datos";
    return t === "unidades + total" ? `${C.unidad.plural} + total` : t;
  }
  function nombreRegion(codigo) {
    return (regAtr.get(codigo) || {}).nombre || codigo;
  }
  function geoDeRegion(codigo) {
    return (regAtr.get(codigo) || {}).geo;
  }

  // --- modos del mapa --------------------------------------------------------------------------------
  function modos() {
    const pr = par();
    const r = OBS.ref();
    const refTxt = r.anio ? `${r.nombre} ${r.anio}`.trim() : "";
    const lista = [{ id: "ventaja", etiqueta: "Quién va adelante en el conteo y por cuánto", tipo: "ventaja" }];
    if (pr) {
      const [a, b] = pr.map((x) => bloque(x).corto);
      lista.push({ id: "diferencia", etiqueta: `Diferencia ${a} − ${b} en el conteo`, tipo: "div", tope: 30 });
      lista.push({ id: "proyeccion", etiqueta: `Diferencia ${a} − ${b} proyectada (experimental)`, tipo: "div", tope: 30 });
      if (refTxt) lista.push({ id: "swing", etiqueta: `Cambio de la diferencia ${a} − ${b} respecto de la ${refTxt}`, tipo: "div", tope: 20 });
    } else {
      lista.push({ id: "proyeccion", etiqueta: "Quién va adelante en la proyección (experimental)", tipo: "ventaja" });
    }
    for (const b of bloques()) lista.push({ id: `bloque:${b.id}`, etiqueta: `% ${b.nombre}`, tipo: "sec", bloque: b.id, min: 0, max: 80 });
    if (refTxt) for (const b of bloques()) lista.push({ id: `cambio:${b.id}`, etiqueta: `Cambio de ${b.nombre} respecto de la ${refTxt}`, tipo: "cambio", bloque: b.id, tope: 15 });
    lista.push({ id: "avance", etiqueta: "% escrutado informado por la fuente", tipo: "sec", min: 0, max: 100 });
    if (refTxt) lista.push({ id: "participacion", etiqueta: `Votos contados como % de los de la ${refTxt}`, tipo: "sec", min: 0, max: 100 });
    return lista;
  }
  function modoActual() {
    const ms = modos();
    return ms.find((m) => m.id === modo) || ms[0];
  }

  /* Valor del modo para un conjunto de porcentajes: número, o {lider, margen} en los modos de ventaja. */
  function valorModo(m, p, pp, a, f, v) {
    switch (m.tipo === "sec" && m.bloque ? "bloque" : m.tipo === "cambio" ? "cambio" : m.id) {
      case "ventaja": return ventaja(p);
      case "diferencia": return difPar(p);
      case "proyeccion": return par() ? difPar(pp) : ventaja(pp);
      case "swing": { const d = difPar(p), dr = difPar(refPct(a)); return d == null || dr == null ? null : d - dr; }
      case "bloque": return p ? p[m.bloque] : null;
      case "cambio": { const rp = refPct(a); return p && rp && rp[m.bloque] != null ? p[m.bloque] - rp[m.bloque] : null; }
      case "avance": return f == null ? null : 100 * f;
      case "participacion": { const t = totalRef(a); return t && v ? (100 * v) / t : null; }
    }
    return null;
  }
  function valorRegion(c, m = modoActual()) {
    if (!c) return null;
    return valorModo(m, pctCarrera(c), pctProyeccion(c), regAtr.get(c.region), c.fraccion_fuente, votosCarrera(c));
  }
  function valorUnidad(c, u, m = modoActual()) {
    const x = (c.unidades || {})[u];
    const pc = ((c.proyeccion || {}).por_unidad || {})[u];
    const p = x && x.v > 0 ? x.p : null;
    return valorModo(m, p, pc ? pc.p : null, unidAtr.get(u), x ? x.f : null, x ? x.v : 0);
  }

  function colorModo(m, val) {
    const neutro = css("--neutro");
    if (val == null) return css("--sin-dato");
    if (m.tipo === "ventaja") {
      const t = 0.25 + 0.75 * Math.min(1, val.margen / 30);
      return d3.interpolateLab(neutro, colorBloque(val.lider))(t);
    }
    if (m.tipo === "div") {
      const [a, b] = par();
      return d3.scaleLinear().domain([-m.tope, 0, m.tope]).range([colorBloque(b), neutro, colorBloque(a)]).interpolate(d3.interpolateLab).clamp(true)(val);
    }
    if (m.tipo === "cambio") {
      return d3.scaleLinear().domain([-m.tope, 0, m.tope]).range([css("--pierde"), neutro, colorBloque(m.bloque)]).interpolate(d3.interpolateLab).clamp(true)(val);
    }
    if (m.bloque) return d3.scaleLinear().domain([m.min, m.max]).range([neutro, colorBloque(m.bloque)]).interpolate(d3.interpolateLab).clamp(true)(val);
    return escalaSecuencial(m.min, m.max)(val);
  }
  function textoModo(m, val) {
    if (val == null) return "—";
    if (m.tipo === "ventaja") return textoVentaja(val);
    if (m.tipo === "div" || m.tipo === "cambio") return fmt.pp(val) + " pts";
    return fmt.pct(val);
  }

  function dibujarLeyenda(m) {
    const leyenda = document.getElementById("leyenda");
    const caja = (color, texto) => el("span", {}, el("span", { class: "caja", style: `background:${color}` }), texto);
    const grad = (f) => d3.range(0, 1.01, 0.1).map(f).join(",");
    let partes;
    if (m.tipo === "ventaja") {
      partes = [...bloques().map((b) => caja(colorBloque(b.id), b.nombre)), el("span", { class: "nota" }, "color más intenso: mayor ventaja")];
    } else if (m.tipo === "div") {
      const [a, b] = par();
      partes = [el("span", {}, `${bloque(b).corto} +${m.tope}`), el("span", { class: "barra", style: `background:linear-gradient(90deg,${grad((t) => colorModo(m, -m.tope + 2 * m.tope * t))})` }), el("span", {}, `${bloque(a).corto} +${m.tope}`)];
    } else if (m.tipo === "cambio") {
      partes = [el("span", {}, `pierde ${m.tope}`), el("span", { class: "barra", style: `background:linear-gradient(90deg,${grad((t) => colorModo(m, -m.tope + 2 * m.tope * t))})` }), el("span", {}, `gana ${m.tope}`)];
    } else {
      partes = [el("span", {}, `${m.min}%`), el("span", { class: "barra", style: `background:linear-gradient(90deg,${grad((t) => colorModo(m, m.min + (m.max - m.min) * t))})` }), el("span", {}, `${m.max}%`)];
    }
    leyenda.replaceChildren(...partes, caja(css("--sin-dato"), "sin dato"));
  }

  // --- pestañas --------------------------------------------------------------------------------------
  function pestanasCargo() { return C.pestanas || []; }
  function esPestanaCargo(p) { return pestanasCargo().some((x) => x.id === p); }
  function carrerasPestana() {
    if (!estado) return [];
    const t = pestanasCargo().find((x) => x.id === pestana) || pestanasCargo()[0];
    return estado.carreras.filter((c) => (t && c.cargo === t.cargo) || estado.simulacro != null);
  }

  // --- filtros por región ----------------------------------------------------------------------------
  function pasaFiltros(c) {
    const a = regAtr.get(c.region) || {};
    const f = filtros;
    if (f.texto) {
      const t = f.texto.toLowerCase();
      if (!`${c.region} ${c.nombre} ${a.nombre || ""}`.toLowerCase().includes(t)) return false;
    }
    if (f.agrupacion && C.agrupacion_regiones && a[C.agrupacion_regiones.campo] !== f.agrupacion) return false;
    if (f.pobMin != null && !(a.poblacion >= f.pobMin * 1e6)) return false;
    if (f.pobMax != null && !(a.poblacion <= f.pobMax * 1e6)) return false;
    if (f.disputado != null) { const d = difPar(refPct(a)); if (!(d != null && Math.abs(d) <= f.disputado)) return false; }
    if (f.avanceMin != null && !(100 * (c.fraccion_fuente || 0) >= f.avanceMin)) return false;
    return true;
  }
  function hayFiltros() {
    return Object.values(filtros).some((v) => v !== "" && v != null);
  }
  function construirFiltros() {
    const caja = document.getElementById("filtros-estados");
    const numero = (id, etiqueta, ayuda) => el("label", { class: "filtro" }, etiqueta,
      el("input", { type: "number", step: "any", inputmode: "decimal", placeholder: ayuda, oninput: (e) => {
        const v = e.target.value === "" ? null : Number(e.target.value);
        filtros[id] = Number.isNaN(v) ? null : v;
        render();
      } }));
    const r = OBS.ref();
    const ag = C.agrupacion_regiones;
    const grupos = ag ? [...new Set([...regAtr.values()].map((a) => a[ag.campo]).filter(Boolean))].sort() : [];
    caja.replaceChildren(...[
      el("label", { class: "filtro" }, "Buscar",
        el("input", { type: "search", placeholder: `${C.region.singular[0].toUpperCase() + C.region.singular.slice(1)} o candidato`, oninput: (e) => { filtros.texto = e.target.value.trim(); render(); } })),
      ag ? el("label", { class: "filtro" }, ag.etiqueta,
        el("select", { onchange: (e) => { filtros.agrupacion = e.target.value; render(); } },
          el("option", { value: "" }, "Todas"), grupos.map((g) => el("option", { value: g }, g)))) : null,
      numero("pobMin", "Habitantes desde (millones)", "p. ej. 5"),
      numero("pobMax", "Habitantes hasta (millones)", "p. ej. 20"),
      par() && r.anio ? numero("disputado", `Diferencia ${r.anio} menor a (pts)`, "p. ej. 10") : null,
      numero("avanceMin", "Escrutado al menos (%)", "p. ej. 20"),
      el("button", { type: "button", class: "boton-mini", onclick: () => {
        Object.assign(filtros, { texto: "", agrupacion: "", pobMin: null, pobMax: null, disputado: null, avanceMin: null });
        construirFiltros();
        render();
      } }, "Limpiar filtros"),
    ].filter(Boolean)); // replaceChildren escribiría "null" por los filtros que el país no usa
  }

  // --- mapas -----------------------------------------------------------------------------------------
  function dibujarNacional() {
    if (!geo) return;
    const m = modoActual();
    const svg = d3.select("#mapa-nacional");
    const porGeo = new Map();
    for (const c of carrerasPestana()) {
      const g = geoDeRegion(c.region);
      if (g && !porGeo.has(g)) porGeo.set(g, c);
    }
    const regiones = topojson.feature(geo, geo.objects[C.geometria.objeto_regiones]).features;
    const path = C.geometria.proyectada ? d3.geoPath() : d3.geoPath(d3.geoMercator().fitSize([975, 610], { type: "FeatureCollection", features: regiones }));
    svg.selectAll("path.estado").data(regiones, (d) => d.id).join("path")
      .attr("class", (d) => {
        const c = porGeo.get(d.id);
        const elegido = sinDatos ? sinDatos.geo === d.id : Boolean(c && c.id === seleccion);
        const atenuado = hayFiltros() && !(c && pasaFiltros(c));
        return "estado" + (elegido ? " sel" : "") + (atenuado ? " atenuado" : "");
      })
      .attr("d", path)
      .attr("fill", (d) => colorModo(m, valorRegion(porGeo.get(d.id), m)))
      .on("mousemove", (ev, d) => {
        const c = porGeo.get(d.id);
        const nombre = (d.properties && d.properties.name) || d.id;
        if (!c) return mostrarTip(ev, [nombre, "Sin elección en esta pestaña"]);
        const a = regAtr.get(c.region) || {};
        mostrarTip(ev, [
          nombre, c.nombre,
          `${m.etiqueta}: ${textoModo(m, valorRegion(c, m))}`,
          `Conteo: ${textoVentaja(ventaja(pctCarrera(c)))}`,
          "Escrutado: " + fmt.pct(c.fraccion_fuente == null ? null : 100 * c.fraccion_fuente),
          a.poblacion ? "Habitantes: " + fmt.int(a.poblacion) : null,
          c.prueba ? "Datos de prueba de la fuente" : "Fuente: " + c.fuente,
        ]);
      })
      .on("mouseleave", ocultarTip)
      .on("click", (ev, d) => {
        const c = porGeo.get(d.id);
        if (c) return seleccionar(c.id);
        // Región sin elección en esta pestaña (o fuera del simulacro): avisar en lugar de no reaccionar.
        const t = pestanasCargo().find((x) => x.id === pestana);
        const nombre = (d.properties && d.properties.name) || d.id;
        sinDatos = {
          geo: d.id, nombre,
          motivo: estado.simulacro != null
            ? "El simulacro solo incluye algunas elecciones; este lugar no tiene datos."
            : `${nombre} no tiene elección de ${t ? t.titulo.toLowerCase() : "este tipo"}, o la fuente todavía no informó datos.`,
        };
        render();
        document.getElementById("detalle").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    dibujarLeyenda(m);
    document.getElementById("titulo-nacional").textContent = `${m.etiqueta}, por ${C.region.singular}`;
  }

  function unidadesDeRegion(geoRegion) {
    const todas = topojson.feature(geo, geo.objects[C.geometria.objeto_unidades]).features;
    const r = C.geometria.region_de_unidad || {};
    if (r.tipo === "prefijo") return todas.filter((f) => String(f.id).slice(0, r.largo) === geoRegion);
    const region = [...regAtr.values()].find((a) => a.geo === geoRegion);
    return todas.filter((f) => region && (unidAtr.get(String(f.id)) || {}).region === region.region);
  }

  function dibujarUnidades(c) {
    const svg = d3.select("#mapa-condados");
    const titulo = document.getElementById("titulo-condados");
    svg.selectAll("*").remove();
    if (!geo || !c) {
      titulo.textContent = `Elegí un ${C.region.singular} para ver el detalle por ${C.unidad.singular}`;
      return;
    }
    const m = modoActual();
    const features = unidadesDeRegion(geoDeRegion(c.region));
    titulo.textContent = `${c.nombre} · ${m.etiqueta}, por ${C.unidad.singular}`;
    if (!features.length) return;
    const coleccion = { type: "FeatureCollection", features };
    const proyeccionGeo = C.geometria.proyectada ? d3.geoIdentity().fitSize([975, 610], coleccion) : d3.geoMercator().fitSize([975, 610], coleccion);
    const path = d3.geoPath(proyeccionGeo);
    svg.selectAll("path.condado").data(features, (d) => d.id).join("path")
      .attr("class", "condado")
      .attr("d", path)
      .attr("fill", (d) => colorModo(m, valorUnidad(c, String(d.id), m)))
      .on("mousemove", (ev, d) => {
        const u = String(d.id);
        const x = (c.unidades || {})[u];
        const a = unidAtr.get(u) || {};
        const nombre = (d.properties && d.properties.name) || a.nombre || u;
        if (!x) return mostrarTip(ev, [nombre, `Sin datos de ${C.unidad.singular} en la fuente`]);
        const pc = ((c.proyeccion || {}).por_unidad || {})[u];
        const rp = refPct(a);
        mostrarTip(ev, [
          nombre,
          bloques().map((b) => `${b.corto} ${fmt.pct(x.p ? x.p[b.id] : null)}`).join(" · "),
          `Votos contados: ${fmt.int(x.v)} · escrutado ${fmt.pct(x.f == null ? null : 100 * x.f)}`,
          rp ? `${OBS.ref().nombre} ${OBS.ref().anio}: ` + bloques().map((b) => `${b.corto} ${fmt.pct(rp[b.id])}`).join(" · ") : null,
          pc ? `Proyección (experimental): ${textoVentaja(ventaja(pc.p))}` : null,
          a.poblacion ? `Habitantes: ${fmt.int(a.poblacion)}${a.densidad != null ? ` · ${fmt.int(a.densidad)} por km²` : ""}` : null,
        ]);
      })
      .on("mouseleave", ocultarTip);
  }

  // --- detalle de una elección -----------------------------------------------------------------------
  function barra(nombre, color, pct, margen) {
    const pista = el("div", { class: "pista" },
      el("div", { class: "relleno", style: `width:${Math.max(0, Math.min(100, pct || 0))}%;background:${color}` }));
    if (margen != null && pct != null) {
      const a = Math.max(0, pct - margen), b = Math.min(100, pct + margen);
      pista.append(el("div", { class: "banda", style: `left:${a}%;width:${b - a}%` }));
    }
    return el("div", { class: "fila-barra" }, el("span", {}, nombre), pista,
      el("span", { class: "num" }, fmt.pct(pct) + (margen != null ? " ±" + fmt.dec(margen) : "")));
  }

  function textoSituacion(s) {
    if (!s) return null;
    if (s.tipo === "preferencial") return s.nota;
    const partes = [];
    if (s.diferencia != null) {
      partes.push(`Diferencia proyectada entre los dos primeros: ${fmt.pp(s.diferencia)} pts (margen ±${fmt.dec(s.margen_diferencia || 0)}).`);
      if (s.diferencia_dentro_del_margen) partes.push("La diferencia está dentro del margen.");
    }
    if (s.prob_segunda_vuelta != null) {
      partes.push(`Probabilidad aproximada de que nadie supere el umbral (segunda vuelta): ${Math.round(100 * s.prob_segunda_vuelta)}%.`);
    }
    if (s.nota) partes.push(s.nota);
    return partes.join(" ");
  }

  /* Par con que se mide el error en el laboratorio: el principal del país o los dos primeros del final. */
  function parComparacion(c) {
    if (par()) return par();
    const v = ventaja(c.final && c.final.p);
    return v && v.segundo ? [v.lider, v.segundo] : null;
  }

  function bloqueFinal(c) {
    const pr = parComparacion(c);
    if (!pr) return null;
    const fin = difPar(c.final.p, ...pr);
    const mc = difPar(pctCarrera(c), ...pr);
    const mp = difPar(pctProyeccion(c), ...pr);
    const fila = (nombre, v, err) => el("tr", {}, el("td", {}, nombre), el("td", { class: "num" }, v == null ? "—" : fmt.pp(v)),
      el("td", { class: "num" }, err == null ? "—" : fmt.pp(err)));
    const [a, b] = pr.map((x) => bloque(x).corto);
    return el("div", { class: "comparacion-final" },
      el("h4", {}, "Comparación con el resultado final"),
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", { class: "num" }, `Diferencia ${a} − ${b}`), el("th", { class: "num" }, "Error contra el final"))),
        el("tbody", {},
          fila(`Conteo con ${labNivel}% escrutado`, mc, mc == null || fin == null ? null : mc - fin),
          fila("Proyección en ese momento", mp, mp == null || fin == null ? null : mp - fin),
          fila("Resultado final", fin, null))),
      el("p", { class: "nota" }, `Error positivo: sobrestima a ${bloque(pr[0]).plural}; negativo: a ${bloque(pr[1]).plural}.`));
  }

  function dibujarDetalle(c) {
    const caja = document.getElementById("detalle");
    if (!c) { caja.hidden = true; return; }
    caja.hidden = false;
    const a = regAtr.get(c.region) || {};
    const rp = refPct(a);
    const r = OBS.ref();
    const swing = valorRegion(c, { id: "swing", tipo: "div" });
    const contenido = el("div", { class: "detalle-contenido" },
      el("h3", {}, c.nombre, " ", c.prueba ? el("span", { class: "etiqueta prueba" }, "datos de prueba") : null),
      el("p", { class: "nota" },
        `Fuente: ${c.fuente || "—"} · ${textoCobertura(c)} · actualizado ${fmt.hora(c.momento)}`,
        c.desactualizado ? " · sin respuesta en el último ciclo, se muestra el dato anterior" : ""),
      el("h4", {}, "Conteo actual"),
      el("div", { class: "barras" }, (c.totales || []).map((t) =>
        barra(`${t.opcion} (${t.partido || "s/p"})`, colorBloque(t.bloque), t.pct, null))),
      el("p", { class: "nota" },
        `Escrutado según la fuente: ${fmt.pct(c.fraccion_fuente == null ? null : 100 * c.fraccion_fuente)} · votos contados: ${fmt.int(votosCarrera(c))}`,
        rp ? ` · ${r.nombre} ${r.anio} en el ${C.region.singular}: ` + bloques().map((b) => `${b.corto} ${fmt.pct(rp[b.id])}`).join(", ") : "",
        par() && swing != null ? ` · cambio de la diferencia: ${fmt.pp(swing)} pts` : ""),
    );
    if (LAB && c.final) { const bf = bloqueFinal(c); if (bf) contenido.append(bf); }
    const p = c.proyeccion;
    if (p) {
      contenido.append(el("h4", {}, "Proyección ", el("span", { class: "etiqueta exp" }, "experimental")));
      if (LAB && !p.publicada && (p.bloques || []).length) {
        contenido.append(el("p", { class: "nota aviso-lab" }, "Debajo del umbral de publicación: en la noche real esta proyección no se mostraría. Se ve solo en el laboratorio."));
      }
      if (p.publicada || (LAB && (p.bloques || []).length)) {
        contenido.append(
          el("div", { class: "barras" }, (p.bloques || []).map((b) =>
            barra(`${bloque(b.bloque).nombre}${b.nombres && b.nombres.length === 1 ? " · " + b.nombres[0] : ""}`, colorBloque(b.bloque), b.pct, b.margen))),
          el("p", { class: "nota" }, textoSituacion(p.situacion)),
          el("p", { class: "nota" },
            `Votos esperados contados: ${fmt.pct(100 * p.fraccion_estimada)} · ${C.unidad.plural} con datos: ${p.unidades_con_datos} de ${p.unidades} · efecto propio ${p.efecto_propio}.`),
        );
      } else {
        contenido.append(el("p", { class: "nota" }, `Sin proyección publicada. ${p.motivo || ""}`));
      }
    }
    if (c.control && c.control.some((x) => x.alerta)) {
      contenido.append(el("p", { class: "nota" }, "Control cruzado: hay diferencias mayores a 0,5% entre la fuente principal y el sitio oficial."));
    }
    const serie = historial[c.id] || [];
    const figura = el("figure", { class: "mapa evolucion" },
      el("figcaption", {}, par() ? `Evolución: diferencia ${bloque(par()[0]).corto} − ${bloque(par()[1]).corto} en el conteo y proyectada (con su banda)` : "Evolución: porcentaje de cada fuerza en el conteo (línea llena) y proyectado (punteada)"));
    const svgEvol = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEvol.setAttribute("viewBox", "0 0 760 240");
    svgEvol.setAttribute("role", "img");
    svgEvol.setAttribute("aria-label", "Evolución del conteo y la proyección");
    figura.append(svgEvol);
    contenido.append(figura);
    caja.replaceChildren(
      botonera([
        { texto: "PNG del recuadro", accion: () => OBS.exportarNodoPNG(contenido, c.nombre) },
        { texto: "PNG evolución", accion: () => OBS.exportarPNG(svgEvol, `${c.nombre} · evolución`, "Proyección experimental.") },
        { texto: "SVG evolución", accion: () => OBS.exportarSVG(svgEvol, `${c.nombre} · evolución`, "Proyección experimental.") },
        { texto: `CSV por ${C.unidad.singular}`, accion: () => OBS.exportarCSV(filasUnidadesCarrera(c), columnasUnidad(), `${c.nombre} por ${C.unidad.singular}`) },
        { texto: "CSV evolución", accion: () => OBS.exportarCSV(serie, columnasEvolucion(), `${c.nombre} evolución`) },
      ]),
      contenido,
    );
    dibujarEvolucion(svgEvol, serie, c);
  }

  function columnasUnidad() {
    return [
      { id: "codigo", etiqueta: C.unidad.codigo || "Código" }, { id: "nombre", etiqueta: C.unidad.singular },
      { id: "v", etiqueta: "Votos contados" }, { id: "f", etiqueta: "Escrutado (%)" },
      ...bloques().map((b) => ({ id: `p_${b.id}`, etiqueta: `${b.nombre} (%)` })),
      ...bloques().map((b) => ({ id: `pp_${b.id}`, etiqueta: `${b.nombre} proyectado (%)` })),
      ...bloques().map((b) => ({ id: `ref_${b.id}`, etiqueta: `${b.nombre} en la referencia (%)` })),
      { id: "poblacion", etiqueta: "Habitantes" },
    ];
  }
  function filasUnidadesCarrera(c) {
    return Object.entries(c.unidades || {}).map(([u, x]) => {
      const a = unidAtr.get(u) || {};
      const pc = ((c.proyeccion || {}).por_unidad || {})[u];
      const rp = refPct(a) || {};
      const fila = { codigo: u, nombre: a.nombre || u, v: x.v, f: x.f == null ? null : 100 * x.f, poblacion: a.poblacion };
      for (const b of B()) {
        fila[`p_${b}`] = x.p ? x.p[b] : null;
        fila[`pp_${b}`] = pc ? pc.p[b] : null;
        fila[`ref_${b}`] = rp[b];
      }
      return fila;
    });
  }
  function columnasEvolucion() {
    return [
      { id: LAB ? "x" : "t", etiqueta: LAB ? "Escrutinio (%)" : "Momento (UTC)" }, { id: "f", etiqueta: "Escrutado (fracción)" }, { id: "v", etiqueta: "Votos contados" },
      ...bloques().map((b) => ({ etiqueta: `${b.nombre} conteo (%)`, valor: (p) => (p.p || {})[b.id] })),
      ...bloques().map((b) => ({ etiqueta: `${b.nombre} proyectado (%)`, valor: (p) => (p.pp || {})[b.id] })),
      { id: "m", etiqueta: "Margen de la diferencia (±)" },
    ];
  }

  /* Gráfico de evolución con un solo eje: la diferencia del par principal si el país lo define,
     o el porcentaje de cada fuerza si no. El eje x es el tiempo, o el escrutinio en el laboratorio. */
  function dibujarEvolucion(svgNode, serie, c) {
    const svg = d3.select(svgNode);
    svg.selectAll("*").remove();
    const W = 760, H = 240, m = { t: 12, r: 16, b: 28, l: 44 };
    const pts = serie.filter((p) => (LAB ? p.x != null : p.t) && p.p).map((p) => ({ ...p, eje: LAB ? p.x : new Date(p.t) }));
    if (pts.length < 2) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").attr("class", "vacio")
        .text("Todavía no hay suficientes actualizaciones para dibujar la evolución.");
      return;
    }
    const x = LAB ? d3.scaleLinear().domain([0, 100]).range([m.l, W - m.r]) : d3.scaleTime().domain(d3.extent(pts, (p) => p.eje)).range([m.l, W - m.r]);
    const pr = par();
    let series;
    let yFinal = null;
    if (pr) {
      series = [
        { nombre: "conteo", clase: "linea-conteo", valores: pts.map((p) => ({ eje: p.eje, y: difPar(p.p) })) },
        { nombre: "proyección", clase: "linea-proy", banda: true, valores: pts.filter((p) => p.pp).map((p) => ({ eje: p.eje, y: difPar(p.pp), m: p.m })) },
      ];
      if (LAB && c.final) yFinal = difPar(c.final.p);
    } else {
      series = bloques().flatMap((b) => [
        { nombre: b.corto, color: colorBloque(b.id), valores: pts.map((p) => ({ eje: p.eje, y: p.p[b.id] })) },
        { nombre: `${b.corto} proy.`, color: colorBloque(b.id), punteada: true, valores: pts.filter((p) => p.pp && p.pp[b.id] != null).map((p) => ({ eje: p.eje, y: p.pp[b.id] })) },
      ]);
    }
    series.forEach((s) => { s.valores = s.valores.filter((v) => v.y != null); });
    const vals = series.flatMap((s) => s.valores.flatMap((v) => (s.banda ? [v.y - (v.m || 0), v.y + (v.m || 0)] : [v.y]))).concat(pr ? [0] : [0, 50]);
    if (yFinal != null) vals.push(yFinal);
    const ext = d3.extent(vals);
    const pad = Math.max(1, (ext[1] - ext[0]) * 0.1);
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "eje").attr("transform", `translate(0,${H - m.b})`)
      .call(LAB ? d3.axisBottom(x).ticks(10).tickFormat((v) => v + "%") : d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat("%H:%M")));
    svg.append("g").attr("class", "eje").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => (pr ? (v > 0 ? "+" : "") + v : v + "%")));
    if (pr) svg.append("line").attr("class", "cero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
    if (LAB && labNivel != null) svg.append("line").attr("class", "marca-nivel").attr("x1", x(labNivel)).attr("x2", x(labNivel)).attr("y1", m.t).attr("y2", H - m.b);
    for (const s of series) {
      if (!s.valores.length) continue;
      if (s.banda) {
        svg.append("path").attr("class", "banda-area")
          .attr("d", d3.area().x((v) => x(v.eje)).y0((v) => y(v.y - (v.m || 0))).y1((v) => y(v.y + (v.m || 0)))(s.valores));
      }
      const linea = svg.append("path").attr("d", d3.line().x((v) => x(v.eje)).y((v) => y(v.y))(s.valores));
      if (s.clase) linea.attr("class", s.clase);
      else linea.attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2).attr("stroke-dasharray", s.punteada ? "5 4" : null);
      const ult = s.valores[s.valores.length - 1];
      if (!s.punteada) svg.append("text").attr("class", "etiqueta-linea").attr("x", x(ult.eje) - 4).attr("y", y(ult.y) + (s.banda ? 16 : -6)).attr("text-anchor", "end").text(s.nombre);
    }
    if (yFinal != null) {
      svg.append("line").attr("class", "linea-final").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(yFinal)).attr("y2", y(yFinal));
      svg.append("text").attr("class", "etiqueta-linea").attr("x", m.l + 6).attr("y", y(yFinal) + 14).text(`resultado final ${fmt.pp(yFinal)}`);
    }
    const guia = svg.append("line").attr("class", "guia").attr("y1", m.t).attr("y2", H - m.b).style("display", "none");
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b)
      .attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const t = x.invert(mx);
        const p = pts[Math.max(0, Math.min(pts.length - 1, d3.bisector((q) => q.eje).center(pts, t)))];
        guia.style("display", null).attr("x1", x(p.eje)).attr("x2", x(p.eje));
        const linea = (et, q, extra) => `${et}: ` + (pr ? `${fmt.pp(difPar(q))} pts${extra || ""}` : bloques().map((b) => `${b.corto} ${fmt.pct(q[b.id])}`).join(" · "));
        mostrarTip(ev, [
          LAB ? `Escrutinio: ${p.x}% de los votos finales` : fmt.hora(p.t),
          `Escrutado según la fuente: ${fmt.pct(p.f == null ? null : 100 * p.f)} · votos ${fmt.int(p.v)}`,
          linea("Conteo", p.p),
          p.pp ? linea("Proyección", p.pp, p.m != null ? ` ± ${fmt.dec(p.m)}` : "") + (p.bajo_umbral ? " (debajo del umbral)" : "") : "Proyección no publicada en ese momento",
          yFinal != null ? `Resultado final: ${fmt.pp(yFinal)} pts` : null,
        ]);
      })
      .on("mouseleave", () => { guia.style("display", "none"); ocultarTip(); });
  }

  // --- tablas ----------------------------------------------------------------------------------------
  function textoProyeccion(c) {
    const pp = pctProyeccion(c);
    const p = c.proyeccion;
    if (!pp) return p ? "no publicada" : "—";
    const m = (p.situacion || {}).margen_diferencia;
    const base = par() ? `${fmt.pp(difPar(pp))} pts` : textoVentaja(ventaja(pp));
    return `${base}${m != null ? " ± " + fmt.dec(m) : ""}${!p.publicada ? " (bajo umbral)" : ""}`;
  }
  function celdasLab(c) {
    const pr = parComparacion(c);
    const fin = pr && c.final ? difPar(c.final.p, ...pr) : null;
    const mc = pr ? difPar(pctCarrera(c), ...pr) : null;
    const mp = pr ? difPar(pctProyeccion(c), ...pr) : null;
    return [
      el("td", { class: "num" }, fin == null ? "—" : fmt.pp(fin)),
      el("td", { class: "num" }, fin == null || mc == null ? "—" : fmt.pp(mc - fin)),
      el("td", { class: "num" }, fin == null || mp == null ? "—" : fmt.pp(mp - fin)),
    ];
  }
  function columnasCarreras() {
    const r = OBS.ref();
    return [
      { etiqueta: C.region.singular, valor: (c) => nombreRegion(c.region) },
      { id: "nombre", etiqueta: "Elección" },
      ...bloques().map((b) => ({ etiqueta: `${b.nombre} conteo (%)`, valor: (c) => (pctCarrera(c) || {})[b.id] })),
      { etiqueta: "Votos contados", valor: (c) => votosCarrera(c) },
      { etiqueta: "Escrutado (%)", valor: (c) => (c.fraccion_fuente == null ? null : 100 * c.fraccion_fuente) },
      ...(par() && r.anio ? [{ etiqueta: `Cambio de la diferencia respecto de ${r.anio}`, valor: (c) => valorRegion(c, { id: "swing", tipo: "div" }) }] : []),
      { etiqueta: "Proyección (experimental)", valor: (c) => textoProyeccion(c) },
      { etiqueta: "Habitantes", valor: (c) => (regAtr.get(c.region) || {}).poblacion },
      { id: "fuente", etiqueta: "Fuente" },
      { etiqueta: "Datos de prueba", valor: (c) => (c.prueba ? "sí" : "no") },
    ];
  }

  function tablaCarreras(carreras, titulo) {
    const t = document.getElementById("t-carreras");
    const visibles = carreras.filter(pasaFiltros);
    const r = OBS.ref();
    const cab = [C.region.singular[0].toUpperCase() + C.region.singular.slice(1), "Elección", ...bloques().map((b) => b.corto), "Escrutado"];
    if (par() && r.anio) cab.push(`Cambio vs ${r.anio}`);
    cab.push("Proyección");
    if (LAB) cab.push("Final", "Error del conteo", "Error de la proyección");
    cab.push("Habitantes", "Fuente");
    const filas = visibles.map((c) => {
      const p = pctCarrera(c) || {};
      const sw = par() && r.anio ? valorRegion(c, { id: "swing", tipo: "div" }) : undefined;
      return el("tr", { class: "clic" + (c.id === seleccion ? " fila-sel" : ""), onclick: () => seleccionar(c.id) },
        el("td", {}, nombreRegion(c.region)),
        el("td", {}, c.nombre, c.prueba ? el("span", { class: "etiqueta prueba", style: "margin-left:6px" }, "prueba") : null),
        bloques().map((b) => el("td", { class: "num" }, fmt.pct(p[b.id]))),
        el("td", { class: "num" }, fmt.pct(c.fraccion_fuente == null ? null : 100 * c.fraccion_fuente)),
        sw !== undefined ? el("td", { class: "num" }, sw == null ? "—" : fmt.pp(sw)) : null,
        el("td", { class: "num" }, textoProyeccion(c)),
        LAB ? celdasLab(c) : null,
        el("td", { class: "num" }, fmt.int((regAtr.get(c.region) || {}).poblacion)),
        el("td", {}, (c.fuente || "—") + (c.desactualizado ? " (dato anterior)" : "")),
      );
    });
    t.replaceChildren(el("thead", {}, el("tr", {}, cab.map((h, i) => el("th", { class: i >= 2 && i < cab.length - 1 ? "num" : null }, h)))), el("tbody", {}, filas));
    document.getElementById("titulo-carreras").textContent = titulo;
    document.getElementById("t-carreras-pie").replaceChildren(
      el("span", { class: "nota" }, `${visibles.length} de ${carreras.length} elecciones${hayFiltros() ? " (con filtros)" : ""}`),
      botonera([{ texto: "Exportar CSV", accion: () => OBS.exportarCSV(visibles, columnasCarreras(), titulo) }]),
    );
  }

  function tablaSecundarias() {
    if (!C.secundarias) return;
    const sec = estado.secundarias || { carreras: [] };
    const v = sec.votos_por_bloque || {};
    const total = Object.values(v).reduce((s, x) => s + x, 0);
    document.getElementById("secundarias-resumen").replaceChildren(
      el("div", { class: "tarjeta" }, el("div", { class: "v" }, `${sec.leidas || 0} / ${sec.total || 0}`), el("div", { class: "l" }, "elecciones leídas")),
      ...bloques().map((b) => el("div", { class: "tarjeta" },
        el("div", { class: "v" }, total ? fmt.pct((100 * (v[b.id] || 0)) / total) : "—"),
        el("div", { class: "l" }, `${b.nombre} · voto agregado (${fmt.int(v[b.id] || 0)})`))),
    );
    const lista = sec.carreras || [];
    const cols = [
      { etiqueta: C.secundarias.columna || "Elección", valor: (c) => c.distrito || c.nombre },
      ...bloques().map((b) => ({ etiqueta: `${b.nombre} (%)`, valor: (c) => (pctCarrera(c) || {})[b.id], f: fmt.pct })),
      { etiqueta: "Votos contados", valor: (c) => votosCarrera(c), f: fmt.int },
      { etiqueta: "Escrutado (%)", valor: (c) => (c.fraccion_fuente == null ? null : 100 * c.fraccion_fuente), f: fmt.pct },
      { etiqueta: "Fuente", valor: (c) => (c.prueba ? "prueba" : c.fuente || "—") },
    ];
    document.getElementById("t-secundarias").replaceChildren(
      el("thead", {}, el("tr", {}, cols.map((k) => el("th", { class: k.f ? "num" : null }, k.etiqueta)))),
      el("tbody", {}, lista.map((c) => el("tr", {}, cols.map((k) => el("td", { class: k.f ? "num" : null }, k.f ? k.f(k.valor(c)) : k.valor(c)))))));
    document.getElementById("t-secundarias-pie").replaceChildren(botonera([{ texto: "Exportar CSV", accion: () => OBS.exportarCSV(lista, cols.map((k) => ({ etiqueta: k.etiqueta, valor: k.valor })), C.secundarias.titulo) }]));
  }

  function tablaCobertura() {
    const todas = [...estado.carreras, ...((estado.secundarias || {}).carreras || [])];
    const cols = [
      { etiqueta: C.region.singular, valor: (c) => nombreRegion(c.region) }, { id: "nombre", etiqueta: "Elección" },
      { etiqueta: "Cobertura", valor: (c) => textoCobertura(c) }, { id: "fuente", etiqueta: "Fuente" },
      { etiqueta: "Datos de prueba", valor: (c) => (c.prueba ? "sí" : "no") },
      { etiqueta: "Dato anterior", valor: (c) => (c.desactualizado ? "sí" : "no") },
      { etiqueta: "Actualizado", valor: (c) => fmt.hora(c.momento) },
    ];
    document.getElementById("t-cobertura").replaceChildren(
      el("thead", {}, el("tr", {}, cols.map((k) => el("th", {}, k.etiqueta)))),
      el("tbody", {}, todas.map((c) => el("tr", {}, cols.map((k) => el("td", {}, k.valor ? k.valor(c) : c[k.id]))))));
    document.getElementById("t-cobertura-pie").replaceChildren(botonera([{ texto: "Exportar CSV", accion: () => OBS.exportarCSV(todas, cols, "Cobertura y fuentes") }]));
  }

  // --- avisos y laboratorio --------------------------------------------------------------------------
  function avisos() {
    const caja = document.getElementById("aviso");
    const lista = [];
    if (estado.simulacro != null) {
      const desc = typeof estado.simulacro === "string" ? estado.simulacro : `se reproducen elecciones pasadas (${[].concat(estado.simulacro).join(", ")})`;
      lista.push(el("div", { class: "critico" }, `SIMULACRO: ${desc}. No son resultados de esta elección.`));
    }
    if (estado.carreras.some((c) => c.prueba)) lista.push(el("div", { class: "critico" }, "Hay elecciones con datos de prueba de la fuente (votos simulados antes de la elección). No son resultados."));
    const desact = estado.carreras.filter((c) => c.desactualizado).length;
    if (desact) lista.push(el("div", {}, `${desact} elecciones sin respuesta en el último ciclo; se muestra su dato anterior.`));
    const edad = (Date.now() - new Date(estado.generado).getTime()) / 1000;
    if (edad > 300 && !LAB) lista.push(el("div", {}, `El estado tiene ${Math.round(edad / 60)} minutos; el proceso de actualización puede estar detenido.`));
    if (estado.version !== 2) lista.push(el("div", { class: "critico" }, "Los datos tienen un formato anterior. Volvé a correr el runner o el laboratorio."));
    caja.replaceChildren(...lista);
    caja.hidden = !lista.length;
  }

  function resumenLab() {
    const rs = (estado.carreras || []).filter((c) => c.final && parComparacion(c));
    const ec = [], ep = [];
    let mejor = 0;
    for (const c of rs) {
      const pr = parComparacion(c);
      const fin = difPar(c.final.p, ...pr), mc = difPar(pctCarrera(c), ...pr), mp = difPar(pctProyeccion(c), ...pr);
      if (fin == null) continue;
      if (mc != null) ec.push(Math.abs(mc - fin));
      if (mp != null) ep.push(Math.abs(mp - fin));
      if (mc != null && mp != null && Math.abs(mp - fin) < Math.abs(mc - fin)) mejor += 1;
    }
    return { ec: ec.length ? d3.mean(ec) : null, ep: ep.length ? d3.mean(ep) : null, mejor, n: rs.length };
  }
  function dibujarBarraLab() {
    const caja = document.getElementById("barra-laboratorio");
    if (!LAB || !labIndice || !estado) return;
    const r = resumenLab();
    caja.querySelector(".valor-lab").textContent = `${labNivel}%`;
    caja.querySelector(".resumen-lab").replaceChildren(
      el("span", {}, `Error medio de la diferencia contra el final: conteo ${fmt.dec(r.ec)} pts · proyección ${fmt.dec(r.ep)} pts`),
      el("span", {}, `La proyección quedó más cerca del final que el conteo en ${r.mejor} de ${r.n} elecciones`));
  }
  async function irANivel(i) {
    const niveles = labIndice.niveles;
    const k = Math.max(0, Math.min(niveles.length - 1, i));
    labNivel = niveles[k];
    document.getElementById("rango-lab").value = k;
    await cargarEstado();
  }
  async function prepararLaboratorio() {
    labIndice = await json("datos/laboratorio/indice.json", true);
    const caja = document.getElementById("barra-laboratorio");
    if (!labIndice) {
      caja.hidden = false;
      caja.replaceChildren(el("p", {}, "No hay datos del laboratorio. Generalos con: obselec laboratorio"));
      return;
    }
    const h = await json("datos/laboratorio/historial.json", true);
    labHistorial = (h && h.carreras) || {};
    const niveles = labIndice.niveles;
    const inicial = Math.max(0, niveles.indexOf(20));
    labNivel = niveles[inicial];
    const rango = el("input", { type: "range", id: "rango-lab", min: 0, max: niveles.length - 1, step: 1, value: inicial,
      "aria-label": "Nivel de escrutinio", oninput: (e) => irANivel(Number(e.target.value)) });
    const reproducir = el("button", { type: "button", class: "boton-mini", onclick: () => {
      if (labReproduciendo) { clearInterval(labReproduciendo); labReproduciendo = null; reproducir.textContent = "▶ Reproducir"; return; }
      reproducir.textContent = "⏸ Pausa";
      if (labNivel === niveles[niveles.length - 1]) irANivel(0);
      labReproduciendo = setInterval(() => {
        const k = niveles.indexOf(labNivel);
        if (k >= niveles.length - 1) { clearInterval(labReproduciendo); labReproduciendo = null; reproducir.textContent = "▶ Reproducir"; return; }
        irANivel(k + 1);
      }, 1500);
    } }, "▶ Reproducir");
    caja.replaceChildren(
      el("div", { class: "fila-lab" },
        el("strong", {}, "Laboratorio de escrutinio"),
        el("span", { class: "nota" }, `Todas las elecciones con el mismo porcentaje de sus votos finales contados. ${labIndice.descripcion}.`)),
      el("div", { class: "fila-lab controles-lab" },
        el("button", { type: "button", class: "boton-mini", onclick: () => irANivel(niveles.indexOf(labNivel) - 1) }, "◀"),
        el("div", { class: "pista-lab" }, rango, el("div", { class: "marcas-lab" }, niveles.map((n) => el("span", {}, n + "%")))),
        el("button", { type: "button", class: "boton-mini", onclick: () => irANivel(niveles.indexOf(labNivel) + 1) }, "▶"),
        el("span", { class: "valor-lab" }, `${labNivel}%`),
        reproducir),
      el("div", { class: "resumen-lab" }));
    caja.hidden = false;
  }

  // --- render ----------------------------------------------------------------------------------------
  function seleccionar(id) {
    seleccion = id;
    sinDatos = null;
    render();
    document.getElementById("detalle").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function render() {
    if (!estado || !C) return;
    document.getElementById("estado-gen").textContent = LAB
      ? `Laboratorio de escrutinio · ${labNivel}% de los votos contados`
      : `Actualizado ${fmt.hora(estado.generado)} · ciclo ${estado.ciclo} · se refresca cada ${REFRESCO_MS / 1000} s`;
    avisos();
    dibujarBarraLab();
    if (esPestanaCargo(pestana)) {
      if (!sinDatos && (!seleccion || !carrerasPestana().some((x) => x.id === seleccion))) {
        // Por defecto, la elección con más votos contados de la pestaña.
        const conVotos = carrerasPestana().filter((x) => votosCarrera(x) > 0).sort((a, b) => votosCarrera(b) - votosCarrera(a))[0];
        seleccion = conVotos ? conVotos.id : null;
      }
      dibujarNacional();
      if (sinDatos) {
        dibujarUnidades(null);
        document.getElementById("titulo-condados").textContent = `${sinDatos.nombre} · sin datos`;
        const caja = document.getElementById("detalle");
        caja.replaceChildren(el("h3", {}, sinDatos.nombre), el("p", { class: "nota" }, sinDatos.motivo));
        caja.hidden = false;
      } else {
        const c = estado.carreras.find((x) => x.id === seleccion);
        dibujarUnidades(c);
        dibujarDetalle(c);
      }
      const t = pestanasCargo().find((x) => x.id === pestana);
      tablaCarreras(carrerasPestana(), estado.simulacro != null ? "Elecciones del simulacro" : (t ? t.titulo : ""));
    } else {
      document.getElementById("detalle").hidden = true;
    }
    tablaSecundarias();
    tablaCobertura();
    document.dispatchEvent(new CustomEvent("obs:datos"));
  }

  // --- carga -----------------------------------------------------------------------------------------
  async function json(url, opcional) {
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      if (opcional) return null;
      throw e;
    }
  }

  async function cargarEstado() {
    try {
      if (LAB) {
        estado = await json(`datos/laboratorio/${String(labNivel).padStart(3, "0")}.json`);
        historial = labHistorial;
      } else {
        estado = await json("datos/estado.json");
        const h = await json("datos/historial.json", true);
        historial = (h && h.carreras) || {};
      }
      OBS.fijarMomento(estado.generado);
      Object.assign(OBS.datos, {
        estado, historial, valorUnidad, valorRegion, pctCarrera, pctProyeccion, votosCarrera, votosBloque,
        difPar, ventaja, refPct, totalRef, textoVentaja, nombreRegion,
      });
      opcionesModo();
      if (OBS.datos.refFiltros !== OBS.ref().anio) { OBS.datos.refFiltros = OBS.ref().anio; construirFiltros(); }
      render();
    } catch (e) {
      document.getElementById("estado-gen").textContent = "No se pudo leer el estado (" + e.message + "). Reintento en un momento.";
    }
  }

  function opcionesModo() {
    const sel = document.getElementById("modo-mapa");
    const ms = modos();
    if (!ms.some((m) => m.id === modo)) modo = ms[0].id;
    sel.replaceChildren(...ms.map((m) => el("option", { value: m.id }, m.etiqueta)));
    sel.value = modo;
  }

  /* Arma la página a partir de la configuración del país: textos, pestañas y secciones. */
  function armarPagina() {
    document.title = C.titulo_corto || C.titulo;
    document.getElementById("sobretitulo").textContent = C.sobretitulo || "";
    document.getElementById("titulo").textContent = C.titulo;
    document.getElementById("atribucion").replaceChildren(...conEnlaces(C.atribucion));
    document.getElementById("pie").replaceChildren(...conEnlaces(C.pie));
    document.getElementById("metodo").replaceChildren(el("h2", {}, "Cómo leer esta página"), ...(C.metodo || []).map((t) => el("p", {}, ...conEnlaces(t))));
    if (C.secundarias) {
      document.getElementById("titulo-secundarias").textContent = C.secundarias.titulo;
      document.getElementById("nota-secundarias").textContent = C.secundarias.nota || "";
    }
    const botones = [
      ...pestanasCargo().map((t) => [t.id, t.titulo]),
      ...(C.secundarias ? [["secundarias", C.secundarias.titulo]] : []),
      ["analisis", "Análisis"], ["cobertura", "Cobertura y fuentes"], ["metodo", "Cómo leer esta página"],
    ];
    const nav = document.getElementById("pestanas");
    nav.replaceChildren(...botones.map(([id, t]) => el("button", { role: "tab", "data-p": id, "aria-selected": "false" }, t)));
    nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => elegirPestana(b.dataset.p)));
    document.getElementById("exportar-nacional").replaceChildren(botonera([
      { texto: "PNG", accion: () => OBS.exportarPNG(document.getElementById("mapa-nacional"), document.getElementById("titulo-nacional").textContent) },
      { texto: "SVG", accion: () => OBS.exportarSVG(document.getElementById("mapa-nacional"), document.getElementById("titulo-nacional").textContent) },
    ]));
    document.getElementById("exportar-condados").replaceChildren(botonera([
      { texto: "PNG", accion: () => OBS.exportarPNG(document.getElementById("mapa-condados"), document.getElementById("titulo-condados").textContent) },
      { texto: "SVG", accion: () => OBS.exportarSVG(document.getElementById("mapa-condados"), document.getElementById("titulo-condados").textContent) },
    ]));
    document.getElementById("modo-mapa").addEventListener("change", (e) => { modo = e.target.value; render(); });
  }

  function elegirPestana(p) {
    pestana = p;
    const panel = esPestanaCargo(p) ? "cargo" : p;
    document.querySelectorAll("#pestanas button").forEach((x) => x.setAttribute("aria-selected", x.dataset.p === p ? "true" : "false"));
    document.querySelectorAll("section[data-panel]").forEach((s) => { s.hidden = s.dataset.panel !== panel; });
    const conMapas = esPestanaCargo(p);
    document.getElementById("p-mapas").hidden = !conMapas;
    document.getElementById("controles-mapa").hidden = !conMapas;
    document.querySelector("[data-panel-filtros]").hidden = !conMapas;
    history.replaceState(null, "", location.pathname + location.search + "#" + p);
    render();
  }

  async function iniciar() {
    C = await json(`paises/${PAIS}.json`);
    OBS.fijarConfig(C);
    armarPagina();
    const [u, r] = await Promise.all([json("datos/unidades.json", true), json("datos/regiones.json", true)]);
    if (u) unidAtr = new Map(u.filas.map((f) => [String(f.unidad), f]));
    if (r) regAtr = new Map(r.filas.map((f) => [f.region, f]));
    Object.assign(OBS.datos, { unidAtr, regAtr, config: C });
    construirFiltros();
    fetch(C.geometria.url).then((x) => x.json()).then((g) => { geo = g; OBS.datos.geo = g; render(); }).catch(() => {
      document.getElementById("titulo-condados").textContent = "No se pudieron cargar los mapas; las tablas siguen disponibles.";
    });
    if (LAB) await prepararLaboratorio();
    const validas = [...document.querySelectorAll("#pestanas button")].map((b) => b.dataset.p);
    const inicial = location.hash.slice(1);
    pestana = validas.includes(inicial) ? inicial : validas[0];
    await cargarEstado();
    elegirPestana(pestana);
    if (!LAB) setInterval(cargarEstado, REFRESCO_MS);
    window.addEventListener("hashchange", () => { const p = location.hash.slice(1); if (validas.includes(p) && p !== pestana) elegirPestana(p); });
  }

  iniciar().catch((e) => {
    document.getElementById("estado-gen").textContent = `No se pudo cargar la configuración del país "${PAIS}" (${e.message}).`;
  });
})();
