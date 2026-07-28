"use strict";

geotab.addin.weightmap = function () {
  var api = null;
  var map = null;
  var markerLayer = null;
  var refreshTimer = null;

  var GENERIC_CARGO_WEIGHT_ID = "aUHd4kxSPl0ichyMnPHhcLg"; // hydrotech fallback
  var WEIGHT_LOOKBACK_HOURS = 24;
  var STALE_MINUTES = 60;

  var state = {
    diagnosticId: null,
    deviceNames: {},
    vehicles: [],
    loading: false
  };

  var COLORS = {
    critical: "#8e0000",
    over: "#d32f2f",
    warn: "#f0a000",
    under: "#2e9e44",
    none: "#9aa7b2"
  };

  function $(id) { return document.getElementById(id); }

  function normName(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function registerFor(name) {
    if (typeof WEIGHT_REGISTER === "undefined") { return null; }
    return WEIGHT_REGISTER[normName(name)] || null;
  }

  function setStatus(msg, isError) {
    var el = $("wm-status");
    el.textContent = msg || "";
    el.className = "wm-status" + (isError ? " error" : "");
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      api.call(method, params, resolve, reject);
    });
  }

  function resolveDiagnostic() {
    return call("Get", { typeName: "Diagnostic", search: { name: "%generic cargo weight%" } })
      .then(function (diags) {
        state.diagnosticId = (diags && diags.length) ? diags[0].id : GENERIC_CARGO_WEIGHT_ID;
      })
      .catch(function () { state.diagnosticId = GENERIC_CARGO_WEIGHT_ID; });
  }

  function loadDevices() {
    return call("Get", { typeName: "Device" }).then(function (devices) {
      state.deviceNames = {};
      devices.forEach(function (d) { state.deviceNames[d.id] = d.name || d.id; });
    });
  }

  // Threshold model, per vehicle:
  //  - Register match: alert at GML payload (GML - tare == "Payload kg"), critical at GVM payload (GVM - tare).
  //  - No register match: fall back to the global threshold input.
  function limitsFor(v, fallbackKg) {
    if (v.reg && v.reg.payload) {
      return {
        alertKg: v.reg.payload,
        criticalKg: (v.reg.gvm && v.reg.tare) ? (v.reg.gvm - v.reg.tare) : null,
        source: "register"
      };
    }
    return { alertKg: fallbackKg > 0 ? fallbackKg : null, criticalKg: null, source: "fallback" };
  }

  function classify(v, fallbackKg, warnPct) {
    if (v.weightKg === null) { return "none"; }
    var lim = limitsFor(v, fallbackKg);
    if (lim.alertKg === null) { return "under"; }
    if (lim.criticalKg && v.weightKg >= lim.criticalKg) { return "critical"; }
    if (v.weightKg >= lim.alertKg) { return "over"; }
    if (v.weightKg >= lim.alertKg * (warnPct / 100)) { return "warn"; }
    return "under";
  }

  function loadData() {
    if (state.loading || !api) { return; }
    state.loading = true;
    setStatus("Loading positions and weights\u2026");

    var now = new Date();
    var from = new Date(now.getTime() - WEIGHT_LOOKBACK_HOURS * 3600e3);

    Promise.all([
      call("Get", { typeName: "DeviceStatusInfo" }),
      call("Get", {
        typeName: "StatusData",
        search: {
          diagnosticSearch: { id: state.diagnosticId },
          fromDate: from.toISOString(),
          toDate: now.toISOString()
        },
        resultsLimit: 50000
      })
    ]).then(function (results) {
      var statusInfos = results[0] || [];
      var weightData = results[1] || [];

      var latest = {};
      weightData.forEach(function (s) {
        if (s.data === null || s.data === undefined) { return; }
        var devId = s.device && s.device.id;
        if (!devId) { return; }
        var cur = latest[devId];
        if (!cur || s.dateTime > cur.dateTime) {
          latest[devId] = { dateTime: s.dateTime, kg: s.data / 1000 };
        }
      });

      state.vehicles = statusInfos
        .filter(function (si) {
          return si.device && typeof si.latitude === "number" && typeof si.longitude === "number" &&
                 !(si.latitude === 0 && si.longitude === 0);
        })
        .map(function (si) {
          var name = state.deviceNames[si.device.id] || si.device.id;
          var w = latest[si.device.id];
          return {
            id: si.device.id,
            name: name,
            reg: registerFor(name),
            lat: si.latitude,
            lon: si.longitude,
            speed: si.speed || 0,
            driving: !!si.isDriving,
            weightKg: w ? w.kg : null,
            weightDate: w ? new Date(w.dateTime) : null
          };
        });

      render();
      var reporting = state.vehicles.filter(function (v) { return v.weightKg !== null; }).length;
      var withReg = state.vehicles.filter(function (v) { return !!v.reg; }).length;
      setStatus(state.vehicles.length + " vehicles on map \u00b7 " + reporting +
        " reporting weight \u00b7 " + withReg + " in axle scale register \u00b7 refreshed " +
        new Date().toLocaleTimeString());
      state.loading = false;
    }).catch(function (err) {
      setStatus("Failed to load: " + (err && err.message ? err.message : err), true);
      state.loading = false;
    });
  }

  function fmtT(kg, dp) {
    if (kg === null || kg === undefined) { return "\u2013"; }
    return (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: dp === undefined ? 2 : dp });
  }

  function fmtAge(date) {
    if (!date) { return ""; }
    var mins = Math.round((Date.now() - date.getTime()) / 60000);
    if (mins < 1) { return "just now"; }
    if (mins < 60) { return mins + " min ago"; }
    var h = Math.floor(mins / 60);
    return h + " h " + (mins % 60) + " min ago";
  }

  function popupHtml(v, status, fallbackKg) {
    var lim = limitsFor(v, fallbackKg);
    var html = "<div class=\"wm-popup\"><b>" + v.name + "</b>";
    if (v.reg) {
      html += " <span class=\"rego\">" + v.reg.rego + " \u00b7 " + v.reg.axles + "</span>";
    }
    html += "<br>";

    if (v.weightKg === null) {
      html += "No weight data in last " + WEIGHT_LOOKBACK_HOURS + " h<br>";
    } else {
      var cls = (status === "over" || status === "critical") ? "over" : (status === "warn" ? "warn" : "under");
      html += "Cargo: <span class=\"" + cls + "\">" + fmtT(v.weightKg) + " t</span>";
      if (lim.alertKg) {
        html += " \u2014 " + Math.round((v.weightKg / lim.alertKg) * 100) + "% of limit";
      }
      html += "<br>";
      if (status === "critical") { html += "<span class=\"over\">OVER GVM PAYLOAD \u2014 no insurance cover</span><br>"; }
      else if (status === "over" && lim.source === "register") { html += "<span class=\"over\">OVER GML PAYLOAD</span><br>"; }
      var stale = v.weightDate && (Date.now() - v.weightDate.getTime()) > STALE_MINUTES * 60000;
      html += "Reading " + fmtAge(v.weightDate) + (stale ? " \u26a0 stale" : "") + "<br>";
    }

    if (v.reg) {
      html += "<span class=\"regdata\">Tare " + fmtT(v.reg.tare, 2) + " t \u00b7 GML " + fmtT(v.reg.gml, 1) +
        " t \u00b7 GVM " + fmtT(v.reg.gvm, 1) + " t<br>Payload limit " + fmtT(v.reg.payload, 2) + " t (GML)" +
        (lim.criticalKg ? " \u00b7 " + fmtT(lim.criticalKg, 2) + " t (GVM)" : "") + "</span><br>";
    } else {
      html += "<span class=\"regdata\">Not in axle scale register \u2014 using fallback threshold</span><br>";
    }

    html += (v.driving ? "Driving \u00b7 " + Math.round(v.speed) + " km/h" : "Stopped") + "</div>";
    return html;
  }

  function render() {
    var fallbackKg = (parseFloat($("wm-threshold").value) || 0) * 1000;
    var warnPct = parseFloat($("wm-warnpct").value) || 100;
    var filter = $("wm-filter").value;

    markerLayer.clearLayers();
    var bounds = [];
    var tableRows = [];

    state.vehicles.forEach(function (v) {
      var status = classify(v, fallbackKg, warnPct);
      var show =
        filter === "all" ||
        (filter === "reporting" && v.weightKg !== null) ||
        (filter === "register" && !!v.reg) ||
        (filter === "over" && (status === "over" || status === "critical"));
      if (!show) { return; }

      var flash = status === "over" || status === "critical";
      var marker = L.circleMarker([v.lat, v.lon], {
        radius: flash ? 10 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: COLORS[status],
        fillOpacity: status === "none" ? 0.65 : 0.95,
        className: flash ? "wm-flash" : ""
      });
      marker.bindPopup(popupHtml(v, status, fallbackKg));
      marker.addTo(markerLayer);
      bounds.push([v.lat, v.lon]);

      if (v.reg || v.weightKg !== null) {
        var lim = limitsFor(v, fallbackKg);
        tableRows.push({
          v: v, status: status,
          pct: (v.weightKg !== null && lim.alertKg) ? (v.weightKg / lim.alertKg) * 100 : null
        });
      }
    });

    if (bounds.length && !map._userMoved) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }

    renderTable(tableRows);
  }

  var STATUS_LABEL = {
    critical: "OVER GVM", over: "OVER LIMIT", warn: "Approaching",
    under: "OK", none: "No data"
  };

  function renderTable(rows) {
    var tbody = $("wm-table").querySelector("tbody");
    tbody.innerHTML = "";
    rows.sort(function (a, b) {
      var rank = { critical: 0, over: 1, warn: 2, under: 3, none: 4 };
      if (rank[a.status] !== rank[b.status]) { return rank[a.status] - rank[b.status]; }
      return (b.pct || 0) - (a.pct || 0);
    });
    rows.forEach(function (r) {
      var v = r.v, reg = v.reg;
      var tr = document.createElement("tr");
      tr.className = "row-" + r.status;

      function td(text, cls) {
        var el = document.createElement("td");
        if (cls) { el.className = cls; }
        el.textContent = text;
        tr.appendChild(el);
      }

      td(v.name);
      td(reg ? reg.rego : "\u2013");
      td(reg ? reg.axles : "\u2013");
      td(reg ? fmtT(reg.tare) : "\u2013", "num");
      td(reg ? fmtT(reg.gml, 1) : "\u2013", "num");
      td(reg ? fmtT(reg.gvm, 1) : "\u2013", "num");
      td(reg ? fmtT(reg.payload) : "(fallback)", "num");
      td(v.weightKg !== null ? fmtT(v.weightKg) : "\u2013", "num");
      td(r.pct !== null ? Math.round(r.pct) + "%" : "\u2013", "num");

      var tdS = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "badge badge-" + r.status;
      badge.textContent = STATUS_LABEL[r.status];
      tdS.appendChild(badge);
      tr.appendChild(tdS);

      tbody.appendChild(tr);
    });
    if (!rows.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 10;
      td0.className = "none";
      td0.textContent = "No monitored vehicles to show.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
  }

  function applyAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if ($("wm-autorefresh").checked) {
      refreshTimer = setInterval(loadData, 60000);
    }
  }

  return {
    initialize: function (freshApi, pageState, callback) {
      api = freshApi;

      map = L.map("wm-map").setView([-38.5, 175.5], 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
      map.on("dragstart zoomstart", function () { map._userMoved = true; });

      $("wm-refresh").addEventListener("click", loadData);
      ["wm-threshold", "wm-warnpct", "wm-filter"].forEach(function (id) {
        $(id).addEventListener("change", render);
      });
      $("wm-autorefresh").addEventListener("change", applyAutoRefresh);

      resolveDiagnostic()
        .then(loadDevices)
        .then(function () {
          callback();
          loadData();
          applyAutoRefresh();
        })
        .catch(function (err) {
          setStatus("Initialisation failed: " + (err && err.message ? err.message : err), true);
          callback();
        });
    },

    focus: function (freshApi) {
      api = freshApi;
      if (map) { setTimeout(function () { map.invalidateSize(); }, 100); }
      if (state.diagnosticId) { loadData(); applyAutoRefresh(); }
    },

    blur: function () {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }
  };
};
