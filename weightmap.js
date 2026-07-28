"use strict";

geotab.addin.weightmap = function () {
  var api = null;
  var map = null;
  var markerLayer = null;
  var refreshTimer = null;

  var GENERIC_CARGO_WEIGHT_ID = "aUHd4kxSPl0ichyMnPHhcLg"; // hydrotech fallback
  var WEIGHT_LOOKBACK_HOURS = 24;   // how far back to look for a weight reading
  var STALE_MINUTES = 60;           // readings older than this are flagged stale

  var state = {
    diagnosticId: null,
    deviceNames: {},
    vehicles: [],   // {id, name, lat, lon, speed, weightKg, weightDate, status}
    loading: false
  };

  var COLORS = { over: "#d32f2f", warn: "#f0a000", under: "#2e9e44", none: "#9aa7b2" };

  function $(id) { return document.getElementById(id); }

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
    // Look the diagnostic up by name so the add-in ports across databases;
    // fall back to the known hydrotech id.
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

  function classify(v, thresholdKg, warnPct) {
    if (v.weightKg === null) { return "none"; }
    if (thresholdKg > 0 && v.weightKg >= thresholdKg) { return "over"; }
    if (thresholdKg > 0 && v.weightKg >= thresholdKg * (warnPct / 100)) { return "warn"; }
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

      // latest weight per device
      var latest = {};
      weightData.forEach(function (s) {
        if (s.data === null || s.data === undefined) { return; }
        var devId = s.device && s.device.id;
        if (!devId) { return; }
        var cur = latest[devId];
        if (!cur || s.dateTime > cur.dateTime) {
          latest[devId] = { dateTime: s.dateTime, kg: s.data / 1000 }; // grams -> kg
        }
      });

      state.vehicles = statusInfos
        .filter(function (si) {
          return si.device && typeof si.latitude === "number" && typeof si.longitude === "number" &&
                 !(si.latitude === 0 && si.longitude === 0);
        })
        .map(function (si) {
          var w = latest[si.device.id];
          return {
            id: si.device.id,
            name: state.deviceNames[si.device.id] || si.device.id,
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
      setStatus(state.vehicles.length + " vehicles on map, " + reporting +
        " reporting weight \u00b7 refreshed " + new Date().toLocaleTimeString());
      state.loading = false;
    }).catch(function (err) {
      setStatus("Failed to load: " + (err && err.message ? err.message : err), true);
      state.loading = false;
    });
  }

  function fmtWeight(kg) {
    return (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtAge(date) {
    if (!date) { return ""; }
    var mins = Math.round((Date.now() - date.getTime()) / 60000);
    if (mins < 1) { return "just now"; }
    if (mins < 60) { return mins + " min ago"; }
    var h = Math.floor(mins / 60);
    return h + " h " + (mins % 60) + " min ago";
  }

  function render() {
    var thresholdKg = (parseFloat($("wm-threshold").value) || 0) * 1000;
    var warnPct = parseFloat($("wm-warnpct").value) || 100;
    var filter = $("wm-filter").value;

    markerLayer.clearLayers();
    var bounds = [];
    var overRows = [];

    state.vehicles.forEach(function (v) {
      var status = classify(v, thresholdKg, warnPct);
      if (filter === "reporting" && v.weightKg === null) { return; }
      if (filter === "over" && status !== "over") { return; }

      var stale = v.weightDate && (Date.now() - v.weightDate.getTime()) > STALE_MINUTES * 60000;

      var marker = L.circleMarker([v.lat, v.lon], {
        radius: status === "over" ? 10 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: COLORS[status],
        fillOpacity: status === "none" ? 0.65 : 0.95
      });

      var weightLine;
      if (v.weightKg === null) {
        weightLine = "No weight data in last " + WEIGHT_LOOKBACK_HOURS + " h";
      } else {
        var cls = status === "over" ? "over" : (status === "warn" ? "warn" : "under");
        weightLine = "Cargo: <span class=\"" + cls + "\">" + fmtWeight(v.weightKg) + " t</span>" +
          (thresholdKg > 0 ? " (" + Math.round((v.weightKg / thresholdKg) * 100) + "% of threshold)" : "") +
          "<br>Reading " + fmtAge(v.weightDate) + (stale ? " \u26a0 stale" : "");
      }

      marker.bindPopup(
        "<div class=\"wm-popup\"><b>" + v.name + "</b><br>" +
        weightLine + "<br>" +
        (v.driving ? "Driving \u00b7 " + Math.round(v.speed) + " km/h" : "Stopped") +
        "</div>"
      );

      marker.addTo(markerLayer);
      bounds.push([v.lat, v.lon]);

      if (status === "over") {
        overRows.push({
          id: v.id, name: v.name, kg: v.weightKg,
          pct: thresholdKg > 0 ? (v.weightKg / thresholdKg) * 100 : 0,
          date: v.weightDate, stale: stale
        });
      }
    });

    if (bounds.length && !map._userMoved) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }

    var tbody = $("wm-over-table").querySelector("tbody");
    tbody.innerHTML = "";
    if (!overRows.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 5;
      td0.className = "none";
      td0.textContent = "No vehicles over the threshold.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    } else {
      overRows.sort(function (a, b) { return b.kg - a.kg; }).forEach(function (r) {
        var tr = document.createElement("tr");

        var tdName = document.createElement("td");
        tdName.textContent = r.name;
        tr.appendChild(tdName);

        var tdW = document.createElement("td");
        tdW.className = "num";
        tdW.textContent = fmtWeight(r.kg);
        tr.appendChild(tdW);

        var tdP = document.createElement("td");
        tdP.className = "num";
        tdP.textContent = Math.round(r.pct) + "%";
        tr.appendChild(tdP);

        var tdD = document.createElement("td");
        tdD.textContent = fmtAge(r.date) + (r.stale ? " \u26a0" : "");
        tr.appendChild(tdD);

        var tdL = document.createElement("td");
        var a = document.createElement("a");
        a.href = "#map,liveVehicleIds:!(" + r.id + ")";
        a.textContent = "Live map";
        tdL.appendChild(a);
        tr.appendChild(tdL);

        tbody.appendChild(tr);
      });
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
