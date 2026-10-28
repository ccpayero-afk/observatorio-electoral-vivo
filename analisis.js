/* Pestaña de análisis, genérica por país, organizada en pasos: qué analizar, filtros (atajos y
   personalizados), resumen y cuatro vistas (tabla, relaciones, grupos por quintiles, comparar).
   Las variables de resultado salen de las fuerzas del país; las del censo, los atajos, las preguntas
   y los grupos, de paises/<codigo>.json. Trabaja sobre los datos que publica app.js en OBS.datos. */
(function () {
  "use strict";

  const { fmt, el, css, mostrarTip, ocultarTip, botonera, bloques, bloque, par, colorBloque, formato } = OBS;
  const POR_PAGINA = 25;
  const MAX_COMPARAR = 8;

  let VARS = [];
  let VAR = {};
  let GRUPOS_COLUMNAS = {};

  /* Variables numéricas: resultado (según las fuerzas del país) y características (de la configuración). */
  function armarVariables() {
    const C = OBS.cfg();
    const r = OBS.ref();
    const pr = par();
    const refTxt = r.anio ? `${r.anio}` : "la referencia";
    const res = [
      { id: "avance", et: "% escrutado", f: fmt.pct },
      { id: "votos", et: "Votos contados", f: fmt.int, log: true },
      ...bloques().map((b) => ({ id: `p_${b.id}`, et: `% ${b.nombre}`, f: fmt.pct })),
    ];
    if (pr) {
      const [a, b] = pr.map((x) => bloque(x).corto);
      res.push(
        { id: "dif", et: `Diferencia ${a} − ${b} (pts)`, f: fmt.pp },
        { id: "dif_ref", et: `Diferencia ${a} − ${b} en ${refTxt} (pts)`, f: fmt.pp },
        { id: "swing", et: `Cambio de la diferencia respecto de ${refTxt} (pts)`, f: fmt.pp },
        { id: "dif_proy", et: `Diferencia ${a} − ${b} proyectada (pts)`, f: fmt.pp },
      );
    }
    res.push({ id: "ventaja_pts", et: "Ventaja del primero sobre el segundo (pts)", f: fmt.dec });
    if (r.anio) res.push(...bloques().map((b) => ({ id: `cambio_${b.id}`, et: `Cambio de ${b.nombre} respecto de ${refTxt} (pts)`, f: fmt.pp })));
    if (r.anio) res.push({ id: "participacion", et: `Votos contados / votos de ${refTxt} (%)`, f: fmt.pct });
    const soc = (C.variables || []).map((v) => ({ id: v.id, et: v.et, f: formato(v.formato), log: v.log }));
    VARS = [...res, ...soc];
    VAR = Object.fromEntries(VARS.map((v) => [v.id, v]));
    GRUPOS_COLUMNAS = {
      res: { texto: "Resultados", ids: ["avance", "votos", ...bloques().map((b) => `p_${b.id}`), ...(pr ? ["dif", "dif_ref", "swing", "dif_proy"] : ["ventaja_pts"])].filter((id) => VAR[id]) },
      soc: { texto: "Características", ids: (C.columnas_caracteristicas || soc.map((v) => v.id)).filter((id) => VAR[id]) },
      todo: { texto: "Todo", ids: VARS.map((v) => v.id) },
    };
  }

  const ui = {
    nivel: "unidad",
    eleccion: "todas",
    region: "",
    agrupacion: "",
    texto: "",
    filtros: [], // [{v, min, max, atajo}]
    vista: "tabla",
    columnas: "res",
    orden: { id: "votos", dir: -1 },
    pagina: 0,
    x: null,
    y: null,
    grupo: null,
    comparar: new Set(),
  };
  let construido = false;
  let claveConstruida = null;
  let filas = [];

  // --- datos -----------------------------------------------------------------------------------------
  function carrerasElegidas() {
    const e = OBS.datos.estado;
    if (!e) return [];
    if (ui.eleccion === "todas") return e.carreras;
    if (ui.eleccion.startsWith("cargo:")) return e.carreras.filter((c) => c.cargo === ui.eleccion.slice(6));
    return e.carreras.filter((c) => c.id === ui.eleccion);
  }

  /* Campos de resultado de una fila a partir de porcentajes actuales, proyectados y de referencia. */
  function resultado(p, pp, a, votos, f) {
    const { difPar, ventaja, refPct, totalRef } = OBS.datos;
    const rp = refPct(a);
    const fila = { votos, avance: f == null ? null : 100 * f, total_ref: totalRef(a) };
    for (const b of bloques()) {
      fila[`p_${b.id}`] = p ? p[b.id] : null;
      fila[`v_${b.id}`] = p ? (votos * (p[b.id] || 0)) / 100 : 0;
      fila[`ref_${b.id}`] = rp ? rp[b.id] : null;
      fila[`cambio_${b.id}`] = p && rp && rp[b.id] != null ? p[b.id] - rp[b.id] : null;
    }
    fila.dif = difPar(p);
    fila.dif_ref = difPar(rp);
    fila.swing = fila.dif != null && fila.dif_ref != null ? fila.dif - fila.dif_ref : null;
    fila.dif_proy = difPar(pp);
    const v = ventaja(p);
    fila.lider = v ? v.lider : null;
    fila.ventaja_pts = v ? v.margen : null;
    fila.participacion = fila.total_ref && votos ? (100 * votos) / fila.total_ref : null;
    return fila;
  }
  function caracteristicas(a) {
    return Object.fromEntries((OBS.cfg().variables || []).map((v) => [v.id, a ? a[v.id] : null]));
  }

  function filasUnidad() {
    const { unidAtr, regAtr, nombreRegion } = OBS.datos;
    const campo = (OBS.cfg().agrupacion_regiones || {}).campo;
    const salida = [];
    for (const c of carrerasElegidas()) {
      for (const [u, x] of Object.entries(c.unidades || {})) {
        const a = unidAtr.get(u) || {};
        const pc = ((c.proyeccion || {}).por_unidad || {})[u];
        salida.push({
          clave: `${c.id}|${u}`, nombre: `${a.nombre || u}, ${nombreRegion(c.region)}`,
          eleccion: c.nombre, region: c.region, agrupacion: campo ? (regAtr.get(c.region) || {})[campo] : null,
          ...resultado(x.v > 0 ? x.p : null, pc ? pc.p : null, a, x.v, x.f), ...caracteristicas(a),
        });
      }
    }
    return salida;
  }

  function filasRegion() {
    const { regAtr, pctCarrera, pctProyeccion, votosCarrera, nombreRegion } = OBS.datos;
    const campo = (OBS.cfg().agrupacion_regiones || {}).campo;
    return carrerasElegidas().map((c) => {
      const a = regAtr.get(c.region) || {};
      return {
        clave: c.id, nombre: nombreRegion(c.region), eleccion: c.nombre, region: c.region, agrupacion: campo ? a[campo] : null,
        ...resultado(pctCarrera(c), pctProyeccion(c), a, votosCarrera(c), c.fraccion_fuente), ...caracteristicas(a),
      };
    });
  }

  function todasLasFilas() {
    return ui.nivel === "unidad" ? filasUnidad() : filasRegion();
  }

  function filtrar(base) {
    const t = ui.texto.toLowerCase();
    return base.filter((f) => {
      if (ui.region && f.region !== ui.region) return false;
      if (ui.agrupacion && f.agrupacion !== ui.agrupacion) return false;
      if (t && !`${f.nombre} ${f.eleccion}`.toLowerCase().includes(t)) return false;
      for (const k of ui.filtros) {
        const v = f[k.v];
        if (k.min != null && !(v >= k.min)) return false;
        if (k.max != null && !(v <= k.max)) return false;
      }
      return true;
    });
  }

  /* Totales del conjunto: votos por fuerza sumados y referencia ponderada por los votos de esa elección. */
  function agregar(fs) {
    const V = d3.sum(fs, (f) => f.votos || 0);
    const p = V ? Object.fromEntries(bloques().map((b) => [b.id, (100 * d3.sum(fs, (f) => f[`v_${b.id}`] || 0)) / V])) : null;
    const conRef = fs.filter((f) => f.total_ref && bloques().some((b) => f[`ref_${b.id}`] != null));
    const T = d3.sum(conRef, (f) => f.total_ref);
    const rp = T ? Object.fromEntries(bloques().map((b) => [b.id, d3.sum(conRef, (f) => (f[`ref_${b.id}`] || 0) * f.total_ref) / T])) : null;
    const { difPar, ventaja } = OBS.datos;
    const dif = difPar(p), difRef = difPar(rp);
    return {
      n: fs.length, con_votos: fs.filter((f) => f.votos > 0).length, votos: V, p, rp,
      dif, dif_ref: difRef, swing: dif != null && difRef != null ? dif - difRef : null,
      ventaja: ventaja(p), poblacion: d3.sum(fs, (f) => f.poblacion || 0),
    };
  }

  // --- textos llanos ---------------------------------------------------------------------------------
  function nombreNivel(plural) {
    const C = OBS.cfg();
    const n = ui.nivel === "unidad" ? C.unidad : C.region;
    return plural ? n.plural : n.singular;
  }
  function lugares(n) {
    return `${fmt.int(n)} ${n === 1 ? nombreNivel(false) : nombreNivel(true)}`;
  }
  function cambioTexto(a) {
    const pr = par();
    if (pr) {
      if (a.swing == null) return "sin dato";
      if (Math.abs(a.swing) < 0.05) return "sin cambio";
      return `${fmt.dec(Math.abs(a.swing))} pts hacia ${bloque(a.swing > 0 ? pr[0] : pr[1]).plural}`;
    }
    if (!a.ventaja || !a.rp) return "sin dato";
    const b = a.ventaja.lider;
    const d = a.p[b] - (a.rp[b] || 0);
    return `${bloque(b).plural}: ${fmt.pp(d)} pts`;
  }
  function describirR(r) {
    const a = Math.abs(r);
    const fuerza = a < 0.1 ? "prácticamente nula" : a < 0.3 ? "débil" : a < 0.5 ? "moderada" : "fuerte";
    if (a < 0.1) return `relación ${fuerza}`;
    return `relación ${fuerza} y ${r > 0 ? "positiva (cuando una sube, la otra tiende a subir)" : "negativa (cuando una sube, la otra tiende a bajar)"}`;
  }

  /* Color de un lugar: la diferencia del par principal, o el color del primero con su ventaja. */
  function colorFila(f) {
    const neutro = css("--neutro");
    const pr = par();
    if (pr) {
      if (f.dif == null) return css("--sin-dato");
      return d3.scaleLinear().domain([-30, 0, 30]).range([colorBloque(pr[1]), neutro, colorBloque(pr[0])]).interpolate(d3.interpolateLab).clamp(true)(f.dif);
    }
    if (!f.lider) return css("--sin-dato");
    return d3.interpolateLab(neutro, colorBloque(f.lider))(0.25 + 0.75 * Math.min(1, f.ventaja_pts / 30));
  }

  // --- construcción ----------------------------------------------------------------------------------
  function selector(opciones, valor, alCambiar) {
    const s = el("select", { onchange: (e) => alCambiar(e.target.value) }, opciones.map(([v, t]) => el("option", { value: v }, t)));
    s.value = valor;
    return s;
  }
  function segmentado(opciones, valor, alCambiar) {
    return el("div", { class: "segmentado", role: "group" }, opciones.map(([v, t]) =>
      el("button", { type: "button", "aria-pressed": v === valor ? "true" : "false", onclick: () => alCambiar(v) }, t)));
  }
  function mayuscula(t) { return t ? t[0].toUpperCase() + t.slice(1) : t; }

  function construir() {
    const C = OBS.cfg();
    const raiz = document.getElementById("analisis");
    const e = OBS.datos.estado;
    if (!e || !OBS.datos.regAtr) return;
    armarVariables();
    const preguntas = C.preguntas || [];
    const grupos = C.grupos || [];
    if (!VAR[ui.x]) ui.x = (preguntas[0] && preguntas[0].x) || VARS[0].id;
    if (!VAR[ui.y]) ui.y = (preguntas[0] && preguntas[0].y) || VARS[1].id;
    if (!VAR[ui.grupo]) ui.grupo = (grupos[0] && grupos[0].v) || VARS[0].id;
    const regiones = [...OBS.datos.regAtr.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    const ag = C.agrupacion_regiones;
    const agrupaciones = ag ? [...new Set(regiones.map((a) => a[ag.campo]).filter(Boolean))].sort() : [];
    const cargos = [...new Set(e.carreras.map((c) => c.cargo))];
    const nombreCargo = Object.fromEntries((C.pestanas || []).map((t) => [t.cargo, t.titulo]));
    const opcElecciones = [["todas", "Todas las elecciones"],
      ...(cargos.length > 1 ? cargos.map((c) => [`cargo:${c}`, `Todas: ${nombreCargo[c] || c}`]) : []),
      ...e.carreras.map((c) => [c.id, c.nombre])];

    const paso1 = el("section", { class: "tarjeta-paso" },
      el("h3", {}, el("span", { class: "num-paso" }, "1"), "¿Qué querés analizar?"),
      el("div", { class: "fila-controles" },
        el("div", { class: "control" }, el("span", { class: "etiqueta-control" }, "Mirar por"),
          segmentado([["unidad", mayuscula(C.unidad.plural)], ["region", mayuscula(C.region.plural)]], ui.nivel,
            (v) => { ui.nivel = v; ui.comparar.clear(); ui.pagina = 0; construido = false; actualizar(); })),
        el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, "Elección"),
          selector(opcElecciones, ui.eleccion, (v) => { ui.eleccion = v; ui.pagina = 0; actualizar(); })),
        el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, mayuscula(C.region.singular)),
          selector([["", "Todos"], ...regiones.map((a) => [a.region, a.nombre])], ui.region, (v) => { ui.region = v; ui.pagina = 0; actualizar(); })),
        ag ? el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, ag.etiqueta),
          selector([["", "Todas"], ...agrupaciones.map((r) => [r, r])], ui.agrupacion, (v) => { ui.agrupacion = v; ui.pagina = 0; actualizar(); })) : null,
      ));

    const paso2 = el("section", { class: "tarjeta-paso" },
      el("h3", {}, el("span", { class: "num-paso" }, "2"), "Filtrar ", el("span", { class: "nota" }, "(opcional)")),
      (C.atajos || []).length ? el("p", { class: "ayuda" }, "Atajos de un clic:") : null,
      el("div", { id: "an-atajos", class: "atajos" }),
      el("div", { id: "an-chips", class: "chips" }),
      el("details", { class: "filtro-avanzado" }, el("summary", {}, "Agregar otro filtro"), filtroPersonalizado()),
      el("label", { class: "control buscar" }, el("span", { class: "etiqueta-control" }, "Buscar por nombre"),
        el("input", { type: "search", placeholder: `Ej.: ${(ui.nivel === "unidad" ? C.unidad.ejemplo : C.region.ejemplo) || ""}`, value: ui.texto,
          oninput: (ev) => { ui.texto = ev.target.value.trim(); ui.pagina = 0; actualizar(); } })),
    );

    const vistas = [["tabla", "Tabla"], ["relaciones", "Relaciones entre variables"], ["quintiles", "Grupos (rural, urbano y otros)"], ["comparar", "Comparar lugares"]];
    const paso3 = el("section", { class: "tarjeta-paso" },
      el("h3", {}, el("span", { class: "num-paso" }, "3"), "Resultado"),
      el("div", { id: "an-resumen", class: "resumen-analisis" }),
      el("div", { class: "subpestanas", role: "tablist" }, vistas.map(([v, t]) =>
        el("button", { type: "button", role: "tab", "data-vista": v, "aria-selected": v === ui.vista ? "true" : "false",
          onclick: () => { ui.vista = v; marcarVista(); dibujarVista(); } }, t))),
      el("div", { id: "an-vista" }));

    raiz.replaceChildren(paso1, paso2, paso3);
    if (C.fuente_atributos) document.getElementById("intro-analisis").textContent =
      `Explorá los resultados por ${C.unidad.singular} o por ${C.region.singular} y cruzalos con datos de población (${C.fuente_atributos}). Todo lo que ves se puede descargar.`;
    construido = true;
  }

  function filtroPersonalizado() {
    let variable = (VARS.find((v) => v.id === "poblacion") || VARS[0]).id;
    const min = el("input", { type: "number", step: "any", placeholder: "desde", "aria-label": "Desde" });
    const max = el("input", { type: "number", step: "any", placeholder: "hasta", "aria-label": "Hasta" });
    const sel = selector(VARS.map((v) => [v.id, v.et]), variable, (v) => { variable = v; });
    return el("div", { class: "fila-controles" },
      el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, "Variable"), sel),
      el("label", { class: "control corto" }, el("span", { class: "etiqueta-control" }, "Desde"), min),
      el("label", { class: "control corto" }, el("span", { class: "etiqueta-control" }, "Hasta"), max),
      el("button", { type: "button", class: "boton", onclick: () => {
        const a = min.value === "" ? null : Number(min.value);
        const b = max.value === "" ? null : Number(max.value);
        if (a == null && b == null) return;
        ui.filtros.push({ v: variable, min: a, max: b });
        min.value = ""; max.value = "";
        ui.pagina = 0;
        actualizar();
      } }, "Agregar filtro"),
      el("p", { class: "ayuda" }, "Completá uno o los dos extremos."));
  }

  function textoFiltro(k) {
    const v = VAR[k.v] || { et: k.v, f: fmt.dec };
    if (k.min != null && k.max != null) return `${v.et}: entre ${v.f(k.min)} y ${v.f(k.max)}`;
    if (k.min != null) return `${v.et}: desde ${v.f(k.min)}`;
    return `${v.et}: hasta ${v.f(k.max)}`;
  }

  function dibujarFiltros() {
    const atajos = (OBS.cfg().atajos || []).filter((a) => a.cond.every((c) => VAR[c.v]));
    const activos = new Set(ui.filtros.filter((k) => k.atajo).map((k) => k.atajo));
    document.getElementById("an-atajos").replaceChildren(...atajos.map((a) =>
      el("button", { type: "button", class: "atajo", "aria-pressed": activos.has(a.id) ? "true" : "false", onclick: () => {
        if (activos.has(a.id)) ui.filtros = ui.filtros.filter((k) => k.atajo !== a.id);
        else ui.filtros.push(...a.cond.map((c) => ({ ...c, atajo: a.id })));
        ui.pagina = 0;
        actualizar();
      } }, a.texto)));
    const chips = document.getElementById("an-chips");
    if (!ui.filtros.length) {
      chips.replaceChildren(el("span", { class: "nota" }, "Sin filtros: se incluyen todos los lugares."));
      return;
    }
    chips.replaceChildren(
      el("span", { class: "nota" }, "Filtros activos:"),
      ...ui.filtros.map((k, i) => el("span", { class: "chip" }, textoFiltro(k),
        el("button", { type: "button", "aria-label": "Quitar filtro", onclick: () => { ui.filtros.splice(i, 1); ui.pagina = 0; actualizar(); } }, "✕"))),
      el("button", { type: "button", class: "boton-texto", onclick: () => { ui.filtros = []; ui.pagina = 0; actualizar(); } }, "Quitar todos"));
  }

  function marcarVista() {
    document.querySelectorAll("#analisis .subpestanas button").forEach((b) =>
      b.setAttribute("aria-selected", b.dataset.vista === ui.vista ? "true" : "false"));
  }

  // --- actualización ---------------------------------------------------------------------------------
  function actualizar() {
    if (!OBS.datos.estado || !OBS.datos.regAtr || !OBS.cfg()) return;
    const clave = `${OBS.ref().anio}|${OBS.cfg().codigo}`;
    if (claveConstruida !== clave) { construido = false; claveConstruida = clave; }
    if (!construido) construir();
    filas = filtrar(todasLasFilas());
    dibujarFiltros();
    resumen();
    dibujarVista();
  }

  function resumen() {
    const a = agregar(filas);
    const r = OBS.ref();
    const tarjeta = (titulo, valor, detalle, color) => el("div", { class: "tarjeta", style: color ? `border-left:4px solid ${color}` : null },
      el("div", { class: "l" }, titulo), el("div", { class: "v" }, valor), detalle ? el("div", { class: "d" }, detalle) : null);
    document.getElementById("an-resumen").replaceChildren(...[
      tarjeta("Lugares incluidos", lugares(a.n), `${fmt.int(a.con_votos)} con votos · ${fmt.int(a.poblacion)} habitantes`),
      tarjeta("Votos contados", fmt.int(a.votos)),
      ...bloques().map((b) => tarjeta(b.nombre, fmt.pct(a.p ? a.p[b.id] : null), a.rp && r.anio ? `en ${r.anio}: ${fmt.pct(a.rp[b.id])}` : null, colorBloque(b.id))),
      tarjeta("Quién va adelante", OBS.datos.textoVentaja(a.ventaja)),
      r.anio ? tarjeta(`Cambio respecto de ${r.anio}`, cambioTexto(a)) : null,
    ].filter(Boolean));
  }

  function dibujarVista() {
    const caja = document.getElementById("an-vista");
    if (!caja) return;
    if (!filas.length) {
      caja.replaceChildren(el("div", { class: "vacio-grande" },
        el("p", {}, "Ningún lugar cumple todos los filtros."),
        el("button", { type: "button", class: "boton", onclick: () => { ui.filtros = []; ui.texto = ""; ui.region = ""; ui.agrupacion = ""; construido = false; actualizar(); } }, "Quitar filtros")));
      return;
    }
    ({ tabla: vistaTabla, relaciones: vistaRelaciones, quintiles: vistaQuintiles, comparar: vistaComparar })[ui.vista](caja);
  }

  // --- vista: tabla ----------------------------------------------------------------------------------
  function ordenar(fs) {
    const { id, dir } = ui.orden;
    return fs.slice().sort((a, b) => {
      const va = a[id], vb = b[id];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return typeof va === "string" ? dir * va.localeCompare(vb) : dir * (va - vb);
    });
  }

  function vistaTabla(caja) {
    const ordenadas = ordenar(filas);
    const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA));
    ui.pagina = Math.min(ui.pagina, paginas - 1);
    const visibles = ordenadas.slice(ui.pagina * POR_PAGINA, (ui.pagina + 1) * POR_PAGINA);
    const cols = GRUPOS_COLUMNAS[ui.columnas].ids;
    const { id, dir } = ui.orden;
    const cab = (cid, texto, num) => el("th", {
      class: "ordenable" + (num ? " num" : ""), "aria-sort": id === cid ? (dir > 0 ? "ascending" : "descending") : "none",
      title: "Ordenar", onclick: () => { ui.orden = { id: cid, dir: id === cid ? -dir : num ? -1 : 1 }; ui.pagina = 0; vistaTabla(caja); },
    }, texto, id === cid ? (dir > 0 ? " ▲" : " ▼") : "");
    const tabla = el("table", { class: "tabla-analisis" },
      el("thead", {}, el("tr", {}, el("th", { title: "Agregar al comparador" }, "★"),
        cab("nombre", mayuscula(nombreNivel(false))), cab("eleccion", "Elección"),
        cols.map((c) => cab(c, VAR[c].et, true)))),
      el("tbody", {}, visibles.map((f) => el("tr", { class: ui.comparar.has(f.clave) ? "fila-sel" : null },
        el("td", {}, el("input", { type: "checkbox", checked: ui.comparar.has(f.clave), title: "Agregar al comparador",
          "aria-label": `Comparar ${f.nombre}`, onchange: () => alternarComparar(f.clave) })),
        el("td", { class: "nombre" }, f.nombre), el("td", { class: "nota" }, f.eleccion),
        cols.map((c) => el("td", { class: "num" }, VAR[c].f(f[c])))))));
    const columnasCSV = [{ id: "nombre", etiqueta: mayuscula(nombreNivel(false)) }, { id: "region", etiqueta: "Región (código)" },
      { id: "eleccion", etiqueta: "Elección" }, ...VARS.map((v) => ({ id: v.id, etiqueta: v.et }))];
    caja.replaceChildren(
      el("div", { class: "barra-vista" },
        el("div", { class: "control" }, el("span", { class: "etiqueta-control" }, "Columnas"),
          segmentado(Object.entries(GRUPOS_COLUMNAS).map(([k, g]) => [k, g.texto]), ui.columnas, (v) => { ui.columnas = v; vistaTabla(caja); })),
        botonera([{ texto: "Descargar CSV (todas las filas y columnas)", accion: () => OBS.exportarCSV(ordenadas, columnasCSV, `Analisis ${nombreNivel(true)}`) }])),
      el("p", { class: "ayuda" }, "Tocá un encabezado para ordenar. Marcá la casilla ★ para sumar un lugar al comparador."),
      el("div", { class: "tabla-env" }, tabla),
      paginacion(paginas, ordenadas.length, () => vistaTabla(caja)));
  }

  function paginacion(paginas, total, redibujar) {
    const ir = (p) => { ui.pagina = Math.max(0, Math.min(paginas - 1, p)); redibujar(); };
    return el("div", { class: "paginacion" },
      el("button", { type: "button", class: "boton-mini", disabled: ui.pagina === 0, onclick: () => ir(ui.pagina - 1) }, "◀ Anterior"),
      el("span", {}, `Página ${ui.pagina + 1} de ${paginas} · ${lugares(total)}`),
      el("button", { type: "button", class: "boton-mini", disabled: ui.pagina >= paginas - 1, onclick: () => ir(ui.pagina + 1) }, "Siguiente ▶"));
  }

  // --- vista: relaciones -----------------------------------------------------------------------------
  function regresion(pts) {
    const w = pts.map((p) => (p.votos > 0 ? p.votos : 1));
    const W = d3.sum(w);
    const mx = d3.sum(pts, (p, i) => w[i] * p.x) / W;
    const my = d3.sum(pts, (p, i) => w[i] * p.y) / W;
    let sxx = 0, syy = 0, sxy = 0;
    pts.forEach((p, i) => { sxx += w[i] * (p.x - mx) ** 2; syy += w[i] * (p.y - my) ** 2; sxy += w[i] * (p.x - mx) * (p.y - my); });
    if (!sxx || !syy) return null;
    return { pendiente: sxy / sxx, ordenada: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy) };
  }

  function vistaRelaciones(caja) {
    const opc = VARS.map((v) => [v.id, v.et]);
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("viewBox", "0 0 760 440");
    svgNode.setAttribute("role", "img");
    const lectura = el("div", { class: "lectura" });
    const redibujar = () => vistaRelaciones(caja);
    const preguntas = (OBS.cfg().preguntas || []).filter((p) => VAR[p.x] && VAR[p.y]);
    caja.replaceChildren(
      el("p", { class: "ayuda" }, "Elegí una pregunta o armá la tuya. Cada círculo es un lugar: el tamaño indica los votos y el color, quién va adelante."),
      el("div", { class: "preguntas" }, preguntas.map((p) => el("button", { type: "button", class: "atajo",
        "aria-pressed": ui.x === p.x && ui.y === p.y ? "true" : "false",
        onclick: () => { ui.x = p.x; ui.y = p.y; redibujar(); } }, p.texto))),
      el("div", { class: "barra-vista" },
        el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, "Eje horizontal"), selector(opc, ui.x, (v) => { ui.x = v; redibujar(); })),
        el("label", { class: "control" }, el("span", { class: "etiqueta-control" }, "Eje vertical"), selector(opc, ui.y, (v) => { ui.y = v; redibujar(); })),
        botonera([
          { texto: "PNG", accion: () => OBS.exportarPNG(svgNode, `${VAR[ui.y].et} según ${VAR[ui.x].et}`, lectura.textContent) },
          { texto: "SVG", accion: () => OBS.exportarSVG(svgNode, `${VAR[ui.y].et} según ${VAR[ui.x].et}`, lectura.textContent) },
        ])),
      lectura,
      el("figure", { class: "mapa" }, svgNode));
    dibujarDispersion(svgNode, lectura);
  }

  function dibujarDispersion(svgNode, lectura) {
    const svg = d3.select(svgNode);
    const W = 760, H = 440, m = { t: 16, r: 20, b: 48, l: 70 };
    const vx = VAR[ui.x], vy = VAR[ui.y];
    const pts = filas.filter((f) => Number.isFinite(f[ui.x]) && Number.isFinite(f[ui.y]) && (!vx.log || f[ui.x] > 0) && (!vy.log || f[ui.y] > 0))
      .map((f) => ({ ...f, x: f[ui.x], y: f[ui.y] }));
    if (pts.length < 3) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").attr("class", "vacio")
        .text("Hacen falta al menos tres lugares con dato en las dos variables.");
      lectura.textContent = "";
      return;
    }
    const escala = (v, dom, rango) => {
      if (v.log) return d3.scaleLog().domain(dom).range(rango).nice();
      const d = (dom[1] - dom[0]) * 0.05 || 1;
      return d3.scaleLinear().domain([dom[0] - d, dom[1] + d]).range(rango).nice();
    };
    const x = escala(vx, d3.extent(pts, (p) => p.x), [m.l, W - m.r]);
    const y = escala(vy, d3.extent(pts, (p) => p.y), [H - m.b, m.t]);
    const radio = d3.scaleSqrt().domain([0, d3.max(pts, (p) => p.votos || p.poblacion || 1) || 1]).range([2.5, 18]);
    const fmtEje = (v) => (v.log ? d3.format("~s") : null);
    svg.append("g").attr("class", "eje").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(7, fmtEje(vx)));
    svg.append("g").attr("class", "eje").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6, fmtEje(vy)));
    svg.append("text").attr("class", "titulo-eje").attr("x", (m.l + W - m.r) / 2).attr("y", H - 8).attr("text-anchor", "middle")
      .text(vx.et + (vx.log ? " (escala logarítmica)" : ""));
    svg.append("text").attr("class", "titulo-eje").attr("transform", `translate(16,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle")
      .text(vy.et + (vy.log ? " (escala logarítmica)" : ""));
    if (!vy.log && y.domain()[0] < 0 && y.domain()[1] > 0) svg.append("line").attr("class", "cero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
    if (!vx.log && x.domain()[0] < 0 && x.domain()[1] > 0) svg.append("line").attr("class", "cero").attr("y1", m.t).attr("y2", H - m.b).attr("x1", x(0)).attr("x2", x(0));
    const orden = pts.slice().sort((a, b) => (b.votos || 0) - (a.votos || 0));
    svg.append("g").selectAll("circle").data(orden).join("circle")
      .attr("class", (p) => "punto" + (ui.comparar.has(p.clave) ? " comparado" : ""))
      .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y)).attr("r", (p) => radio(p.votos || p.poblacion || 1))
      .attr("fill", (p) => colorFila(p))
      .on("mousemove", (ev, p) => mostrarTip(ev, [p.nombre, p.eleccion, `${vx.et}: ${vx.f(p.x)}`, `${vy.et}: ${vy.f(p.y)}`,
        `Votos contados: ${fmt.int(p.votos)}`, ui.comparar.has(p.clave) ? "Clic para sacarlo del comparador" : "Clic para agregarlo al comparador"]))
      .on("mouseleave", ocultarTip)
      .on("click", (ev, p) => { alternarComparar(p.clave, false); d3.select(ev.currentTarget).classed("comparado", ui.comparar.has(p.clave)); });
    // La tendencia se calcula sobre la escala que se ve (logarítmica si corresponde).
    const tx = (v) => (vx.log ? Math.log10(v) : v), ty = (v) => (vy.log ? Math.log10(v) : v);
    const reg = regresion(pts.map((p) => ({ ...p, x: tx(p.x), y: ty(p.y) })));
    if (reg) {
      const xs = x.domain();
      const yv = (xv) => { const t = reg.ordenada + reg.pendiente * tx(xv); return vy.log ? 10 ** t : t; };
      svg.append("line").attr("class", "tendencia").attr("x1", x(xs[0])).attr("y1", y(yv(xs[0]))).attr("x2", x(xs[1])).attr("y2", y(yv(xs[1])));
    }
    lectura.replaceChildren(
      el("strong", {}, `${lugares(pts.length)} en el gráfico. `),
      reg ? `Entre «${vx.et}» y «${vy.et}» hay una ${describirR(reg.r)} (r = ${reg.r.toLocaleString("es-AR", { maximumFractionDigits: 2 })}, ponderado por votos; la línea punteada es la tendencia). ` : "",
      el("span", { class: "nota" }, "Compara lugares, no personas: no permite saber cómo votó cada grupo (falacia ecológica)."));
  }

  // --- vista: grupos por quintiles -------------------------------------------------------------------
  function quintiles(v) {
    const con = filas.filter((f) => Number.isFinite(f[v])).sort((a, b) => a[v] - b[v]);
    if (con.length < 5) return [];
    return d3.range(5).map((q) => {
      const parte = con.slice(Math.floor((q * con.length) / 5), Math.floor(((q + 1) * con.length) / 5));
      return { q: q + 1, desde: parte[0][v], hasta: parte[parte.length - 1][v], ...agregar(parte) };
    });
  }

  /* Barra de un grupo o lugar: divergente con el par principal, o reparto apilado de todas las fuerzas. */
  function barraResultado(p, rp, tope) {
    const pr = par();
    const { difPar } = OBS.datos;
    if (pr) {
      const pista = (valor, clase) => {
        const ancho = valor == null ? 0 : (50 * Math.abs(valor)) / tope;
        return el("div", { class: "pista divergente " + clase },
          el("div", { class: "relleno", style: `left:${valor >= 0 ? 50 : 50 - ancho}%;width:${ancho}%;background:${valor == null ? css("--sin-dato") : colorBloque(valor >= 0 ? pr[0] : pr[1])}` }));
      };
      return el("div", { class: "pistas" }, pista(difPar(p), "actual"), rp ? pista(difPar(rp), "referencia") : null);
    }
    const apilada = (q, clase) => el("div", { class: "pista apilada " + clase }, bloques().map((b) =>
      el("div", { class: "tramo", style: `width:${q ? Math.max(0, q[b.id] || 0) : 0}%;background:${colorBloque(b.id)}`, title: `${b.nombre}: ${fmt.pct(q ? q[b.id] : null)}` })));
    return el("div", { class: "pistas" }, apilada(p, "actual"), rp ? apilada(rp, "referencia") : null);
  }

  function vistaQuintiles(caja) {
    const vg = VAR[ui.grupo] || VARS[0];
    const g = quintiles(vg.id);
    const nombresQ = ["Más bajo", "Bajo", "Medio", "Alto", "Más alto"];
    const r = OBS.ref();
    const pr = par();
    const redibujar = () => vistaQuintiles(caja);
    const tope = Math.max(10, ...g.map((q) => Math.abs(q.dif || 0)), ...g.map((q) => Math.abs(q.dif_ref || 0)));
    const barras = el("div", { class: "barras-quintiles" }, g.map((q, i) => el("div", { class: "fila-quintil" },
      el("div", { class: "nombre-quintil" }, el("strong", {}, nombresQ[i]), el("span", { class: "nota" }, `${vg.f(q.desde)} a ${vg.f(q.hasta)}`)),
      barraResultado(q.p, q.rp, tope),
      el("div", { class: "valores-quintil" },
        el("span", {}, OBS.datos.textoVentaja(q.ventaja)),
        r.anio ? el("span", { class: "nota" }, `cambio respecto de ${r.anio}: ${cambioTexto(q)}`) : null))));
    const cols = [
      { etiqueta: "Grupo", valor: (q) => nombresQ[q.q - 1] },
      { etiqueta: `${vg.et}: desde`, valor: (q) => q.desde, f: vg.f }, { etiqueta: "hasta", valor: (q) => q.hasta, f: vg.f },
      { etiqueta: "Lugares", valor: (q) => q.n, f: fmt.int }, { etiqueta: "Votos", valor: (q) => q.votos, f: fmt.int },
      ...bloques().map((b) => ({ etiqueta: `% ${b.corto}`, valor: (q) => (q.p ? q.p[b.id] : null), f: fmt.pct })),
      ...(r.anio ? bloques().map((b) => ({ etiqueta: `% ${b.corto} ${r.anio}`, valor: (q) => (q.rp ? q.rp[b.id] : null), f: fmt.pct })) : []),
      ...(pr ? [{ etiqueta: "Cambio de la diferencia", valor: (q) => q.swing, f: fmt.pp }] : []),
      { etiqueta: "Habitantes", valor: (q) => q.poblacion, f: fmt.int },
    ];
    const leyenda = pr
      ? [el("span", {}, el("span", { class: "muestra actual" }), "Ahora"), r.anio ? el("span", {}, el("span", { class: "muestra referencia" }), `${r.nombre} ${r.anio}`) : null,
        el("span", { class: "nota" }, `Barra a la derecha: ventaja ${bloque(pr[0]).plural} · a la izquierda: ${bloque(pr[1]).plural}`)]
      : [...bloques().map((b) => el("span", {}, el("span", { class: "caja", style: `background:${colorBloque(b.id)}` }), b.nombre)),
        el("span", { class: "nota" }, r.anio ? `Barra gruesa: ahora · fina: ${r.nombre} ${r.anio}` : "")];
    const grupos = (OBS.cfg().grupos || []).filter((x) => VAR[x.v]).map((x) => [x.v, x.texto]);
    const contenido = el("div", {},
      el("div", { class: "leyenda-quintiles" }, leyenda),
      g.length ? barras : el("p", { class: "nota" }, "Hacen falta al menos cinco lugares con dato en esa variable."),
      el("details", {}, el("summary", {}, "Ver la tabla con los números"),
        el("div", { class: "tabla-env" }, el("table", {},
          el("thead", {}, el("tr", {}, cols.map((c, i) => el("th", { class: i ? "num" : null }, c.etiqueta)))),
          el("tbody", {}, g.map((q) => el("tr", {}, cols.map((c, i) => el("td", { class: i ? "num" : null }, c.f ? c.f(c.valor(q)) : c.valor(q))))))))));
    caja.replaceChildren(
      el("p", { class: "ayuda" }, `Ordena los lugares filtrados según una característica y los divide en cinco grupos del mismo tamaño. Así se ve, por ejemplo, cómo votan los ${OBS.cfg().unidad.plural} más rurales frente a los más urbanos.`),
      el("div", { class: "barra-vista" },
        el("div", { class: "control" }, el("span", { class: "etiqueta-control" }, "Agrupar por"),
          grupos.length ? segmentado(grupos, vg.id, (v) => { ui.grupo = v; redibujar(); }) : selector(VARS.map((v) => [v.id, v.et]), vg.id, (v) => { ui.grupo = v; redibujar(); })),
        botonera([
          { texto: "PNG", accion: () => OBS.exportarNodoPNG(contenido, `Grupos por ${vg.et}`) },
          { texto: "CSV", accion: () => OBS.exportarCSV(g, cols.map((c) => ({ etiqueta: c.etiqueta, valor: c.valor })), `Grupos por ${vg.et}`) },
        ])),
      contenido);
  }

  // --- vista: comparar -------------------------------------------------------------------------------
  function alternarComparar(clave, redibujar = true) {
    if (ui.comparar.has(clave)) ui.comparar.delete(clave);
    else if (ui.comparar.size < MAX_COMPARAR) ui.comparar.add(clave);
    if (redibujar) dibujarVista();
  }

  function vistaComparar(caja) {
    const C = OBS.cfg();
    const todas = todasLasFilas();
    const porNombre = new Map(todas.map((f) => [`${f.nombre} · ${f.eleccion}`, f.clave]));
    const lista = el("datalist", { id: "an-lugares" }, [...porNombre.keys()].slice(0, 4000).map((n) => el("option", { value: n })));
    const ejemplo = (ui.nivel === "unidad" ? C.unidad.ejemplo : C.region.ejemplo) || "";
    const buscador = el("input", { type: "search", list: "an-lugares", placeholder: `Escribí un ${nombreNivel(false)}${ejemplo ? ", ej.: " + ejemplo : ""}`,
      onchange: (e) => { const k = porNombre.get(e.target.value); if (k && ui.comparar.size < MAX_COMPARAR) { ui.comparar.add(k); vistaComparar(caja); } } });
    const sel = todas.filter((f) => ui.comparar.has(f.clave));
    const cabecera = el("div", {},
      el("p", { class: "ayuda" }, `Sumá hasta ${MAX_COMPARAR} lugares: buscalos acá, marcá la casilla ★ en la tabla o hacé clic en un círculo del gráfico de relaciones.`),
      el("label", { class: "control buscar" }, el("span", { class: "etiqueta-control" }, "Agregar lugar"), buscador, lista),
      el("div", { class: "chips" }, sel.map((f) => el("span", { class: "chip" }, f.nombre,
        el("button", { type: "button", "aria-label": "Quitar", onclick: () => { ui.comparar.delete(f.clave); vistaComparar(caja); } }, "✕")))));
    if (!sel.length) {
      caja.replaceChildren(cabecera, el("div", { class: "vacio-grande" }, el("p", {}, "Todavía no elegiste lugares para comparar.")));
      return;
    }
    const tope = Math.max(10, ...sel.map((f) => Math.abs(f.dif || 0)));
    const pctFila = (f) => (f.votos > 0 ? Object.fromEntries(bloques().map((b) => [b.id, f[`p_${b.id}`]])) : null);
    const barras = el("div", { class: "barras-quintiles" }, sel.map((f) => el("div", { class: "fila-quintil" },
      el("div", { class: "nombre-quintil" }, el("strong", {}, f.nombre), el("span", { class: "nota" }, f.eleccion)),
      barraResultado(pctFila(f), null, tope),
      el("div", { class: "valores-quintil" }, el("span", {}, OBS.datos.textoVentaja(OBS.datos.ventaja(pctFila(f))))))));
    const tabla = el("table", { class: "comparador" },
      el("thead", {}, el("tr", {}, el("th", {}, ""), sel.map((f) => el("th", { class: "num" }, f.nombre)))),
      el("tbody", {}, VARS.map((v) => el("tr", {}, el("td", {}, v.et), sel.map((f) => el("td", { class: "num" }, v.f(f[v.id])))))));
    const contenido = el("div", {}, el("h4", {}, "Quién va adelante en cada lugar"), barras, el("h4", {}, "Todas las variables"), el("div", { class: "tabla-env" }, tabla));
    caja.replaceChildren(
      cabecera,
      el("div", { class: "barra-vista" }, el("span", {}),
        botonera([
          { texto: "PNG", accion: () => OBS.exportarNodoPNG(contenido, "Comparación") },
          { texto: "CSV", accion: () => OBS.exportarCSV(VARS, [{ id: "et", etiqueta: "Variable" }, ...sel.map((f) => ({ etiqueta: `${f.nombre} (${f.eleccion})`, valor: (v) => f[v.id] }))], "Comparacion") },
          { texto: "Vaciar", accion: () => { ui.comparar.clear(); vistaComparar(caja); } },
        ])),
      contenido);
  }

  // --- enganche con app.js ---------------------------------------------------------------------------
  document.addEventListener("obs:datos", () => {
    const panel = document.querySelector('section[data-panel="analisis"]');
    if (panel && !panel.hidden) actualizar();
  });
})();
