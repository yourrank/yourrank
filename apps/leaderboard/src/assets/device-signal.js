// Anti-abuse device signal (phase 1): the browser computes a one-way SHA-256
// hash of stable technical characteristics. Only the hash leaves the device —
// the raw components never do. See the Privacy Policy "Anti-abuse signals".
(function () {
  "use strict";

  var FONT_CANDIDATES = [
    "Arial", "Arial Black", "Calibri", "Cambria", "Comic Sans MS", "Consolas",
    "Courier New", "Georgia", "Helvetica", "Impact", "Lucida Console",
    "Lucida Sans Unicode", "Palatino Linotype", "Segoe UI", "Tahoma",
    "Times New Roman", "Trebuchet MS", "Verdana", "Symbol", "Wingdings",
  ];
  var FONT_PROBE = "mmmmmmmmmmlli";
  var FONT_BASELINES = ["monospace", "serif", "sans-serif"];
  var FONT_SIZE = "72px";

  function component(name, fn) {
    try {
      return fn();
    } catch (err) {
      console.warn("[device-signal] " + name + " unavailable", err);
      return "unavailable";
    }
  }

  function canvasSignal() {
    var canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 60;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 10, 80, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("yr-signal 🎯✓", 4, 14);
    ctx.strokeStyle = "rgba(102,204,0,0.7)";
    ctx.arc(60, 42, 14, 0, Math.PI * 1.5);
    ctx.stroke();
    return canvas.toDataURL();
  }

  function webglSignal() {
    var canvas = document.createElement("canvas");
    var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("no webgl context");
    var debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  }

  function fontSignal() {
    var body = document.body;
    if (!body) throw new Error("no document body");
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;";
    probe.textContent = FONT_PROBE;
    var widths = {};
    FONT_BASELINES.forEach(function (base) {
      probe.style.fontFamily = base;
      probe.style.fontSize = FONT_SIZE;
      body.appendChild(probe);
      widths[base] = probe.offsetWidth;
      body.removeChild(probe);
    });
    return FONT_CANDIDATES.filter(function (font) {
      return FONT_BASELINES.some(function (base) {
        probe.style.fontFamily = "'" + font + "'," + base;
        probe.style.fontSize = FONT_SIZE;
        body.appendChild(probe);
        var width = probe.offsetWidth;
        body.removeChild(probe);
        return width !== widths[base];
      });
    });
  }

  function collect() {
    return {
      canvas: component("canvas", canvasSignal),
      webgl: component("webgl", webglSignal),
      fonts: component("fonts", fontSignal),
      screen: component("screen", function () {
        return {
          width: window.screen && window.screen.width,
          height: window.screen && window.screen.height,
          colorDepth: window.screen && window.screen.colorDepth,
        };
      }),
      timeZone: component("timezone", function () {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      }),
      userAgent: component("useragent", function () { return navigator.userAgent; }),
      language: component("language", function () { return navigator.language; }),
      hardwareConcurrency: component("hardware", function () { return navigator.hardwareConcurrency; }),
    };
  }

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  function compute() {
    if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) {
      console.warn("[device-signal] crypto.subtle unavailable; no device hash");
      return Promise.resolve(null);
    }
    var collected = collect();
    var ordered = {};
    ["canvas", "fonts", "hardwareConcurrency", "language", "screen", "timeZone", "userAgent", "webgl"].forEach(function (key) {
      ordered[key] = collected[key];
    });
    var payload = JSON.stringify(ordered);
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)).then(hex);
  }

  var cached;
  function hash() {
    if (!cached) cached = compute();
    return cached;
  }

  window.YRDeviceSignal = { hash: hash };
  // Start computing on load so callers only ever wait on the cached promise.
  hash();
})();
