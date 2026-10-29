/*
 * KCurve 1.1.0 — Flow-style easing curve editor for EffectCraft.
 *
 * Run it from File ▸ Scripts ▸ Run Script File… (a floating, resizable palette), or install it
 * with File ▸ Scripts ▸ Install ScriptUI Panel… (the docked panel opens the floating editor).
 *
 * Design notes
 * ------------
 * Curve model: the editor keeps a chain of anchors. The first anchor is (0,0) and the last is
 * (1,1); every anchor has an optional incoming handle (hIn) and outgoing handle (hOut).
 *  - Two anchors = single-segment ease editor.
 *  - Three+ anchors = multi-point mode, and each point is a REAL KEYFRAME, not a split point.
 *    Every point still has its own levers; the curve of a segment uses the previous point's hOut
 *    and the next point's hIn. Only the selected point's levers are drawn, so the graph stays
 *    clean. A middle point is "smooth" by default; 平滑/折断 toggles that constraint.
 *    Applying multi-point mode removes the selected keys and rebuilds one key per point at the
 *    proportional time, then maps each segment's levers to KeyframeEase values.
 *
 * Import strategy: two selected keys -> read the out side of the pair and the in side of its
 * second key, average multiple pairs, and fill the single-segment editor. Three or more selected
 * keys -> import them as multi-point keyframes. Averaging is documented here because the pair
 * count can be larger than one; the status line says how many pairs were averaged.
 *
 * Apply strategy (single mode): selected adjacent key pairs are eased in order — segment k of the
 * curve goes to pair k (extra pairs reuse the last segment; extra curve segments are ignored). A
 * lone selected key eases its outgoing side with the first segment and its incoming side with the
 * last one, as the official Ease Presets extension does. In / Out / In-Out picks the sides. All
 * writes share one undo step ("KCurve: Apply Easing"); while dragging with 实时写入 on,
 * mousedown→mouseup is one undo step. Roving keys and Hold sides are skipped and counted.
 *
 * Persistence: EffectCraft scripts cannot write files unless the user enables
 * Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files…, so presets are stored in
 * app.settings (section "KCurve", key "state" → <config>/script_settings.json). They are
 * application-wide, not saved in the .ecproj. That is the same approach the official Ease Presets
 * extension uses. The settings JSON also keeps the last curve, window size, switches and groups.
 *
 * Why not expressions: applying a temporal keyframe ease is the stable, renderer-native option
 * and does not touch any expression the user already has. The alternative — writing an expression
 * such as
 *     var p = ...; // normalised progress, then invert the cubic-bezier for time
 *     valueAtTime(t0 + progress * dur)
 * — was considered but is not used: it would overwrite existing expressions, needs
 * per-property/path plumbing, and the KeyframeEase route is verified to reproduce the
 * cubic-bezier exactly in this version (max error ~1e-12 in verify/ease_math_probe.jsx).
 * If a future EffectCraft build makes expressions safer for this, the same curve data could be
 * emitted as an expression instead of touching keyframe eases; the editor and preset format stay
 * the same.
 *
 * Platform limitation (0.13.0): a DOCKED ScriptUI panel never learns its real allocated size; the
 * host lays out a clone but onDraw runs at the panel's preferredSize (see
 * docs/effectcraft/KCURVE_NOTES.md §6). A resizable curve canvas therefore has to be a floating
 * Window. KCurve's editor is floating and resizes by dragging its right/bottom edges. The installed
 * ScriptUI panel is a small launcher for the same floating editor.
 *
 * Material 3 Expressive: everything except the editor canvas is drawn as rounded cards/pills, with
 * a dark/light palette read from EffectCraft's appearance.theme and large, expressive radii.
 *
 * License: MIT. The easing math follows EffectCraft's official Ease Presets extension
 * (MIT OR Apache-2.0) by the EffectCraft contributors.
 */

(function (thisObj) {
  // ---------------------------------------------------------------- constants
  var KCURVE_VERSION = "1.1.0";
  var SETTINGS_SECTION = "KCurve";
  var SETTINGS_KEY = "state";
  var STATE_VERSION = 5;
  var DEFAULT_W = 600;
  var DEFAULT_H = 780;
  var MIN_W = 380;
  var MIN_H = 600;
  var FIXED_W = 340;
  var FIXED_H = 530;
  var BEZIER = KeyframeInterpolationType.BEZIER;
  var HOLD = KeyframeInterpolationType.HOLD;
  var IS_PANEL = thisObj instanceof Panel;
  var OS = String($.os || "");
  var FONT_FAMILY = OS.indexOf("Windows") >= 0 ? "Microsoft YaHei UI"
    : OS.indexOf("Mac") >= 0 ? "PingFang SC"
    : "Noto Sans CJK SC";

  // ---------------------------------------------------------------- small utils
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function finite(v) { return typeof v === "number" && isFinite(v); }
  function n(v, d) { return finite(Number(v)) ? Number(v) : d; }
  function round(v, p) { var f = Math.pow(10, p || 0); return Math.round(v * f) / f; }
  function fmt(v, p) { var s = String(round(v, p)); return s; }
  function pad2(v) { return v < 10 ? "0" + v : String(v); }
  var ellipsisCache = {}, ellipsisCacheCount = 0;
  function ellipsize(g, s, size, maxW) {
    s = String(s);
    if (maxW <= 0) return "";
    var key = size + "|" + Math.round(maxW) + "|" + s;
    if (ellipsisCache.hasOwnProperty(key)) return ellipsisCache[key];
    var out;
    if (measure(g, s, size) <= maxW) {
      out = s;
    } else {
      var lo = 0, hi = s.length;
      while (lo < hi) {
        var mid = Math.ceil((lo + hi) / 2);
        if (measure(g, s.substr(0, mid) + "…", size) <= maxW) lo = mid; else hi = mid - 1;
      }
      out = lo > 0 ? s.substr(0, lo) + "…" : "";
    }
    if (ellipsisCacheCount > 600) { ellipsisCache = {}; ellipsisCacheCount = 0; }
    ellipsisCache[key] = out;
    ellipsisCacheCount++;
    return out;
  }
  function nowMs() { return new Date().getTime(); }

  // ---------------------------------------------------------------- colours (sRGB hex → linear RGBA)
  var paletteCache = {};
  function srgbToLinear(v) {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function C(hex, alpha) {
    var h = String(hex).replace(/^#/, "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var key = h + "|" + (alpha === undefined ? 1 : alpha);
    if (paletteCache[key]) return paletteCache[key];
    var c = [
      srgbToLinear(parseInt(h.substr(0, 2), 16)),
      srgbToLinear(parseInt(h.substr(2, 2), 16)),
      srgbToLinear(parseInt(h.substr(4, 2), 16)),
      alpha === undefined ? 1 : alpha
    ];
    paletteCache[key] = c;
    return c;
  }
  function withAlpha(c, a) { return [c[0], c[1], c[2], a]; }
  function mixColor(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a.length > 3 ? a[3] : 1];
  }

  function makePalette(kind) {
    if (kind === "light") {
      return {
        name: "light",
        bg: C("#F1F2F5"), surface: C("#FFFFFF"), low: C("#F6F7FA"), high: C("#EEF0F5"),
        highest: C("#E3E6EE"), outline: C("#C5CAD4"), outlineSoft: C("#E2E5EB"),
        text: C("#14161A"), dim: C("#565C66"), faint: C("#8A909A"),
        primary: C("#3D5A88"), onPrimary: C("#FFFFFF"), primaryContainer: C("#D6E3FF"),
        onPrimaryContainer: C("#001B3E"), secondary: C("#5B5D72"), success: C("#2B7048"),
        warning: C("#865500"), danger: C("#AF2A22"), shadow: C("#000000", 0.14),
        track: C("#C6CBD5"), knob: C("#FFFFFF")
      };
    }
    if (kind === "darker") {
      return {
        name: "darker",
        bg: C("#030304"), surface: C("#0E0E0F"), low: C("#151516"), high: C("#202021"),
        highest: C("#2A2A2C"), outline: C("#333336"), outlineSoft: C("#232326"),
        text: C("#F3F3F5"), dim: C("#A8A8AE"), faint: C("#717177"),
        primary: C("#A8C7FA"), onPrimary: C("#0A2A52"), primaryContainer: C("#1F3550"),
        onPrimaryContainer: C("#D7E3FF"), secondary: C("#CBC2DB"), success: C("#8AD8A4"),
        warning: C("#F4C36A"), danger: C("#FFB4AB"), shadow: C("#000000", 0.5),
        track: C("#2B2B2E"), knob: C("#F3F3F5")
      };
    }
    return {
      name: "dark",
      bg: C("#060607"), surface: C("#121213"), low: C("#19191B"), high: C("#222224"),
      highest: C("#2C2C2F"), outline: C("#36363A"), outlineSoft: C("#242427"),
      text: C("#F2F2F4"), dim: C("#A9A9AF"), faint: C("#737379"),
      primary: C("#A8C7FA"), onPrimary: C("#0A2A52"), primaryContainer: C("#1F3550"),
      onPrimaryContainer: C("#D7E3FF"), secondary: C("#CBC2DB"), success: C("#8AD8A4"),
      warning: C("#F4C36A"), danger: C("#FFB4AB"), shadow: C("#000000", 0.45),
      track: C("#2B2B2E"), knob: C("#F2F2F4")
    };
  }
  var P = makePalette("dark");

  function readTheme() {
    try {
      var r = app.run("prefs.get", { key: "appearance.theme" });
      // prefs.get with a key returns the value itself: the string "dark" / "darker" / "light".
      if (typeof r === "string") return r;
      if (r && typeof r.theme === "string") return r.theme;
    } catch (e) {}
    return "dark";
  }
  function refreshTheme() {
    var t = readTheme();
    if (t !== P.name) {
      P = makePalette(t);
      paletteCache = {}; // keep hex→linear cache, it does not depend on the palette
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- fonts & text
  var fontCache = {};
  function font(size, style) {
    var k = size + "|" + (style || "REGULAR");
    if (!fontCache[k]) fontCache[k] = ScriptUI.newFont(FONT_FAMILY, style || "REGULAR", size);
    return fontCache[k];
  }
  function measure(g, text, size, style, maxW) {
    try {
      g.font = font(size, style);
      var m = g.measureString(String(text), g.font);
      var w = m ? m[0] : String(text).length * size * 0.55;
      if (maxW !== undefined && maxW > 0 && w > maxW) return maxW;
      return w;
    } catch (e) { return String(text).length * size * 0.55; }
  }
  // Host measureString under-reports CJK advance in EffectCraft; using its raw value made pill
  // labels sit visibly right of centre. Estimate the painted width for layout instead.
  function visualWidth(s, size) {
    s = String(s);
    var w = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      w += (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)
        ? size * 1.12 : size * 0.56;
    }
    return w;
  }
  function textWidth(g, s, size, style) { return measure(g, s, size, style); }
  // Draw text vertically centred inside a control rectangle; prevents the "text sits too low"
  // look and the overlapping labels the first version had.
  function textBox(g, s, x, y, w, h, size, color, align, style, maxW) {
    s = String(s);
    if (maxW !== undefined && maxW > 0) s = ellipsize(g, s, size, maxW);
    var tw = visualWidth(s, size);
    var tx = align === "center" ? x + (w - tw) / 2 : align === "right" ? x + w - tw : x;
    var ty = y + (h - size * 1.22) / 2 + 1;
    g.font = font(size, style);
    g.drawString(s, g.newPen(g.PenType.SOLID_COLOR, color, 1), tx, ty);
  }

  // ---------------------------------------------------------------- drawing primitives
  // NOTE: EffectCraft's ScriptUIGraphics is graphics-level, not the standard ScriptUI path-object
  // API: newPath() clears the current path and moveTo/lineTo/rectPath/ellipsePath append to it;
  // fillPath(brush[, path]) and strokePath(pen[, path]) paint the current path. Helpers below
  // keep that convention.
  function roundPath(g, x, y, w, h, r, segOverride) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    // Every rounded shape is painted as a polyline and the canvas is fully repainted while
    // dragging, so the corner segment count is a direct per-frame cost. At 1x with no
    // anti-aliasing, 4 segments per corner of a 10px radius are within ~0.2px of the true arc;
    // only large radii need a couple more.
    var i, a, seg = segOverride || Math.max(3, Math.min(6, Math.round(r * 0.4)));
    g.newPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    for (i = 1; i <= seg; i++) {
      a = -Math.PI / 2 + (Math.PI / 2) * i / seg;
      g.lineTo(x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r);
    }
    g.lineTo(x + w, y + h - r);
    for (i = 1; i <= seg; i++) {
      a = (Math.PI / 2) * i / seg;
      g.lineTo(x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r);
    }
    g.lineTo(x + r, y + h);
    for (i = 1; i <= seg; i++) {
      a = Math.PI / 2 + (Math.PI / 2) * i / seg;
      g.lineTo(x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r);
    }
    g.lineTo(x, y + r);
    for (i = 1; i <= seg; i++) {
      a = Math.PI + (Math.PI / 2) * i / seg;
      g.lineTo(x + r + Math.cos(a) * r, y + r + Math.sin(a) * r);
    }
    g.closePath();
  }
  function fillRound(g, x, y, w, h, r, color, segOverride) {
    if (w <= 0 || h <= 0) return;
    roundPath(g, x, y, w, h, r, segOverride);
    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
  }
  function strokeRound(g, x, y, w, h, r, color, width) {
    if (w <= 0 || h <= 0) return;
    roundPath(g, x, y, w, h, r);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }
  function line(g, x1, y1, x2, y2, color, width) {
    g.newPath();
    g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }
  function fillRect(g, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    g.newPath();
    g.rectPath(x, y, w, h);
    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
  }
  function strokeRect(g, x, y, w, h, color, width) {
    if (w <= 0 || h <= 0) return;
    g.newPath();
    g.rectPath(x, y, w, h);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }
  function circle(g, x, y, r, fillColor, strokeColor, strokeW) {
    g.newPath();
    g.ellipsePath(x - r, y - r, r * 2, r * 2);
    if (fillColor) g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, fillColor));
    if (strokeColor) g.strokePath(g.newPen(g.PenType.SOLID_COLOR, strokeColor, strokeW || 1));
  }
  function dashedLine(g, x1, y1, x2, y2, color, width, dash, gap) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0) return;
    var ux = dx / len, uy = dy / len, t = 0, started = false;
    g.newPath();
    while (t < len) {
      var e = Math.min(len, t + dash);
      if (!started) { g.moveTo(x1 + ux * t, y1 + uy * t); started = true; }
      else g.lineTo(x1 + ux * t, y1 + uy * t);
      g.lineTo(x1 + ux * e, y1 + uy * e);
      t = e + gap;
      started = false;
    }
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }

  // ---------------------------------------------------------------- curve model
  // anchor = { x, y, hIn:{x,y}|null, hOut:{x,y}|null, smooth:bool }
  function defaultAnchors() {
    return [
      { x: 0, y: 0, hIn: null, hOut: { x: 0.33, y: 0 }, smooth: false },
      { x: 1, y: 1, hIn: { x: 0.67, y: 1 }, hOut: null, smooth: false }
    ];
  }
  function cloneAnchors(a) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
      out.push({
        x: a[i].x, y: a[i].y,
        hIn: a[i].hIn ? { x: a[i].hIn.x, y: a[i].hIn.y } : null,
        hOut: a[i].hOut ? { x: a[i].hOut.x, y: a[i].hOut.y } : null,
        smooth: !!a[i].smooth,
        m: finite(a[i].m) ? a[i].m : null
      });
    }
    return out;
  }
  function isMulti() { return !!(S && S.anchors && S.anchors.length > 2); }
  function segmentOf(a, i) {
    var p = a[i], q = a[i + 1];
    return {
      x1: p.hOut ? p.hOut.x : p.x, y1: p.hOut ? p.hOut.y : p.y,
      x2: q.hIn ? q.hIn.x : q.x, y2: q.hIn ? q.hIn.y : q.y
    };
  }
  function segmentsOf(a) {
    var out = [];
    for (var i = 0; i + 1 < a.length; i++) out.push(segmentOf(a, i));
    return out;
  }
  // Multi-point mode: every anchor is a KEYFRAME, not a Bezier split point. The curve through
  // them is a cubic Hermite spline; derivatives are central differences for smooth points and
  // one-sided differences for "broken" points. No handle lines are drawn.
  function multiDerivs(a) {
    var n = a.length, left = [], right = [];
    function slope(i) { return (a[i + 1].y - a[i].y) / Math.max(1e-6, a[i + 1].x - a[i].x); }
    for (var i = 0; i < n; i++) {
      var smooth = a[i].smooth !== false;
      if (i === 0) { right[0] = finite(a[0].m) ? a[0].m : slope(0); left[0] = right[0]; }
      else if (i === n - 1) { left[i] = finite(a[i].m) ? a[i].m : slope(i - 1); right[i] = left[i]; }
      else if (smooth) {
        if (finite(a[i].m)) left[i] = right[i] = a[i].m;
        else {
          var m = (a[i + 1].y - a[i - 1].y) / Math.max(1e-6, a[i + 1].x - a[i - 1].x);
          left[i] = right[i] = m;
        }
      } else {
        left[i] = slope(i - 1); right[i] = slope(i);
      }
    }
    return { left: left, right: right };
  }
  // Exact derivative of a normalized cubic at parameter t; used only when converting a single
  // ease into multi-point keyframes so the shape is preserved.
  function cubicSlopeAt(seg, t) {
    var u = 1 - t;
    var dx = 3 * u * u * seg.x1 + 6 * u * t * (seg.x2 - seg.x1) + 3 * t * t * (1 - seg.x2);
    var dy = 3 * u * u * seg.y1 + 6 * u * t * (seg.y2 - seg.y1) + 3 * t * t * (1 - seg.y2);
    if (Math.abs(dx) < 1e-9) return 0;
    return dy / dx;
  }
  function multiCurveSegments(a) {
    var out = [];
    for (var i = 0; i + 1 < a.length; i++) {
      var p = a[i], q = a[i + 1], dx = q.x - p.x;
      var ho = p.hOut || { x: p.x + dx / 3, y: p.y };
      var hi = q.hIn || { x: q.x - dx / 3, y: q.y };
      out.push({
        x0: p.x, y0: p.y,
        x1: ho.x, y1: ho.y,
        x2: hi.x, y2: hi.y,
        x3: q.x, y3: q.y
      });
    }
    return out;
  }
  function cubicPointAt(seg, t) {
    var u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
    return [
      a0 * seg.x0 + a1 * seg.x1 + a2 * seg.x2 + a3 * seg.x3,
      a0 * seg.y0 + a1 * seg.y1 + a2 * seg.y2 + a3 * seg.y3
    ];
  }
  function anchorsFromSegment(x1, y1, x2, y2) {
    return [
      { x: 0, y: 0, hIn: null, hOut: { x: x1, y: y1 }, smooth: false },
      { x: 1, y: 1, hIn: { x: x2, y: y2 }, hOut: null, smooth: false }
    ];
  }
  function segPoint(seg, t) {
    var u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
    return [
      a0 * 0 + a1 * seg.x1 + a2 * seg.x2 + a3 * 1,
      a0 * 0 + a1 * seg.y1 + a2 * seg.y2 + a3 * 1
    ];
  }
  function midPoint(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function sanitizeAnchors(list) {
    if (!(list instanceof Array) || list.length < 2) return null;
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !finite(a.x) || !finite(a.y)) return null;
      var hIn = null, hOut = null;
      if (a.hIn && finite(a.hIn.x) && finite(a.hIn.y)) hIn = { x: a.hIn.x, y: a.hIn.y };
      if (a.hOut && finite(a.hOut.x) && finite(a.hOut.y)) hOut = { x: a.hOut.x, y: a.hOut.y };
      out.push({
        x: i === 0 ? 0 : i === list.length - 1 ? 1 : clamp(a.x, 0.0001, 0.9999),
        y: a.y, hIn: hIn, hOut: hOut, smooth: !!a.smooth,
        m: finite(a.m) ? a.m : null
      });
    }
    out[0].x = 0; out[out.length - 1].x = 1;
    for (i = 1; i < out.length; i++) {
      if (out[i].x <= out[i - 1].x) out[i].x = Math.min(0.9999, out[i - 1].x + 0.0005);
    }
    if (out[out.length - 1].x !== 1) out[out.length - 1].x = 1;
    if (out.length > 2) {
      // Multi points are keyframes that may each carry an in/out handle. Old files without
      // handles are completed later by ensureMultiHandles().
      for (i = 0; i < out.length; i++) {
        out[i].smooth = list[i].smooth === true;
        out[i].m = finite(list[i].m) ? list[i].m : null;
      }
    }
    return out;
  }
  // Give any multi-point keyframe that has no handles a linear handle so the curve is usable and
  // the selected point always has something to drag.
  function ensureMultiHandles(a) {
    if (!a || a.length < 2) return;
    for (var i = 0; i < a.length; i++) {
      if (!a[i].hIn && i > 0) {
        a[i].hIn = {
          x: a[i].x - (a[i].x - a[i - 1].x) / 3,
          y: a[i].y - (a[i].y - a[i - 1].y) / 3
        };
      }
      if (!a[i].hOut && i < a.length - 1) {
        a[i].hOut = {
          x: a[i].x + (a[i + 1].x - a[i].x) / 3,
          y: a[i].y + (a[i + 1].y - a[i].y) / 3
        };
      }
    }
    for (i = 0; i < a.length; i++) clampAnchorHandles(i);
  }

  function selectedSegmentIndex(anchors) {
    if (anchors.length < 2) return 0;
    var i = clamp(S.selectedAnchor | 0, 0, anchors.length - 1);
    return i >= anchors.length - 1 ? anchors.length - 2 : i;
  }

  function splitCubic(p0, p1, p2, p3, t) {
    function lerp(a, b) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    var q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
    var r0 = lerp(q0, q1), r1 = lerp(q1, q2);
    var s = lerp(r0, r1);
    return {
      left: { p0: p0, p1: q0, p2: r0, p3: s },
      right: { p0: s, p1: r1, p2: q2, p3: p3 },
      mid: s
    };
  }
  function addAnchor() {
    var a = S.anchors;
    if (!isMulti()) {
      // Single cubic -> three keyframe points. Splitting the cubic exactly preserves its shape;
      // the middle point is a real keyframe with its own in/out levers.
      var seg = segmentOf(a, 0);
      var sp = splitCubic(
        { x: 0, y: 0 }, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, { x: 1, y: 1 }, 0.5
      );
      S.anchors = [
        { x: 0, y: 0, hIn: null, hOut: sp.left.p1, smooth: false },
        { x: sp.mid.x, y: sp.mid.y, hIn: sp.left.p2, hOut: sp.right.p1, smooth: false },
        { x: 1, y: 1, hIn: sp.right.p2, hOut: null, smooth: false }
      ];
      S.selectedAnchor = 1;
      st("多点模式：每个点是一个关键帧，选中点才显示操纵杆；点 √ 写入时间线",
        "Multi-point mode: each point is a keyframe; select a point to show its levers; click √ to write");
      saveState(); redraw();
      return;
    }
    var i = selectedSegmentIndex(a);
    var p = a[i], q = a[i + 1];
    var ho = p.hOut || { x: p.x + (q.x - p.x) / 3, y: p.y + (q.y - p.y) / 3 };
    var hi = q.hIn || { x: q.x - (q.x - p.x) / 3, y: q.y - (q.y - p.y) / 3 };
    var sp2 = splitCubic(p, ho, hi, q, 0.5);
    p.hOut = sp2.left.p1;
    q.hIn = sp2.right.p2;
    a.splice(i + 1, 0, { x: sp2.mid.x, y: sp2.mid.y, hIn: sp2.left.p2, hOut: sp2.right.p1, smooth: false });
    S.selectedAnchor = i + 1;
    clampAnchorHandles(i); clampAnchorHandles(i + 1); clampAnchorHandles(i + 2);
    status(TR("已添加关键帧点和操纵杆（共 " + a.length + " 个）", "Added a keyframe point with levers (" + a.length + " total)"));
    saveState(); redraw();
  }
  function deleteAnchor() {
    var a = S.anchors, i = S.selectedAnchor | 0;
    if (i <= 0 || i >= a.length - 1) { st("首尾关键帧点不能删除，请选中中间的点", "The first/last point cannot be deleted; select a middle point"); redraw(); return; }
    if (a.length > 3) {
      a.splice(i, 1);
      S.selectedAnchor = Math.max(1, Math.min(a.length - 1, i));
      clampAllAnchors();
      // 1.0.12: live write keeps the timeline in step when a point is deleted, instead of waiting
      // for the next drag. The write is its own undo step unless a drag already opened one.
      if (S.realtime) {
        var wasLive = liveGroupOpen, opened = false;
        try {
          if (!wasLive) { app.beginUndoGroup("KCurve: Delete Keyframe"); opened = true; }
          applyMultiCurve(true);
        } catch (e) {}
        if (opened) { try { app.endUndoGroup(); } catch (e2) {} liveGroupOpen = false; }
      }
      status(TR("已删除关键帧点（剩余 " + a.length + " 个）", "Deleted keyframe point (" + a.length + " left)"));
      saveState(); redraw();
      return;
    }
    // 3 points -> back to single-segment ease mode. The two inner handles came from a t=0.5
    // de Casteljau split; doubling their offset from the endpoints recovers the original cubic.
    var p0 = a[0], p1 = a[2], dx = p1.x - p0.x;
    var ho = p0.hOut ? { x: p0.hOut.x, y: p0.hOut.y } : { x: p0.x + dx / 3, y: p0.y };
    var hi = p1.hIn ? { x: p1.hIn.x, y: p1.hIn.y } : { x: p1.x - dx / 3, y: p1.y };
    ho = { x: 2 * ho.x - p0.x, y: 2 * ho.y - p0.y };
    hi = { x: 2 * hi.x - p1.x, y: 2 * hi.y - p1.y };
    S.anchors = [
      { x: 0, y: p0.y, hIn: null, hOut: ho, smooth: false },
      { x: 1, y: p1.y, hIn: hi, hOut: null, smooth: false }
    ];
    clampAllAnchors();
    S.selectedAnchor = 0;
    // 1.0.12: back in single-segment mode the two endpoints are the whole curve, so with live
    // write on the middle keyframes are removed and the recovered easing is written at once.
    if (S.realtime) {
      var opened2 = false;
      try { app.beginUndoGroup("KCurve: Delete Keyframe"); opened2 = true; } catch (e) {}
      try { pruneRangeMiddleKeys(); } catch (e) {}
      try { applyCurrent(true); } catch (e) {}
      if (opened2) { try { app.endUndoGroup(); } catch (e) {} }
    }
    st("已回到单段缓动模式", "Back to single-segment easing mode");
    saveState(); redraw();
  }
  function toggleSmooth() {
    if (!isMulti()) { st("平滑/折断只在多点模式使用；单段模式请拖拉杆", "Smooth/Break is only for multi-point mode; drag the levers in single-segment mode"); redraw(); return; }
    var a = S.anchors, i = S.selectedAnchor | 0;
    if (i <= 0 || i >= a.length - 1) { st("首尾点没有相邻段，不能设置平滑/折断", "The first/last point has no adjacent segment to smooth or break"); redraw(); return; }
    var p = a[i];
    p.smooth = p.smooth === false;
    if (p.smooth) {
      ensureMultiHandles(a);
      var dx = 0, dy = 0;
      if (p.hOut) { dx = p.hOut.x - p.x; dy = p.hOut.y - p.y; }
      else if (p.hIn) { dx = p.x - p.hIn.x; dy = p.y - p.hIn.y; }
      var len = Math.sqrt(dx * dx + dy * dy) || 0.15;
      dx /= len; dy /= len;
      if (!dx && !dy) { dx = 0.15; dy = 0; }
      var lenIn = p.hIn ? dist(p.hIn, p) : 0.15;
      var lenOut = p.hOut ? dist(p.hOut, p) : 0.15;
      p.hIn = { x: p.x - dx * lenIn, y: p.y - dy * lenIn };
      p.hOut = { x: p.x + dx * lenOut, y: p.y + dy * lenOut };
      clampAnchorHandles(i);
    }
    st(p.smooth ? "该关键帧点已设为平滑（操纵杆对齐）" : "该关键帧点已设为折断（左右独立）",
      p.smooth ? "Point set to smooth (levers aligned)" : "Point set to broken (independent levers)");
    saveState(); redraw();
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  // ---------------------------------------------------------------- keyframe easing
  var BER = BEZIER;
  function layerOf(p) { return p.propertyGroup(p.propertyDepth); }
  function pathLength(a, outTangent, inTangent, b) {
    var p = [], nDims = Math.max(a.length, b.length), len = 0, prev = null, d, s, e, f;
    for (d = 0; d < nDims; d++) p.push([a[d] || 0, (a[d] || 0) + (outTangent[d] || 0), (b[d] || 0) + (inTangent[d] || 0), b[d] || 0]);
    for (s = 0; s <= 128; s++) {
      var t = s / 128, u = 1 - t, pt = [];
      for (e = 0; e < nDims; e++) pt.push(u * u * u * p[e][0] + 3 * u * u * t * p[e][1] + 3 * u * t * t * p[e][2] + t * t * t * p[e][3]);
      if (prev) {
        var sq = 0;
        for (f = 0; f < nDims; f++) sq += (pt[f] - prev[f]) * (pt[f] - prev[f]);
        len += Math.sqrt(sq);
      }
      prev = pt;
    }
    return len;
  }
  function slopes(p, a) {
    var stretch = Number(layerOf(p).stretch) || 100;
    var dur = (p.keyTime(a + 1) - p.keyTime(a)) * 100 / stretch;
    if (!(dur > 0) || !isFinite(dur)) return null;
    var cnt = Math.max(1, p.keyOutTemporalEase(a).length);
    var v0 = p.keyValue(a), v1 = p.keyValue(a + 1), out = [], i;
    var vt = p.propertyValueType;
    var spatial = (typeof PropertyValueType !== "undefined" &&
      (vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL));
    if (spatial && typeof p.keyOutSpatialTangent === "function") {
      var speed = pathLength(v0, p.keyOutSpatialTangent(a), p.keyInSpatialTangent(a + 1), v1) / dur;
      for (i = 0; i < cnt; i++) out.push(speed);
    } else if (typeof v0 === "number" && typeof v1 === "number") {
      out.push((v1 - v0) / dur);
    } else if (v0 instanceof Array && v1 instanceof Array && v0.length === v1.length) {
      for (i = 0; i < cnt; i++) out.push(((v1[i] || 0) - (v0[i] || 0)) / dur);
    } else {
      for (i = 0; i < cnt; i++) out.push(1 / dur);
    }
    return out;
  }
  function selectedKeyed() {
    var comp = app.project.activeItem, out = [], i;
    if (!(comp instanceof CompItem)) return out;
    var props = comp.selectedProperties || [];
    for (i = 0; i < props.length; i++) {
      var p = props[i];
      if (typeof PropertyType !== "undefined" && p.propertyType !== PropertyType.PROPERTY) continue;
      if (p.numKeys < 2) continue;
      try { if (typeof p.isInterpolationTypeValid === "function" && !p.isInterpolationTypeValid(BER)) continue; } catch (e) {}
      var keys = [];
      var sel = p.selectedKeys || [];
      for (var j = 0; j < sel.length; j++) keys.push(sel[j]);
      keys.sort(function (x, y) { return x - y; });
      if (keys.length) out.push({ prop: p, keys: keys });
    }
    return out;
  }
  function selectionCount() {
    var k = selectedKeyed(), total = 0, i;
    for (i = 0; i < k.length; i++) total += k[i].keys.length;
    return { props: k.length, keys: total };
  }
  function readPairCurve(p, a) {
    try {
      if (p.keyOutInterpolationType(a) === HOLD) return null;
      if (p.keyInInterpolationType(a + 1) === HOLD) return null;
      var s = slopes(p, a);
      if (!s) return null;
      var d = 0, i;
      for (i = 1; i < s.length; i++) if (Math.abs(s[i]) > Math.abs(s[d])) d = i;
      if (Math.abs(s[d]) < 1e-9) return null;
      var o = p.keyOutTemporalEase(a), q = p.keyInTemporalEase(a + 1);
      var oe = o[d] || o[0], qe = q[d] || q[0];
      if (!oe || !qe) return null;
      var x1 = clamp(Number(oe.influence) / 100, 0.001, 1);
      var y1 = (Number(oe.speed) / s[d]) * x1;
      var inInf = clamp(Number(qe.influence), 0.1, 100) / 100;   // fraction of the segment
      var x2 = 1 - inInf;
      var y2 = 1 - (Number(qe.speed) / s[d]) * inInf;
      if (!finite(x1) || !finite(y1) || !finite(x2) || !finite(y2)) return null;
      return { x1: x1, y1: clamp(y1, -2, 3), x2: x2, y2: clamp(y2, -2, 3) };
    } catch (e) { return null; }
  }
  function captureCurve() {
    var keyed = selectedKeyed(), list = [], i, j, k;
    for (i = 0; i < keyed.length; i++) {
      var p = keyed[i].prop, keys = keyed[i].keys;
      for (j = 0; j + 1 < keys.length; j++) {
        if (keys[j + 1] !== keys[j] + 1) continue;
        var c = readPairCurve(p, keys[j]);
        if (c) list.push(c);
      }
    }
    if (!list.length) return null;
    var sum = { x1: 0, y1: 0, x2: 0, y2: 0 };
    for (k = 0; k < list.length; k++) {
      sum.x1 += list[k].x1; sum.y1 += list[k].y1; sum.x2 += list[k].x2; sum.y2 += list[k].y2;
    }
    var cnt = list.length;
    return { x1: sum.x1 / cnt, y1: sum.y1 / cnt, x2: sum.x2 / cnt, y2: sum.y2 / cnt, count: cnt };
  }

  function easeSide(p, k, out, eases) {
    var inType = p.keyInInterpolationType(k), outType = p.keyOutInterpolationType(k);
    var inEase = p.keyInTemporalEase(k), outEase = p.keyOutTemporalEase(k);
    try { if (typeof p.keyTemporalContinuous === "function" && p.keyTemporalContinuous(k)) p.setTemporalContinuousAtKey(k, false); } catch (e) {}
    try { if (typeof p.setTemporalAutoBezierAtKey === "function") p.setTemporalAutoBezierAtKey(k, false); } catch (e) {}
    if (out) {
      p.setTemporalEaseAtKey(k, inEase, eases);
      p.setInterpolationTypeAtKey(k, inType, BEZIER);
    } else {
      p.setTemporalEaseAtKey(k, eases, outEase);
      p.setInterpolationTypeAtKey(k, BEZIER, outType);
    }
  }
  function makeEases(s, relSpeed, influence) {
    var out = [];
    var rel = finite(relSpeed) ? clamp(relSpeed, -1000000, 1000000) : 0;
    var inf = clamp(finite(influence) ? influence : 33.333, 0.1, 100);
    for (var d = 0; d < s.length; d++) {
      var speed = rel * s[d];
      if (!isFinite(speed)) speed = 0;
      out.push(new KeyframeEase(speed, inf));
    }
    return out;
  }
  function buildActions(mode) {
    var segs = segmentsOf(S.anchors), keyed = selectedKeyed(), actions = [], skipped = 0, roving = 0, pairs = 0, i, j, k;
    var doIn = mode !== "out", doOut = mode !== "in";
    for (i = 0; i < keyed.length; i++) {
      var p = keyed[i].prop, keys = keyed[i].keys, used = {}, pairIndex = 0;
      for (j = 0; j + 1 < keys.length; j++) {
        if (keys[j + 1] !== keys[j] + 1) continue;
        var seg = segs[Math.min(pairIndex, segs.length - 1)];
        if (doOut) addSide(actions, p, keys[j], true, seg);
        if (doIn) addSide(actions, p, keys[j + 1], false, seg);
        used[keys[j]] = true; used[keys[j + 1]] = true;
        pairIndex++;
        pairs++;
      }
      for (k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (used[key]) continue;
        if (doOut && key < p.numKeys) addSide(actions, p, key, true, segs[0]);
        if (doIn && key > 1) addSide(actions, p, key, false, segs[segs.length - 1]);
      }
    }
    return { actions: actions, skipped: skipped, roving: roving, pairs: pairs };

    function addSide(list, p, k, out, seg) {
      try {
        if (typeof p.keyRoving === "function" && p.keyRoving(k)) { roving++; return; }
        var type = out ? p.keyOutInterpolationType(k) : p.keyInInterpolationType(k);
        if (type === HOLD) { skipped++; return; }
        var a = out ? k : k - 1;
        var s = slopes(p, a);
        if (!s) return;
        var influence, rel;
        if (out) {
          // cubic-bezier x1 = 0 is not representable (influence 0 is rejected); use the closest
          // value and the exact slope y1/x1' so the curve stays as close as possible. x1 = 1 is
          // fine (influence 100).
          var ex1 = clamp(seg.x1, 0.001, 1);
          influence = ex1 * 100;
          rel = seg.y1 / ex1;
        } else {
          // x2 = 1 would need influence 0; clamp that end only. x2 = 0 is fine (influence 100).
          var ex2 = clamp(seg.x2, 0, 0.999);
          influence = (1 - ex2) * 100;
          rel = (1 - seg.y2) / (1 - ex2);
        }
        if (!isFinite(rel)) rel = 0;
        rel = clamp(rel, -1000000, 1000000);
        var eases = makeEases(s, rel, influence);
        if (!eases.length) return;
        list.push({ p: p, k: k, out: !!out, eases: eases });
      } catch (e) {}
    }
  }
  var liveGroupOpen = false;
  var lastLiveMs = 0;
  function writeActions(actions) {
    var n = 0, i;
    for (i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || !a.p) continue;
      try { easeSide(a.p, a.k, a.out, a.eases); n++; } catch (e) {}
    }
    return n;
  }
  function valueSpan(v0, v1) {
    if (typeof v0 === "number" && typeof v1 === "number") return Math.abs(v1 - v0);
    if (v0 instanceof Array && v1 instanceof Array) {
      var m = 0;
      for (var i = 0; i < Math.min(v0.length, v1.length); i++) m = Math.max(m, Math.abs((v1[i] || 0) - (v0[i] || 0)));
      return m;
    }
    return 0;
  }
  function lerpValue(v0, v1, y) {
    if (typeof v0 === "number" && typeof v1 === "number") return v0 + (v1 - v0) * y;
    if (v0 instanceof Array && v1 instanceof Array) {
      var out = [];
      for (var i = 0; i < v0.length; i++) out.push((v0[i] || 0) + ((v1[i] || 0) - (v0[i] || 0)) * y);
      return out;
    }
    return v0;
  }
  function findKeyIndexAt(p, t, tol) {
    for (var i = 1; i <= p.numKeys; i++) if (Math.abs(p.keyTime(i) - t) <= tol) return i;
    return -1;
  }
  // Multi-point writes rebuild keyframes (remove + add), and the timeline drops its selection when
  // that happens. A script cannot assign Property.selectedKeys (read-only in 0.17.0), so the
  // selection is put back with the engine command keys.select. Keys are addressed by layer id
  // (layer.__id) plus property uid (property.__uid) with the comp time base, because keyTime()
  // returns comp seconds in this host. Builds without those ids simply skip the restore.
  function sameValue(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
    if (a instanceof Array && b instanceof Array && a.length === b.length) {
      for (var i = 0; i < a.length; i++) if (Math.abs((a[i] || 0) - (b[i] || 0)) > 1e-9) return false;
      return true;
    }
    return false;
  }
  function selectionMatches(p, idxs) {
    var sel = p.selectedKeys || [];
    if (sel.length !== idxs.length) return false;
    for (var i = 0; i < sel.length; i++) if (sel[i] !== idxs[i]) return false;
    return true;
  }
  // entries: [{ p: Property, idxs: [key index…] }] — leaves exactly those keys selected.
  function selectKeyIndices(entries) {
    var keys = [], i, j;
    for (i = 0; i < entries.length; i++) {
      var p = entries[i].p, layer = null;
      try { layer = p.propertyGroup(p.propertyDepth); } catch (e) {}
      if (!layer || layer.__id === undefined || p.__uid === undefined) continue;
      for (j = 0; j < entries[i].idxs.length; j++) {
        var k = entries[i].idxs[j];
        if (k >= 1 && k <= p.numKeys) keys.push({ layer: layer.__id, prop: p.__uid, time: p.keyTime(k) });
      }
    }
    if (!keys.length) return false;
    try { app.run("keys.select", { keys: keys, timeBase: "comp" }); return true; } catch (e) { return false; }
  }
  // 1.0.12: with live write on, the keys between the first and last selected key belong to the
  // editor. Going from a multi-point curve back to a single segment used to leave the middle
  // keyframe behind; this drops every key strictly inside the range and keeps the two endpoints
  // selected so the next live write still has a range.
  function pruneRangeMiddleKeys() {
    var keyed = selectedKeyed(), comp = app.project.activeItem, fd, ranges = [], i, k;
    if (!keyed.length) return 0;
    fd = comp && comp.frameDuration ? comp.frameDuration : 1 / 30;
    for (i = 0; i < keyed.length; i++) {
      var p = keyed[i].prop, keys = keyed[i].keys;
      if (keys.length < 2) continue;
      var t0 = p.keyTime(keys[0]), t1 = p.keyTime(keys[keys.length - 1]);
      if (!(t1 > t0)) continue;
      ranges.push({ p: p, t0: t0, t1: t1 });
      for (k = p.numKeys; k >= 1; k--) {
        var kt = p.keyTime(k);
        if (kt > t0 + fd * 0.51 && kt < t1 - fd * 0.51) { try { p.removeKey(k); } catch (e) {} }
      }
    }
    var entries = [];
    for (i = 0; i < ranges.length; i++) {
      var idx0 = findKeyIndexAt(ranges[i].p, ranges[i].t0, fd * 0.51);
      var idx1 = findKeyIndexAt(ranges[i].p, ranges[i].t1, fd * 0.51);
      if (idx0 > 0 && idx1 > idx0) entries.push({ p: ranges[i].p, idxs: [idx0, idx1] });
    }
    if (entries.length) { try { selectKeyIndices(entries); } catch (e) {} }
    return ranges.length;
  }
  // Multi-point apply: the points are keyframes between the first and last SELECTED keys.
  // Every point gets a key at a proportionally spaced time; missing keys are added, existing keys
  // updated. The Hermite derivatives then become the Bezier eases of each segment.
  // live=true is the 实时写入 drag path: the undo group stays open for the whole drag and the status
  // line is left alone. The selection is restored either way, so applying never drops it.
  function applyMultiCurve(live) {
    var keyed = selectedKeyed();
    if (!keyed.length) {
      if (!live) {
        st("先选中至少两个关键帧（多点写入用首尾键作为范围）", "Select at least two keyframes (first/last define the range)");
        redraw();
      }
      return 0;
    }
    var pts = S.anchors;
    var comp = app.project.activeItem;
    var fd = comp && comp.frameDuration ? comp.frameDuration : 1 / 30;
    var tol = fd * 0.3;
    var added = 0, updated = 0, removed = 0, props = 0, skipped = 0, extras = 0, i, j, k;
    var keep = [], opened = false;
    if (!liveGroupOpen) { app.beginUndoGroup("KCurve: Write Keyframes"); opened = true; }
    if (live) liveGroupOpen = true;
    try {
      for (i = 0; i < keyed.length; i++) {
        var p = keyed[i].prop, keys = keyed[i].keys;
        if (keys.length < 2) { skipped++; keep.push({ p: p, idxs: keys }); continue; }
        var t0 = p.keyTime(keys[0]), t1 = p.keyTime(keys[keys.length - 1]);
        if (!(t1 > t0)) { skipped++; keep.push({ p: p, idxs: keys }); continue; }
        var v0 = p.keyValue(keys[0]), v1 = p.keyValue(keys[keys.length - 1]);
        if (valueSpan(v0, v1) < 1e-9) { skipped++; keep.push({ p: p, idxs: keys }); continue; }
        var selectedSet = {};
        for (k = 0; k < keys.length; k++) selectedSet[keys[k]] = true;
        for (k = 1; k <= p.numKeys; k++) {
          var kt = p.keyTime(k);
          if (kt > t0 + fd * 0.51 && kt < t1 - fd * 0.51 && !selectedSet[k]) extras++;
        }
        var times = [], vals = [];
        for (j = 0; j < pts.length; j++) {
          var tt = t0 + pts[j].x * (t1 - t0);
          tt = Math.round(tt / fd) * fd;
          var vv = lerpValue(v0, v1, pts[j].y);
          if (times.length && Math.abs(tt - times[times.length - 1]) < fd * 0.01) {
            vals[vals.length - 1] = vv;
          } else {
            times.push(tt); vals.push(vv);
          }
        }
        // Fast path: the timeline already holds exactly these keys, so only the values (and the
        // eases below) change. Keeping the keys in place keeps the timeline selection and makes a
        // live drag cheap — removing and re-adding every key on each mouse move made the timeline
        // flicker and lose the selection that this function then had to restore.
        var idxs = [], matched = true;
        for (j = 0; j < times.length; j++) {
          var ix = findKeyIndexAt(p, times[j], tol);
          if (ix < 0) { matched = false; break; }
          idxs.push(ix);
        }
        if (matched) {
          var inRange = 0;
          for (k = 1; k <= p.numKeys; k++) {
            var rt = p.keyTime(k);
            if (rt >= t0 - tol && rt <= t1 + tol) inRange++;
          }
          if (inRange !== times.length) matched = false;
        }
        if (matched) {
          for (j = 0; j < times.length; j++) {
            if (!sameValue(p.keyValue(idxs[j]), vals[j])) {
              p.setValueAtTime(p.keyTime(idxs[j]), vals[j]);
              updated++;
            }
          }
        } else {
          // Each point is a keyframe: replace the selected keys instead of leaving the old ones
          // behind (otherwise moving a point in time would duplicate the key). Keys in the range
          // that were not selected are left alone; status reports them.
          if (typeof p.removeKey === "function") {
            for (k = keys.length - 1; k >= 0; k--) {
              try { p.removeKey(keys[k]); removed++; } catch (e) {}
            }
          }
          // 1.0.12/1.0.13: while realtime write is on (continuous or on release) the editor owns
          // the whole first..last range: keys that are no longer one of the curve points go too,
          // even when they were not selected — a deleted point used to leave its keyframe behind.
          if (S.realtime) {
            for (k = p.numKeys; k >= 1; k--) {
              var rkt = p.keyTime(k);
              if (rkt <= t0 + fd * 0.51 || rkt >= t1 - fd * 0.51) continue;
              var isPoint = false;
              for (var q = 0; q < times.length; q++) {
                if (Math.abs(rkt - times[q]) <= tol) { isPoint = true; break; }
              }
              if (!isPoint) { try { p.removeKey(k); removed++; } catch (e) {} }
            }
          }
          for (j = 0; j < times.length; j++) {
            var existed = findKeyIndexAt(p, times[j], tol) > 0;
            p.setValueAtTime(times[j], vals[j]);
            if (existed) updated++; else added++;
          }
          // Resolve the key indices after insertion and turn each segment's handles into eases.
          idxs = [];
          for (j = 0; j < times.length; j++) idxs.push(findKeyIndexAt(p, times[j], fd * 0.51));
        }
        for (j = 0; j + 1 < idxs.length; j++) {
          var a = idxs[j], b = idxs[j + 1];
          if (a < 1 || b < 1 || b <= a) { continue; }
          var pi = pts[j], qi = pts[j + 1];
          var dx = qi.x - pi.x, dy = qi.y - pi.y;
          if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) continue;
          var ho = pi.hOut || { x: pi.x + dx / 3, y: pi.y + dy / 3 };
          var hi = qi.hIn || { x: qi.x - dx / 3, y: qi.y - dy / 3 };
          var sx1 = (ho.x - pi.x) / dx, cy1 = (ho.y - pi.y) / dy;
          var sx2 = (hi.x - pi.x) / dx, cy2 = (hi.y - pi.y) / dy;
          var ex1 = clamp(sx1, 0.001, 1);
          var ex2 = clamp(sx2, 0, 0.999);
          var s = slopes(p, a);
          if (!s) continue;
          easeSide(p, a, true, makeEases(s, cy1 / ex1, ex1 * 100));
          easeSide(p, b, false, makeEases(s, (1 - cy2) / (1 - ex2), (1 - ex2) * 100));
        }
        keep.push({ p: p, idxs: idxs });
        props++;
      }
    } finally {
      if (opened && !live) { try { app.endUndoGroup(); } catch (e) {} }
      // Put the timeline selection back even if something above threw: applying the curve must not
      // leave the user with nothing selected.
      try {
        var needSelect = false;
        for (i = 0; i < keep.length; i++) {
          if (!selectionMatches(keep[i].p, keep[i].idxs)) { needSelect = true; break; }
        }
        if (needSelect) selectKeyIndices(keep);
      } catch (e) {}
    }
    if (live) return added + updated;
    var msg = en()
      ? "Wrote multi-point curve: " + (props ? props + " propert" + (props === 1 ? "y" : "ies") : "0 properties") +
        (removed ? ", replaced " + removed + " selected keys" : "") +
        (added || updated ? " (added " + added + " / updated " + updated + ")" : "") +
        (extras ? "; " + extras + " unselected keys in the range were left alone" : "") +
        (skipped ? "; skipped " + skipped + " properties without a range/value change" : "")
      : "已写入多点曲线：" + (props ? props + " 条属性" : "0 条属性") +
        (removed ? "，替换 " + removed + " 个选中键" : "") +
        (added || updated ? "（新增 " + added + " / 更新 " + updated + "）" : "") +
        (extras ? "；范围内另有 " + extras + " 个未选中键未改动" : "") +
        (skipped ? "；跳过 " + skipped + " 条无范围/无值差属性" : "");
    status(msg);
    redraw();
    return added + updated;
  }
  function applyCurrent(silent) {
    if (isMulti()) return applyMultiCurve();
    var built = buildActions(S.applyMode || "inout");
    if (!built.actions.length) {
      if (!silent) {
        var why = [];
        if (built.skipped) why.push(TR("跳过 Hold " + built.skipped, "skipped Hold " + built.skipped));
        if (built.roving) why.push(TR("跳过 Roving " + built.roving, "skipped Roving " + built.roving));
        status(why.length ? TR("没有写入：" + why.join("，"), "Nothing written: " + why.join(", ")) : "");
      }
      redraw();
      return 0;
    }
    var grouped = !liveGroupOpen;
    if (grouped) app.beginUndoGroup("KCurve: Apply Easing");
    var n = writeActions(built.actions);
    if (grouped) app.endUndoGroup();
    if (!silent) {
      var extra = [];
      if (built.pairs) extra.push(TR(built.pairs + " 组关键帧", built.pairs + " key pairs"));
      if (S.anchors.length > 2) extra.push(TR((S.anchors.length - 1) + " 段曲线", (S.anchors.length - 1) + " curve segments"));
      if (built.skipped) extra.push(TR("跳过 Hold " + built.skipped, "skipped Hold " + built.skipped));
      if (built.roving) extra.push(TR("跳过 Roving " + built.roving, "skipped Roving " + built.roving));
      status(TR("已应用 " + n + " 个缓动侧" + (extra.length ? "（" + extra.join("，") + "）" : ""),
        "Applied " + n + " easing side" + (n === 1 ? "" : "s") + (extra.length ? " (" + extra.join(", ") + ")" : "")));
    }
    redraw();
    return n;
  }
  function applyLive(force) {
    // 1.0.13: "write on release" mode keeps the drag as a preview only; the timeline is written
    // once in canvasMouseUp when the pointer is released.
    if (S.writeOnRelease) return;
    if (isMulti()) {
      // Multi-point writes real keyframes (not just eases), so throttle the writes to roughly the
      // canvas repaint cadence; mouseup forces a final exact write while the undo group is open.
      var t = nowMs();
      if (!force && t - lastLiveMs < 80) return;
      lastLiveMs = t;
      try { applyMultiCurve(true); } catch (e) {}
      return;
    }
    var built = buildActions(S.applyMode || "inout");
    if (!built.actions.length) return;
    if (!liveGroupOpen) {
      app.beginUndoGroup("KCurve: Apply Easing");
      liveGroupOpen = true;
    }
    writeActions(built.actions);
  }
  function endLiveGroup() {
    if (liveGroupOpen) {
      try { app.endUndoGroup(); } catch (e) {}
      liveGroupOpen = false;
    }
  }

  // ---------------------------------------------------------------- theme / state
  function defaultState() {
    return {
      version: STATE_VERSION,
      anchors: defaultAnchors(),
      allowOvershoot: false,
      realtime: false,
      writeOnRelease: false,
      applyMode: "inout",
      showAllGroups: false,
      collapsed: {},
      size: [DEFAULT_W, DEFAULT_H],
      userGroups: [{ id: "g_user", name: "我的预设", presets: [] }],
      groupOrder: [],
      selectedGroupId: "",
      language: "zh",
      scroll: 0
    };
  }
  var S = null;
  var presetLayoutCache = null;
  var EN = {
    "缓动曲线": "Easing Curve",
    "选择关键帧 · 拖曲线 · 点 √ 写入": "Select keys · Drag curve · Click √ to write",
    "预设库": "Presets",
    "保存": "Save",
    "这个组还没有预设 · 点“保存”": "No presets in this group · Click “Save”",
    "还没有预设 · 点“保存”": "No presets yet · Click “Save”",
    "我的预设": "My Presets",
    "经典": "Classic",
    "新组": "New Group",
    "取消": "Cancel",
    "确定": "OK",
    "删除": "Delete",
    "预设名称": "Preset name",
    "保存到组": "Save to group",
    "新建组名": "New group name",
    "填写后会新建这个组；留空则使用上方所选组": "Creates this group; leave empty to use the selected group",
    "保存预设": "Save Preset",
    "重命名预设": "Rename Preset",
    "删除预设": "Delete Preset",
    "新建预设组": "New Preset Group",
    "重命名预设组": "Rename Preset Group",
    "删除预设组": "Delete Preset Group",
    "组名称": "Group name",
    "语言": "Language",
    "中文": "中文",
    "设置": "Settings",
    "实时写入模式": "Live write mode",
    "停止拖动后写入": "Write on release",
    "跟随软件": "Follow App Language",
    "导入选中关键帧为多点曲线": "Import selected keys as a multi-point curve",
    "导入选中关键帧的缓动曲线": "Import selected keys as an easing curve",
    "允许超出边界（链条断开）": "Allow overshoot (chain broken)",
    "限制在 0–1 内（链条连接）": "Keep within 0–1 (chain linked)",
    "实时写入：开": "Live write: On",
    "实时写入：关": "Live write: Off",
    "添加关键帧点": "Add a keyframe point",
    "删除当前关键帧点": "Delete the current keyframe point",
    "点击改成折断": "Click to make the levers independent",
    "点击改成平滑": "Click to align the levers",
    "只写入入侧": "Write the In side only",
    "只写入出侧": "Write the Out side only",
    "写入入侧和出侧": "Write both In and Out",
    "把点写成时间线关键帧": "Write the points as timeline keys",
    "写入选中关键帧缓动": "Write the selected keyframe easing",
    "加载到编辑器": "Load into editor",
    "加载并应用": "Load and apply",
    "内置预设只读": "Built-in presets are read-only",
    "复制到我的预设": "Copy to My Presets",
    "重命名…": "Rename…",
    "复制": "Duplicate",
    "用当前曲线更新该预设": "Update this preset with the current curve",
    "显示这个组": "Show this group",
    "新建组…": "New Group…",
    "重命名组…": "Rename Group…",
    "删除组": "Delete Group",
    "保存当前曲线为预设…": "Save Current Curve as Preset…",
    "新建预设组…": "New Preset Group…",
    "提示": "Hint",
    "更多操作在下方预设库": "More actions are in the Presets area below",
    "（空）": "(empty)"
  };
  function en() { return !!(S && S.language === "en"); }
  function T(s) { return en() ? (EN[s] || s) : s; }
  function TR(zh, eng) { return en() ? eng : zh; }
  function groupDisplayName(g) {
    if (!g) return "";
    // The built-in groups are migrated into editable user groups; keep translating their default
    // names, but respect a name the user gave them.
    if (g.id === "builtin_classic" && (g.name === "经典" || g.name === "Classic")) return en() ? "Classic" : "经典";
    if (g.id === "builtin_bounce" && (g.name === "弹跳" || g.name === "Bounce")) return en() ? "Bounce" : "弹跳";
    if (g.id === "g_user" && (g.name === "我的预设" || g.name === "My Presets")) return en() ? "My Presets" : "我的预设";
    return g.name;
  }
  var EN_PRESETS = {
    "强调 Emphasized": "Emphasized",
    "强调减速": "Emph Out",
    "强调加速": "Emph In",
    "标准 Standard": "Standard",
    "标准减速": "Std Out",
    "标准加速": "Std In",
    "弹性 Overshoot": "Overshoot"
  };
  function presetDisplayName(p) {
    if (!p) return "";
    return en() ? (EN_PRESETS[p.name] || p.name) : p.name;
  }

  function detectHostLanguage() {
    try {
      var l = String(app.run("prefs.get", { key: "general.language" }) || "");
      if (l === "en") return "en";
      if (l.indexOf("zh") === 0) return "zh";
      if (l === "system") {
        var loc = String($.locale || "").toLowerCase();
        if (loc.indexOf("zh") === 0) return "zh";
        if (loc) return "en";
      } else if (l) {
        return "en";
      }
    } catch (e) {}
    return "zh";
  }
  function loadState() {
    var st = defaultState(), loadedVersion = 0, hadLanguage = false;
    try {
      if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY)) {
        var raw = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_KEY);
        var o = JSON.parse(raw);
        if (o && o.version) {
          loadedVersion = Number(o.version) || 0;
          var a = sanitizeAnchors(o.anchors);
          if (a) st.anchors = a;
          if (o.allowOvershoot === true) st.allowOvershoot = true;
          if (o.realtime === true) st.realtime = true;
          if (o.writeOnRelease === true) st.writeOnRelease = true;
          if (o.applyMode === "in" || o.applyMode === "out" || o.applyMode === "inout") st.applyMode = o.applyMode;
          if (o.showAllGroups === true) st.showAllGroups = true;
          if (o.collapsed && typeof o.collapsed === "object") st.collapsed = o.collapsed;
          if (o.size instanceof Array && finite(o.size[0]) && finite(o.size[1])) {
            st.size = [clamp(o.size[0], MIN_W, 2000), clamp(o.size[1], MIN_H, 2000)];
          }
          if (o.userGroups instanceof Array && o.userGroups.length) {
            var groups = [];
            for (var i = 0; i < o.userGroups.length; i++) {
              var g = sanitizeGroup(o.userGroups[i]);
              if (g) groups.push(g);
            }
            if (groups.length) st.userGroups = groups;
          }
          if (o.groupOrder instanceof Array) st.groupOrder = o.groupOrder.slice();
          if (typeof o.selectedGroupId === "string") st.selectedGroupId = o.selectedGroupId;
          if (o.language === "en" || o.language === "zh") { st.language = o.language; hadLanguage = true; }
          st.scroll = n(o.scroll, 0);
        }
      }
    } catch (e) {}
    if (!hadLanguage) st.language = detectHostLanguage();
    if (!st.userGroups.length) st.userGroups = [{ id: "g_user", name: "我的预设", presets: [] }];
    // STATE_VERSION 3: the built-in preset groups moved into the editable user groups (one-time).
    // STATE_VERSION 4: the bounce group was added after that migration, so v3 states get it once.
    // STATE_VERSION 5: the demo bounce curves are replaced by copies of 我的预设.
    if (loadedVersion >= 3) st.builtinsMigrated = true;
    if (!st.builtinsMigrated) migrateBuiltins(st);
    else if (loadedVersion < 4) migrateBuiltinGroup(st, "builtin_bounce");
    if (loadedVersion < 5) migrateBounceFromUserGroups(st);
    S = st;
    ensureGroupOrder();
    if (!S.selectedGroupId || !groupById(S.selectedGroupId)) {
      var gs = allGroups();
      S.selectedGroupId = gs.length ? gs[0].id : "";
    }
    S.selectedAnchor = 0;
    if (S.anchors.length > 2) {
      // v1 multi points defaulted to smooth, which made the opposite lever swing while dragging;
      // v2 points are independent unless the user explicitly presses the smooth button.
      if (loadedVersion < 2) for (var mi = 0; mi < S.anchors.length; mi++) S.anchors[mi].smooth = false;
      ensureMultiHandles(S.anchors);
    }
    if (!S.allowOvershoot) clampAllAnchors();
  }
  function sanitizeGroup(g) {
    if (!g || typeof g.name !== "string") return null;
    var out = { id: typeof g.id === "string" ? g.id : makeId("g"), name: cleanName(g.name), presets: [] };
    if (!out.name) return null;
    if (g.presets instanceof Array) {
      for (var i = 0; i < g.presets.length; i++) {
        var p = g.presets[i];
        if (!p || typeof p.name !== "string") continue;
        var a = sanitizeAnchors(p.anchors);
        if (!a) continue;
        out.presets.push({ id: typeof p.id === "string" ? p.id : makeId("p"), name: cleanName(p.name), anchors: a, multi: a.length > 2 });
      }
    }
    return out;
  }
  function cleanName(s) {
    var v = String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, "");
    return v.length > 0 && v.length <= 48 ? v : "";
  }
  function makeId(prefix) {
    return prefix + "_" + (new Date().getTime()).toString(36) + "_" + Math.floor(Math.random() * 100000).toString(36);
  }
  // The built-in groups used to be read-only code data rebuilt on every launch. They are migrated
  // once into S.userGroups (keeping their ids and anchors) so every preset can be renamed,
  // deleted, duplicated or updated from the current curve. Runs after the settings are loaded,
  // when BUILTIN_GROUPS has been initialised.
  function cloneBuiltinGroup(bg) {
    var presets = [], j;
    for (j = 0; j < bg.presets.length; j++) {
      presets.push({
        id: bg.presets[j].id,
        name: bg.presets[j].name,
        anchors: cloneAnchors(bg.presets[j].anchors),
        multi: bg.presets[j].anchors.length > 2
      });
    }
    return { id: bg.id, name: bg.name, presets: presets };
  }
  function migrateBuiltins(st) {
    var existing = st.userGroups instanceof Array ? st.userGroups : [], byId = {}, i, out = [];
    for (i = 0; i < existing.length; i++) byId[existing[i].id] = existing[i];
    for (i = 0; i < BUILTIN_GROUPS.length; i++) {
      var bg = BUILTIN_GROUPS[i];
      if (byId[bg.id]) { out.push(byId[bg.id]); delete byId[bg.id]; continue; }
      if (!bg.presets.length) continue;   // empty template group (弹跳) is created by v5 instead
      out.push(cloneBuiltinGroup(bg));
    }
    for (i = 0; i < existing.length; i++) if (byId[existing[i].id]) out.push(existing[i]);
    st.userGroups = out.length ? out : [{ id: "g_user", name: "我的预设", presets: [] }];
    st.builtinsMigrated = true;
  }
  // A built-in group added after the one-time migration (state version 4) is appended once,
  // next to the other built-in groups, without touching the user's groups.
  function migrateBuiltinGroup(st, id) {
    var i;
    for (i = 0; i < st.userGroups.length; i++) if (st.userGroups[i].id === id) return;
    for (i = 0; i < BUILTIN_GROUPS.length; i++) {
      if (BUILTIN_GROUPS[i].id !== id) continue;
      if (!BUILTIN_GROUPS[i].presets.length) return;
      st.userGroups.push(cloneBuiltinGroup(BUILTIN_GROUPS[i]));
      var order = st.groupOrder instanceof Array ? st.groupOrder : [];
      if (order.indexOf(id) < 0) {
        var at = order.indexOf("builtin_classic");
        order.splice(at >= 0 ? at + 1 : order.length, 0, id);
        st.groupOrder = order;
      }
      return;
    }
  }
  // STATE_VERSION 5: the invented demo bounce presets are gone. The 弹跳 group instead receives
  // a one-time copy of the presets in 我的预设 (its own group is left alone).
  function migrateBounceFromUserGroups(st) {
    var user = null, bounce = null, i;
    for (i = 0; i < st.userGroups.length; i++) {
      if (st.userGroups[i].id === "g_user") user = st.userGroups[i];
      if (st.userGroups[i].id === "builtin_bounce") bounce = st.userGroups[i];
    }
    if (!bounce) {
      if (!user || !user.presets.length) return;
      bounce = { id: "builtin_bounce", name: "弹跳", presets: [] };
      var at = -1;
      for (i = 0; i < st.userGroups.length; i++) if (st.userGroups[i].id === "builtin_classic") at = i;
      st.userGroups.splice(at >= 0 ? at + 1 : st.userGroups.length, 0, bounce);
      var order = st.groupOrder instanceof Array ? st.groupOrder : [];
      if (order.indexOf("builtin_bounce") < 0) {
        var oi = order.indexOf("builtin_classic");
        order.splice(oi >= 0 ? oi + 1 : order.length, 0, "builtin_bounce");
        st.groupOrder = order;
      }
    }
    var presets = [];
    if (user) {
      for (i = 0; i < user.presets.length; i++) {
        presets.push({
          id: makeId("p"),
          name: user.presets[i].name,
          anchors: cloneAnchors(user.presets[i].anchors),
          multi: user.presets[i].anchors.length > 2
        });
      }
    }
    bounce.presets = presets;
  }
  function saveState() {
    if (!S) return;
    try {
      var o = {
        version: STATE_VERSION,
        anchors: S.anchors,
        allowOvershoot: !!S.allowOvershoot,
        realtime: !!S.realtime,
        writeOnRelease: !!S.writeOnRelease,
        applyMode: S.applyMode,
        showAllGroups: !!S.showAllGroups,
        collapsed: S.collapsed,
        size: S.size,
        userGroups: S.userGroups,
        groupOrder: S.groupOrder,
        selectedGroupId: S.selectedGroupId,
        language: S.language,
        scroll: S.scroll | 0
      };
      app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  // ---------------------------------------------------------------- clamping / hit helpers
  function clampAllAnchors() {
    for (var i = 0; i < S.anchors.length; i++) clampAnchorHandles(i);
  }
  function clampHandlePoint(i, which) {
    var a = S.anchors[i], h = a[which];
    if (!h) return;
    if (S.allowOvershoot) {
      h.x = clamp(h.x, -0.4, 1.4); h.y = clamp(h.y, -1.2, 2.2);
    } else {
      h.x = clamp(h.x, 0, 1); h.y = clamp(h.y, 0, 1);
    }
  }
  // Clamp in x/y independently, but never let a lever collapse onto its point at a viewport
  // corner. A collapsed lever was invisible/unselectable and felt stuck at the border. If the
  // clamped point has essentially no length, nudge it a little towards the middle.
  function clampHandle(a, h, minX, maxX, minY, maxY) {
    if (!h) return;
    h.x = clamp(h.x, minX, maxX);
    h.y = clamp(h.y, minY, maxY);
    var dx = h.x - a.x, dy = h.y - a.y;
    if (dx * dx + dy * dy < 0.0004) {
      var midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
      h.x = clamp(a.x + (a.x < midX ? 0.03 : -0.03), minX, maxX);
      h.y = clamp(a.y + (a.y < midY ? 0.03 : -0.03), minY, maxY);
    }
  }
  function clampAnchorHandles(i) {
    var a = S.anchors[i];
    if (!a) return;
    if (!S.allowOvershoot) {
      a.y = clamp(a.y, 0, 1);
      clampHandle(a, a.hIn, 0, 1, 0, 1);
      clampHandle(a, a.hOut, 0, 1, 0, 1);
    } else {
      a.y = clamp(a.y, -1, 2);
      clampHandle(a, a.hIn, -0.4, 1.4, -1.2, 2.2);
      clampHandle(a, a.hOut, -0.4, 1.4, -1.2, 2.2);
    }
    if (i === 0) a.x = 0;
    else if (i === S.anchors.length - 1) a.x = 1;
    else a.x = clamp(a.x, S.anchors[i - 1].x + 0.003, S.anchors[i + 1].x - 0.003);
    if (!S.allowOvershoot) {
      clampHandle(a, a.hIn, 0, 1, 0, 1);
      clampHandle(a, a.hOut, 0, 1, 0, 1);
    } else {
      clampHandle(a, a.hIn, -0.4, 1.4, -1.2, 2.2);
      clampHandle(a, a.hOut, -0.4, 1.4, -1.2, 2.2);
    }
  }
  function pointInRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  // ---------------------------------------------------------------- module state (UI)
  var win = null, canvas = null, L = null, editorOpen = false;
  var hoverId = null, pressedId = null, drag = null;
  var statusText = "选择关键帧 · 拖曲线 · 点 √ 写入";
  var menu = null;
  var liveMode = false;
  var lastClick = { id: null, t: 0 };
  var draggedPreset = null;
  var draggedGroup = null;
  var embedded = false;
  var lastPaintMs = 0;
  var spinTask = null;


  function status(s) { statusText = String(s); redraw(true); }
  function st(zh, eng) { status(en() ? eng : zh); }
  function redraw(force) {
    if (!canvas) return;
    var t = nowMs();
    // A full custom-canvas repaint is expensive. Mouse-move previews can skip a frame; actions
    // and mouseup pass force=true so the final state is always painted.
    if (!force && t - lastPaintMs < 16) return;
    lastPaintMs = t;
    // notify("onDraw") runs the handler for the notify and then again for the host repaint, so a
    // single redraw costs two draw passes. Forcing the layout triggers the repaint and runs the
    // handler once (1.0.11, measured: 40 hovers -> 40 draws instead of 80). Keep notify as a
    // fallback for hosts without a layout object.
    try { (win || canvas.window).layout.layout(true); }
    catch (e) { try { canvas.notify("onDraw"); } catch (e2) {} }
  }
  function stopSpinTask() {
    if (spinTask === null) return;
    try { app.cancelTask(spinTask); } catch (e) {}
    spinTask = null;
  }
  function startSpinTask() {
    if (!win || spinTask !== null) return;
    try { spinTask = app.scheduleTask("KCurveSpinTick()", 80, true); } catch (e) { spinTask = null; }
  }
  var lastSpinSelection = -1;
  thisObj.KCurveSpinTick = function () {
    try {
      if (!win || !canvas) { stopSpinTask(); return; }
      // The gear's orbiting notch only animates while live write is on. Otherwise repaint only
      // when the timeline selection changed (the status line shows it), instead of rebuilding the
      // whole draw list 12.5 times a second for a panel that looks the same.
      if (S.realtime) { redraw(); return; }
      var sc = selectionCount();
      if (sc.keys !== lastSpinSelection) { lastSpinSelection = sc.keys; redraw(); }
    } catch (e) { stopSpinTask(); }
  };

  // ---------------------------------------------------------------- built-in presets
  function presetAnchors(x1, y1, x2, y2) { return anchorsFromSegment(x1, y1, x2, y2); }
  var BUILTIN_GROUPS = [
    {
      id: "builtin_m3", name: "Material 3", builtin: true, presets: [
        { id: "m3-emphasized", name: "强调 Emphasized", anchors: presetAnchors(0.2, 0, 0, 1) },
        { id: "m3-emph-dec", name: "强调减速", anchors: presetAnchors(0.05, 0.7, 0.1, 1) },
        { id: "m3-emph-acc", name: "强调加速", anchors: presetAnchors(0.3, 0, 0.8, 0.15) },
        { id: "m3-standard", name: "标准 Standard", anchors: presetAnchors(0.2, 0, 0, 1) },
        { id: "m3-decel", name: "标准减速", anchors: presetAnchors(0, 0, 0, 1) },
        { id: "m3-accel", name: "标准加速", anchors: presetAnchors(0.3, 0, 1, 1) },
        { id: "m3-spring", name: "弹性 Overshoot", anchors: presetAnchors(0.34, 1.56, 0.64, 1) }
      ]
    },
    {
      id: "builtin_classic", name: "经典", builtin: true, presets: [
        { id: "cl-easy", name: "Easy Ease", anchors: presetAnchors(0.33, 0, 0.67, 1) },
        { id: "cl-inout", name: "Ease In-Out", anchors: presetAnchors(0.42, 0, 0.58, 1) },
        { id: "cl-out", name: "Ease Out", anchors: presetAnchors(0, 0, 0.58, 1) },
        { id: "cl-in", name: "Ease In", anchors: presetAnchors(0.42, 0, 1, 1) },
        { id: "cl-expo-out", name: "Expo Out", anchors: presetAnchors(0.16, 1, 0.3, 1) },
        { id: "cl-expo-inout", name: "Expo In-Out", anchors: presetAnchors(0.87, 0, 0.13, 1) },
        { id: "cl-back-in", name: "Back In", anchors: presetAnchors(0.36, 0, 0.66, -0.56) },
        { id: "cl-linear", name: "Linear", anchors: presetAnchors(1 / 3, 1 / 3, 2 / 3, 2 / 3) }
      ]
    },
    {
      // The group itself is kept so 1.0.9 can fill it with copies of the user's 我的预设
      // (the invented demo curves were removed). An empty template is not migrated on a fresh
      // install; migrateBounceFromUserGroups() creates it when there is something to copy.
      id: "builtin_bounce", name: "弹跳", builtin: true, presets: []
    }
  ];
  function allGroups() {
    var byId = {}, i, all = [];
    // Before the one-time migration the built-ins come from code; afterwards they are ordinary
    // (editable) user groups.
    if (!S.builtinsMigrated) {
      for (i = 0; i < BUILTIN_GROUPS.length; i++) { byId[BUILTIN_GROUPS[i].id] = BUILTIN_GROUPS[i]; all.push(BUILTIN_GROUPS[i]); }
    }
    for (i = 0; i < S.userGroups.length; i++) { byId[S.userGroups[i].id] = S.userGroups[i]; all.push(S.userGroups[i]); }
    var out = [], seen = {}, order = S.groupOrder || [];
    for (i = 0; i < order.length; i++) {
      var id = order[i];
      if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = true; }
    }
    for (i = 0; i < all.length; i++) if (!seen[all[i].id]) out.push(all[i]);
    return out;
  }
  function presetLayoutKey(rect) {
    var groups = allGroups(), parts = [rect.x, rect.y, rect.w, rect.h, S.selectedGroupId, S.scroll | 0, S.language], i;
    for (i = 0; i < groups.length; i++) parts.push(groups[i].id + ":" + groups[i].name + ":" + groups[i].presets.length);
    return parts.join("|");
  }
  function ensureGroupOrder() {
    var all = S.builtinsMigrated ? S.userGroups : BUILTIN_GROUPS.concat(S.userGroups), known = {}, order = [], i;
    for (i = 0; i < all.length; i++) known[all[i].id] = true;
    if (S.groupOrder instanceof Array) {
      for (i = 0; i < S.groupOrder.length; i++) {
        if (known[S.groupOrder[i]] && order.indexOf(S.groupOrder[i]) < 0) order.push(S.groupOrder[i]);
      }
    }
    for (i = 0; i < all.length; i++) if (order.indexOf(all[i].id) < 0) order.push(all[i].id);
    S.groupOrder = order;
  }
  function groupById(id) {
    var g = allGroups();
    for (var i = 0; i < g.length; i++) if (g[i].id === id) return g[i];
    return null;
  }
  function findUserGroup(id) {
    for (var i = 0; i < S.userGroups.length; i++) if (S.userGroups[i].id === id) return S.userGroups[i];
    return null;
  }
  function isBuiltinGroup(g) { return !!g.builtin; }
  function groupCollapsed(g) { return !!S.collapsed[g.id]; }
  // EffectCraft 0.13's GUI does not run repeating app.scheduleTask callbacks (tested with a
  // docked panel and script.runTasks: "scripting is not available in this build"), so a real
  // frame timer is not available. The gear still advances by wall-clock time whenever the panel
  // repaints; group folding is instantaneous instead of getting stuck mid-animation.
  function groupAmount(g) { return groupCollapsed(g) ? 0 : 1; }
  function toggleGroup(g) {
    S.collapsed[g.id] = !S.collapsed[g.id];
    saveState();
    redraw();
  }
  function groupDropTarget(x, y) {
    var chips = L && L.presetLayout ? L.presetLayout.chips : [], i;
    for (i = 0; i < chips.length; i++) {
      var c = chips[i];
      if (y < c.y + c.h / 2) return c.group.id;
      if (y <= c.y + c.h && x < c.x + c.w / 2) return c.group.id;
    }
    return "__END__";
  }
  function applyGroupDrop(group, targetId) {
    if (!group || !targetId || targetId === group.id) return;
    ensureGroupOrder();
    var order = S.groupOrder.slice(), from = order.indexOf(group.id);
    if (from < 0) return;
    order.splice(from, 1);
    var to = targetId === "__END__" ? order.length : order.indexOf(targetId);
    if (to < 0) to = order.length;
    order.splice(to, 0, group.id);
    S.groupOrder = order;
  }

  // ---------------------------------------------------------------- layout
  function buildLayout(g, W, H) {
    var pad = 8;
    var editorH = clamp(Math.round(H * 0.36), 160, 280);
    var editor = { x: pad, y: pad, w: W - 2 * pad, h: editorH };
    var func = layoutFunction(g, editor.x, editor.y + editor.h + 6, editor.w);
    var presetY = func.y + func.h + 6;
    var presetH = H - presetY - pad;
    if (presetH < 118) {
      var shrink = 118 - presetH + 6;
      editor.h = Math.max(150, editor.h - shrink);
      func = layoutFunction(g, editor.x, editor.y + editor.h + 6, editor.w);
      presetY = func.y + func.h + 6;
      presetH = H - presetY - pad;
    }
    var preset = { x: pad, y: presetY, w: W - 2 * pad, h: Math.max(70, presetH) };
    var plKey = presetLayoutKey(preset);
    var pl;
    if (presetLayoutCache && presetLayoutCache.key === plKey) {
      pl = presetLayoutCache.pl;
    } else {
      pl = layoutPresets(g, preset);
      presetLayoutCache = { key: plKey, pl: pl };
    }
    var lay = {
      W: W, H: H, editor: editor, func: func, preset: preset,
      controls: [], handles: [], anchors: [], presetLayout: pl,
      resize: {
        e: { x: W - 6, y: 0, w: 6, h: H },
        s: { x: 0, y: H - 6, w: W, h: 6 },
        se: { x: W - 16, y: H - 16, w: 16, h: 16 }
      }
    };
    // Editor geometry + hits are appended by drawEditor (needs the view mapping).
    for (var i = 0; i < func.controls.length; i++) lay.controls.push(func.controls[i]);
    lay.editorCard = editor;
    return lay;
  }

  function measureControl(g, c) {
    var label = c.label || "";
    var tw = textWidth(g, label, c.type === "icon" ? 15 : 11.5, "REGULAR");
    switch (c.type) {
      case "switch": return Math.max(96, tw + 12 + 42 + 16);
      case "icon": return 34;
      case "button": return Math.max(70, tw + 26 + (c.disabled ? 0 : 0));
      case "toggle": return Math.max(62, tw + 24);
      default: return Math.max(70, tw + 24);
    }
  }
  // ---------------------------------------------------------------- toolbar layout
  // Two fixed rows: editing actions on top; language, live write and the write-side modes
  // (In / Out / Both) underneath. Fixed rows keep the tools from wrapping unpredictably.
  function layoutFunction(g, x, y, w) {
    var top = [
      { id: "icon:import", type: "tool", icon: "import" },
      { id: "icon:overshoot", type: "tool", icon: "overshoot", on: !!S.allowOvershoot },
      { id: "icon:add", type: "tool", icon: "plus" },
      { id: "icon:del", type: "tool", icon: "minus" }
    ];
    if (isMulti()) {
      top.push({
        id: "icon:smooth", type: "tool", icon: "smooth",
        active: !!(S.anchors[S.selectedAnchor] && S.anchors[S.selectedAnchor].smooth !== false)
      });
    }
    var apply = { id: "button:apply", type: "apply", icon: "check", w: 36, h: 30 };
    var lower = [
      { id: "icon:settings", type: "tool", icon: "hamburger" },
      { id: "icon:realtime", type: "tool", icon: "gear", on: !!S.realtime }
    ];
    // The write-side selector is always visible. In multi-point mode it is dimmed: applying a
    // multi-point curve writes both sides of every segment, so In/Out/Both do not apply there.
    var multiMode = isMulti();
    lower.push({ id: "mode:in", type: "mode", icon: "triLeft", active: !multiMode && S.applyMode === "in", disabled: multiMode });
    lower.push({ id: "mode:out", type: "mode", icon: "triRight", active: !multiMode && S.applyMode === "out", disabled: multiMode });
    lower.push({ id: "mode:inout", type: "mode", icon: "diamond", active: !multiMode && S.applyMode === "inout", disabled: multiMode });
    var gap = 3, rowH = 32, controls = [];
    function placeRow(list, startX, startY) {
      var cx = startX, cy = startY;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        c.w = c.type === "mode" ? 26 : (c.type === "apply" ? 36 : 28);
        c.h = c.type === "apply" ? 30 : (c.type === "mode" ? 26 : 28);
        c.x = cx;
        c.y = cy + (rowH - c.h) / 2;
        c.rect = { x: c.x, y: c.y, w: c.w, h: c.h };
        controls.push(c);
        cx += c.w + gap;
      }
      return { bottom: cy + rowH, right: cx };
    }
    var r1 = placeRow(top, x, y);
    // The confirm button takes every pixel left over in the top row; the check is centred in it.
    apply.x = r1.right;
    apply.y = y + (rowH - apply.h) / 2;
    apply.w = Math.max(36, (x + w) - apply.x);
    apply.iconX = apply.x + apply.w / 2;
    apply.rect = { x: apply.x, y: apply.y, w: apply.w, h: apply.h };
    controls.push(apply);
    placeRow(lower, x, r1.bottom + gap);
    var bottom = 0;
    for (var i = 0; i < controls.length; i++) bottom = Math.max(bottom, controls[i].y + controls[i].h);
    var statusY = bottom + 5;
    return {
      id: "func", x: x, y: y, w: w, h: statusY + 16 - y,
      controls: controls, apply: apply, statusY: statusY, statusH: 16
    };
  }

  function visibleGroups() {
    var all = allGroups();
    if (S.showAllGroups) return all;
    // Four built-in groups now fit on one chip row at the docked width; keep one slot for a
    // user-created group before the "all groups" toggle kicks in.
    return all.slice(0, 5);
  }

  function layoutPresets(g, rect) {
    var headerH = 28;
    var saveW = 64;
    var save = {
      id: "button:savePreset", type: "pill", label: T("保存"), accent: true,
      x: rect.x + rect.w - saveW, y: rect.y, w: saveW, h: 26,
      rect: { x: rect.x + rect.w - saveW, y: rect.y, w: saveW, h: 26 }
    };
    var newGroup = {
      id: "button:newGroup", type: "pillIcon", icon: "plus",
      x: save.x - 32, y: rect.y, w: 26, h: 26,
      rect: { x: save.x - 32, y: rect.y, w: 26, h: 26 }
    };
    var all = allGroups();
    var selected = null, i;
    for (i = 0; i < all.length; i++) if (all[i].id === S.selectedGroupId) { selected = all[i]; break; }
    if (!selected && all.length) { selected = all[0]; S.selectedGroupId = selected.id; }

    // Group chips: rounded rectangles whose width follows the label, wrapping horizontally.
    var chipH = 24, chipGap = 5, chipX = rect.x, chipY = rect.y + headerH + 3, chips = [];
    var chipRight = rect.x + rect.w;
    for (i = 0; i < all.length; i++) {
      var grp = all[i];
      var cw = Math.min(rect.w, Math.max(46, Math.round(visualWidth(groupDisplayName(grp), 10) + 20)));
      if (chipX > rect.x && chipX + cw > chipRight) { chipX = rect.x; chipY += chipH + chipGap; }
      chips.push({
        kind: "groupChip", group: grp,
        x: chipX, y: chipY, w: cw, h: chipH,
        rect: { x: chipX, y: chipY, w: cw, h: chipH }
      });
      chipX += cw + chipGap;
    }
    var chipsBottom = chips.length ? chipY + chipH : rect.y + headerH + 3;
    var list = { x: rect.x, y: chipsBottom + 5, w: rect.w, h: Math.max(46, rect.h - (chipsBottom - rect.y) - 5) };

    // Square preset previews, name underneath, wrapping into a grid for the selected group.
    var presets = selected ? selected.presets : [];
    var gridW = Math.max(40, list.w - 17);
    var cellW = 60, cellGap = 3;
    var cols = Math.max(1, Math.floor(gridW / (cellW + cellGap)));
    cellW = Math.floor(gridW / cols);
    var cellH = Math.max(58, cellW - 8);
    var rows = Math.max(1, Math.ceil(presets.length / cols));
    var contentH = presets.length ? rows * (cellH + 6) + 4 : 44;
    var maxScroll = Math.max(0, contentH - list.h);
    var scroll = clamp(S.scroll | 0, 0, maxScroll);
    S.scroll = scroll;
    var cells = [], j;
    if (presets.length) {
      for (j = 0; j < presets.length; j++) {
        var col = j % cols, row = Math.floor(j / cols);
        var cx = list.x + 4 + col * cellW;
        var cy = list.y - scroll + row * (cellH + 6) + 3;
        cells.push({
          group: selected, preset: presets[j],
          x: cx, y: cy, w: cellW - cellGap, h: cellH,
          rect: { x: cx, y: cy, w: cellW - cellGap, h: cellH }
        });
      }
    }
    var emptyRect = { x: list.x + 10, y: list.y + 8, w: list.w - 30, h: 28 };
    var scrollbar = null;
    if (maxScroll > 0) {
      var thumbH = Math.max(26, list.h * list.h / contentH);
      var thumbY = list.y + (list.h - thumbH) * (scroll / maxScroll);
      scrollbar = {
        x: list.x + list.w - 15, y: list.y + 2, w: 13, h: list.h - 4,
        thumbX: list.x + list.w - 12, thumbW: 7,
        thumbY: thumbY, thumbH: thumbH, maxScroll: maxScroll
      };
    }
    return {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h, headerH: headerH,
      save: save, newGroup: newGroup, chips: chips, selectedGroup: selected,
      list: list, cells: cells, emptyRect: emptyRect,
      contentH: contentH, maxScroll: maxScroll, scrollbar: scrollbar
    };
  }

  // ---------------------------------------------------------------- drawing: editor
  function viewBounds() {
    var anchors = S.anchors, minX = 0, maxX = 1, minY = 0, maxY = 1, i;
    if (S.allowOvershoot) {
      for (i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
        minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
        if (a.hIn) { minX = Math.min(minX, a.hIn.x); maxX = Math.max(maxX, a.hIn.x); minY = Math.min(minY, a.hIn.y); maxY = Math.max(maxY, a.hIn.y); }
        if (a.hOut) { minX = Math.min(minX, a.hOut.x); maxX = Math.max(maxX, a.hOut.x); minY = Math.min(minY, a.hOut.y); maxY = Math.max(maxY, a.hOut.y); }
      }
      var padX = Math.max(0.1, (maxX - minX) * 0.06), padY = Math.max(0.1, (maxY - minY) * 0.06);
      minX -= padX; maxX += padX; minY -= padY; maxY += padY;
      if (maxX - minX < 0.4) { var cx = (minX + maxX) / 2; minX = cx - 0.2; maxX = cx + 0.2; }
      if (maxY - minY < 0.4) { var cy = (minY + maxY) / 2; minY = cy - 0.2; maxY = cy + 0.2; }
    }
    return { x0: minX, x1: maxX, y0: minY, y1: maxY };
  }
  function curveSegmentsFor(a) {
    if (a.length > 2) return multiCurveSegments(a);
    var s = segmentOf(a, 0);
    return [{ x0: 0, y0: 0, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, x3: 1, y3: 1 }];
  }
  function strokeCurveSegments(g, segs, mx, my, pen) {
    // While a handle/anchor is dragged the curve is rebuilt on every repaint; 20 samples are still
    // smooth at this size and remove about a third of the path points (the final paint uses 32).
    var n = (drag && (drag.kind === "handle" || drag.kind === "anchor")) ? 20 : 32;
    for (var si = 0; si < segs.length; si++) {
      g.newPath();
      for (var tt = 0; tt <= n; tt++) {
        var pt = cubicPointAt(segs[si], tt / n);
        if (tt === 0) g.moveTo(mx(pt[0]), my(pt[1]));
        else g.lineTo(mx(pt[0]), my(pt[1]));
      }
      g.strokePath(pen);
    }
  }
  function drawEditor(g, lay) {
    var r = lay.editor, multi = isMulti();
    // 1.0.8: the editor is one dark rect with a one-pixel outline; the old thick card frame
    // (and its 10px border) is gone, so the curve gets the whole editor area.
    fillRect(g, r.x, r.y, r.w, r.h, P.bg);
    strokeRect(g, r.x + 0.5, r.y + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1), withAlpha(P.outline, 0.7), 1);
    var plot = { x: r.x + 1, y: r.y + 1, w: Math.max(1, r.w - 2), h: Math.max(1, r.h - 2) };
    var view = viewBounds();
    function mx(v) { return plot.x + (v - view.x0) / (view.x1 - view.x0) * plot.w; }
    function my(v) { return plot.y + plot.h - (v - view.y0) / (view.y1 - view.y0) * plot.h; }

    if (S.allowOvershoot) {
      var sx0 = mx(0), sy0 = my(1), sx1 = mx(1), sy1 = my(0);
      strokeRect(g, sx0, sy0, Math.max(1, sx1 - sx0), Math.max(1, sy1 - sy0), withAlpha(P.outline, 0.35), 1);
    }

    var segs = curveSegmentsFor(S.anchors);
    var glow = g.newPen(g.PenType.SOLID_COLOR, withAlpha(P.primary, 0.12), 6);
    strokeCurveSegments(g, segs, mx, my, glow);
    var curvePen = g.newPen(g.PenType.SOLID_COLOR, P.primary, 2.3);
    strokeCurveSegments(g, segs, mx, my, curvePen);

    var selected = clamp(S.selectedAnchor | 0, 0, S.anchors.length - 1);
    var handlesHit = [], anchorsHit = [], ai, a, hx, hy;
    for (ai = 0; ai < S.anchors.length; ai++) {
      // Multi mode shows levers only for the selected keyframe point, so the graph stays clean.
      if (multi && ai !== selected) continue;
      a = S.anchors[ai];
      if (a.hIn) {
        hx = mx(a.hIn.x); hy = my(a.hIn.y);
        line(g, mx(a.x), my(a.y), hx, hy, withAlpha(P.text, 0.8), 1.6);
        circle(g, hx, hy, 4.8, P.text, P.bg, 1.5);
        handlesHit.push({ kind: "handle", i: ai, side: "hIn", x: hx, y: hy, r: 11 });
      }
      if (a.hOut) {
        hx = mx(a.hOut.x); hy = my(a.hOut.y);
        line(g, mx(a.x), my(a.y), hx, hy, withAlpha(P.text, 0.8), 1.6);
        circle(g, hx, hy, 4.8, P.text, P.bg, 1.5);
        handlesHit.push({ kind: "handle", i: ai, side: "hOut", x: hx, y: hy, r: 11 });
      }
    }
    for (ai = 0; ai < S.anchors.length; ai++) {
      a = S.anchors[ai];
      var ax = mx(a.x), ay = my(a.y), isSel = ai === selected;
      if (isSel) circle(g, ax, ay, 9, null, withAlpha(P.primary, 0.45), 6);
      circle(g, ax, ay, isSel ? 6 : 4.6, isSel ? P.primary : P.text, null, 0);
      anchorsHit.push({ kind: "anchor", i: ai, x: ax, y: ay, r: 12 });
    }
    // Redraw handle dots above the selected point's ring; an edge-clamped lever can otherwise
    // disappear under the anchor circle even though it is still draggable.
    for (ai = 0; ai < handlesHit.length; ai++) {
      circle(g, handlesHit[ai].x, handlesHit[ai].y, 4.8, P.text, P.bg, 1.5);
    }
    lay.plot = { x: plot.x, y: plot.y, w: plot.w, h: plot.h, view: view, mx: mx, my: my };
    lay.handles = handlesHit;
    lay.anchors = anchorsHit;
  }

  // ---------------------------------------------------------------- drawing: tools
  function drawFunction(g, lay) {
    var f = lay.func, i;
    for (i = 0; i < f.controls.length; i++) {
      var c = f.controls[i];
      if (c.type === "apply") drawApply(g, c);
      else drawTool(g, c);
    }
    var sel = selectionCount();
    var selText = sel.keys ? TR("已选 " + sel.keys + " 键", sel.keys + " keys selected") : "";
    var rightW = selText ? textWidth(g, selText, 9.5) + 8 : 0;
    var hint = iconHint();
    var statusW = Math.max(20, f.w - rightW - 4);
    textBox(g, hint || statusText, f.x, f.statusY, statusW, f.statusH, 9.5,
      hint ? P.dim : P.faint, "left", "REGULAR", statusW);
    if (selText) textBox(g, selText, f.x + f.w - rightW, f.statusY, rightW, f.statusH, 9.5,
      P.success, "right", "REGULAR", rightW);
  }
  function iconHint() {
    var h = hoverId;
    if (!h) return "";
    if (isMulti() && (h === "mode:in" || h === "mode:out" || h === "mode:inout")) {
      return TR("多点模式写入两侧，入 / 出 / 双侧只在单段模式生效",
        "Multi-point writes both sides; In/Out/Both only apply to single-segment mode");
    }
    if (h === "icon:settings") return TR("设置（语言 / 实时写入模式）", "Settings (language / live write mode)");
    if (h === "icon:import") return isMulti() ? T("导入选中关键帧为多点曲线") : T("导入选中关键帧的缓动曲线");
    if (h === "icon:overshoot") return T(S.allowOvershoot ? "允许超出边界（链条断开）" : "限制在 0–1 内（链条连接）");
    if (h === "icon:realtime") return T(S.realtime ? "实时写入：开" : "实时写入：关");
    if (h === "icon:add") return T("添加关键帧点");
    if (h === "icon:del") return T("删除当前关键帧点");
    if (h === "icon:smooth") return T((S.anchors[S.selectedAnchor] && S.anchors[S.selectedAnchor].smooth !== false) ? "点击改成折断" : "点击改成平滑");
    if (h === "mode:in") return T("只写入入侧");
    if (h === "mode:out") return T("只写入出侧");
    if (h === "mode:inout") return T("写入入侧和出侧");
    if (h === "button:apply") return T(isMulti() ? "把点写成时间线关键帧" : "写入选中关键帧缓动");
    return "";
  }
  function drawTool(g, c) {
    var hov = hoverId === c.id, press = pressedId === c.id;
    // No resting chip: the toolbar is icon-only until the pointer reaches a control. Hover,
    // press and the selected mode paint the background; disabled modes (multi-point) never do.
    var rr = c.type === "mode" ? 9 : 10;
    if (!c.disabled) {
      if (press) fillRound(g, c.x, c.y, c.w, c.h, rr, P.highest);
      else if (hov) fillRound(g, c.x, c.y, c.w, c.h, rr, c.active ? P.primaryContainer : P.highest);
      else if (c.active) fillRound(g, c.x, c.y, c.w, c.h, rr, P.primaryContainer);
    }
    var col = c.disabled ? withAlpha(P.faint, 0.55)
      : c.active ? P.onPrimaryContainer
        : (c.icon === "gear" || c.icon === "overshoot") && c.on ? P.primary
          : (c.type === "mode" ? P.dim : P.text);
    drawIcon(g, c.icon, c.x + c.w / 2, c.y + c.h / 2, c.type === "mode" ? 10 : 11, col, {
      filled: c.icon === "gear" ? !!c.on : !!c.active,
      on: !!c.on,
      // Only the gear reads the angle; building a Date for every icon every frame was wasted.
      angle: c.icon === "gear" ? ((nowMs() / 1000) * 2.2) % (Math.PI * 2) : 0
    });
  }
  function drawApply(g, c) {
    var hov = hoverId === c.id, press = pressedId === c.id;
    var r = 10;
    var blue = press ? P.primary : P.primary;
    // The outline stays visible at rest; hover adds a soft fill, press fills the whole button.
    if (press) {
      fillRound(g, c.x, c.y, c.w, c.h, r, P.primary);
    } else {
      if (hov) fillRound(g, c.x, c.y, c.w, c.h, r, withAlpha(P.primary, 0.2));
      strokeRound(g, c.x + 0.8, c.y + 0.8, c.w - 1.6, c.h - 1.6, r - 0.8, blue, 1.8);
    }
    var cx = c.iconX !== undefined ? c.iconX : c.x + c.w / 2, cy = c.y + c.h / 2;
    // The check keeps its size no matter how wide the button is.
    var ss = Math.min(1, c.h / 32);
    var checkCol = press ? P.bg : P.primary;
    line(g, cx - 7 * ss, cy + 1 * ss, cx - 1 * ss, cy + 7 * ss, checkCol, Math.max(2, 2.4 * ss));
    line(g, cx - 1 * ss, cy + 7 * ss, cx + 9 * ss, cy - 6 * ss, checkCol, Math.max(2, 2.4 * ss));
  }
  function drawPill(g, c) {
    var hov = hoverId === c.id, press = pressedId === c.id;
    var fill = c.accent ? P.primaryContainer : P.high;
    if (press) fill = P.highest;
    else if (hov) fill = c.accent ? mixColor(P.primaryContainer, P.onPrimaryContainer, 0.08) : P.highest;
    if (press || hov) fillRound(g, c.x, c.y, c.w, c.h, c.h / 2, fill);
    if (c.icon) drawIcon(g, c.icon, c.x + c.w / 2, c.y + c.h / 2, Math.max(8, c.h / 2 - 3), c.accent ? P.onPrimaryContainer : P.text, {});
    else textBox(g, c.label, c.x + 8, c.y, c.w - 16, c.h, 10.5, c.accent ? P.onPrimaryContainer : P.text, "center", "REGULAR", c.w - 16);
  }
  function drawIcon(g, kind, cx, cy, r, color, state) {
    state = state || {};
    var pen = g.newPen(g.PenType.SOLID_COLOR, color, 1.6);
    var brush = g.newBrush(g.BrushType.SOLID_COLOR, color);
    if (kind === "gear") {
      var i, a;
      if (state.filled) {
        circle(g, cx, cy, r * 0.58, color, null, 0);
        for (i = 0; i < 8; i++) {
          a = Math.PI * 2 * i / 8;
          line(g, cx + Math.cos(a) * r * 0.54, cy + Math.sin(a) * r * 0.54,
            cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94, color, 5);
        }
        circle(g, cx, cy, r * 0.18, P.low, null, 0);
        // A small orbiting notch makes the symmetric cog visibly spin while realtime is on.
        if (finite(state.angle)) {
          var gk;
          for (gk = 2; gk >= 0; gk--) {
            var ga = state.angle - gk * 0.16;
            circle(g, cx + Math.cos(ga) * r * 0.4, cy + Math.sin(ga) * r * 0.4, gk === 0 ? 2.2 : 1.6,
              gk === 0 ? P.low : withAlpha(P.low, 0.28), null, 0);
          }
        }
      } else {
        circle(g, cx, cy, r * 0.56, null, color, 2.2);
        for (i = 0; i < 8; i++) {
          a = Math.PI * 2 * i / 8;
          line(g, cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58,
            cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92, color, 4);
        }
        circle(g, cx, cy, r * 0.18, null, color, 1.5);
      }
      return;
    }
    if (kind === "hamburger") {
      for (var hb = -1; hb <= 1; hb++) {
        line(g, cx - r * 0.5, cy + hb * r * 0.36, cx + r * 0.5, cy + hb * r * 0.36, color, 1.9);
      }
      return;
    }
    if (kind === "lang") {
      circle(g, cx, cy, r * 0.48, null, color, 1.5);
      line(g, cx - r * 0.48, cy, cx + r * 0.48, cy, color, 1.2);
      g.newPath();
      g.ellipsePath(cx - r * 0.2, cy - r * 0.48, r * 0.4, r * 0.96);
      g.strokePath(pen);
      return;
    }
    if (kind === "overshoot") {
      // Boundary OFF = chain intact; boundary ON (allow overshoot) = chain broken.
      if (!state.on) {
        strokeRound(g, cx - 10, cy - 4, 13, 8, 4, color, 1.6);
        strokeRound(g, cx - 3, cy - 4, 13, 8, 4, color, 1.6);
        line(g, cx - 5, cy, cx + 5, cy, color, 1.6);
      } else {
        // A clearly broken chain: two smaller links with a visible gap between them.
        strokeRound(g, cx - 16, cy - 4, 11, 8, 4, color, 1.7);
        strokeRound(g, cx + 5, cy - 4, 11, 8, 4, color, 1.7);
        line(g, cx - 3, cy - 6, cx - 3, cy - 2, color, 1.7);
        line(g, cx + 3, cy + 2, cx + 3, cy + 6, color, 1.7);
      }
      return;
    }
    if (kind === "import") {
      strokeRound(g, cx - 10, cy - 10, 13, 13, 3, color, 1.5);
      strokeRound(g, cx - 3, cy - 3, 13, 13, 3, color, 1.5);
      return;
    }
    if (kind === "plus") { line(g, cx - 7, cy, cx + 7, cy, color, 1.8); line(g, cx, cy - 7, cx, cy + 7, color, 1.8); return; }
    if (kind === "minus") { line(g, cx - 7, cy, cx + 7, cy, color, 1.8); return; }
    if (kind === "smooth") {
      g.newPath();
      if (state.filled) {
        g.moveTo(cx - 7, cy + 5);
        g.lineTo(cx - 3, cy + 5);
        g.lineTo(cx + 3, cy - 5);
        g.lineTo(cx + 7, cy - 5);
      } else {
        g.moveTo(cx - 7, cy + 5);
        g.lineTo(cx, cy);
        g.lineTo(cx + 7, cy - 5);
      }
      g.strokePath(pen);
      return;
    }
    if (kind === "triLeft" || kind === "triRight") {
      var dir = kind === "triLeft" ? -1 : 1;
      g.newPath();
      g.moveTo(cx + dir * 8, cy);
      g.lineTo(cx - dir * 6, cy - 7);
      g.lineTo(cx - dir * 6, cy + 7);
      g.closePath();
      if (state.filled) g.fillPath(brush); else g.strokePath(pen);
      return;
    }
    if (kind === "diamond") {
      g.newPath();
      g.moveTo(cx, cy - 8);
      g.lineTo(cx + 8, cy);
      g.lineTo(cx, cy + 8);
      g.lineTo(cx - 8, cy);
      g.closePath();
      if (state.filled) g.fillPath(brush); else g.strokePath(pen);
      return;
    }
    if (kind === "check") {
      line(g, cx - 8, cy + 1, cx - 2, cy + 7, color, 2.3);
      line(g, cx - 2, cy + 7, cx + 9, cy - 6, color, 2.3);
    }
  }

  // ---------------------------------------------------------------- drawing: presets
  function miniCurve(g, anchors, x, y, w, h, color) {
    var segs = curveSegmentsFor(anchors), si, tt, pt;
    // Fit overshoot values instead of clamping them to 0..1: a back/Ease Out curve with
    // y>1 used to look flat in the preset thumbnail because every y was clamped.
    var minX = 0, maxX = 1, minY = 0, maxY = 1;
    for (si = 0; si < anchors.length; si++) {
      var aa = anchors[si];
      minX = Math.min(minX, aa.x); maxX = Math.max(maxX, aa.x);
      minY = Math.min(minY, aa.y); maxY = Math.max(maxY, aa.y);
      if (aa.hIn) { minX = Math.min(minX, aa.hIn.x); maxX = Math.max(maxX, aa.hIn.x); minY = Math.min(minY, aa.hIn.y); maxY = Math.max(maxY, aa.hIn.y); }
      if (aa.hOut) { minX = Math.min(minX, aa.hOut.x); maxX = Math.max(maxX, aa.hOut.x); minY = Math.min(minY, aa.hOut.y); maxY = Math.max(maxY, aa.hOut.y); }
    }
    var padX = Math.max(0.04, (maxX - minX) * 0.08), padY = Math.max(0.04, (maxY - minY) * 0.08);
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    var vw = Math.max(0.001, maxX - minX), vh = Math.max(0.001, maxY - minY);
    var pen = g.newPen(g.PenType.SOLID_COLOR, color, 1.4);
    for (si = 0; si < segs.length; si++) {
      g.newPath();
      // 12 samples across a ~30px thumbnail: the old 24 points were invisible in the result.
      for (tt = 0; tt <= 12; tt++) {
        pt = cubicPointAt(segs[si], tt / 12);
        var px = x + (pt[0] - minX) / vw * w;
        var py = y + h - (pt[1] - minY) / vh * h;
        if (tt === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokePath(pen);
    }
  }
  function drawPresets(g, lay) {
    var pl = lay.presetLayout, r = lay.preset, list = pl.list;
    var listBottom = list.y + list.h;
    var i, j;
    // 1) Draw full cells first; the mask below clips them exactly at the list edges, so 1px
    // of a preview/name is still painted when it crosses the viewport border.
    if (pl.selectedGroup && !pl.cells.length) {
      textBox(g, T("这个组还没有预设 · 点“保存”"), pl.emptyRect.x, pl.emptyRect.y, pl.emptyRect.w, pl.emptyRect.h,
        10, P.faint, "left", "REGULAR");
    }
    for (i = 0; i < pl.cells.length; i++) {
      var cell = pl.cells[i], pr = cell.preset;
      // Only fully visible cells: the list is no longer masked with a background (the panel shows
      // EffectCraft's own colour), so a partially scrolled row would spill outside the viewport.
      if (cell.rect.y < list.y || cell.rect.y + cell.rect.h > listBottom) continue;
      var isSel = S.selectedPreset && S.selectedPreset.groupId === cell.group.id && S.selectedPreset.presetId === pr.id;
      var isHover = hoverId === "preset:" + cell.group.id + ":" + pr.id;
      var sq = Math.min(42, Math.max(26, cell.rect.w - 14));
      var sx = cell.rect.x + (cell.rect.w - sq) / 2;
      var sy = cell.rect.y + 2;
      if (isSel || isHover) fillRound(g, sx, sy, sq, sq, 10, isSel ? P.primaryContainer : P.highest);
      miniCurve(g, pr.anchors, sx + 5, sy + 5, sq - 10, sq - 10, isSel ? P.onPrimaryContainer : P.primary);
      textBox(g, presetDisplayName(pr), cell.rect.x, sy + sq + 2, cell.rect.w, 15, 9,
        isSel ? P.onPrimaryContainer : P.text, "center", "REGULAR", cell.rect.w);
    }
    // 2) Fixed header and group chips (the panel background itself stays unpainted).
    textBox(g, T("预设库"), r.x + 2, r.y, 70, 26, 10, P.dim, "left", "REGULAR");
    drawPill(g, pl.save);
    drawPill(g, pl.newGroup);
    // 3) Horizontal group chips, width follows the label.
    for (i = 0; i < pl.chips.length; i++) {
      var ch = pl.chips[i];
      var sel = ch.group.id === S.selectedGroupId;
      var hov = hoverId === "group:" + ch.group.id;
      if (sel || hov) fillRound(g, ch.x, ch.y, ch.w, ch.h, ch.h / 2, sel ? P.primaryContainer : P.highest);
      textBox(g, groupDisplayName(ch.group), ch.x + 7, ch.y, ch.w - 14, ch.h, 10,
        sel ? P.onPrimaryContainer : P.text, "center", "REGULAR", ch.w - 14);
    }
    // 4) Scrollbar above the mask.
    if (pl.scrollbar) {
      var sb = pl.scrollbar;
      fillRound(g, sb.x, sb.y, sb.w, sb.h, 6, withAlpha(P.outline, 0.26));
      fillRound(g, sb.thumbX, sb.thumbY, sb.thumbW, sb.thumbH, 3,
        withAlpha(P.primary, hoverId === "scrollbar" ? 0.95 : 0.72));
    }
    if (draggedGroup && drag && drag.kind === "group" && drag.active && drag.targetId && drag.targetId !== "__END__") {
      for (i = 0; i < pl.chips.length; i++) {
        if (pl.chips[i].group.id !== drag.targetId) continue;
        var tc = pl.chips[i];
        strokeRound(g, tc.x + 1, tc.y + 1, tc.w - 2, tc.h - 2, (tc.h - 2) / 2, withAlpha(P.primary, 0.9), 2);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- overlays (menus)
  function closeMenu() { menu = null; redraw(); }
  function setLanguage(lang) {
    var oldDefault = statusText === "选择关键帧 · 拖曲线 · 点 √ 写入" || statusText === "Select keys · Drag curve · Click √ to write";
    S.language = lang === "en" ? "en" : "zh";
    if (oldDefault) statusText = T("选择关键帧 · 拖曲线 · 点 √ 写入");
    saveState();
    menu = null;
    redraw(true);
  }
  function openSettingsMenu(x, y) {
    // 1.0.13: the globe moved in here, and the live-write mode switch joined it. With it on, a
    // drag only previews and the timeline is written when the pointer is released.
    var items = [
      { header: true, label: T("设置") },
      { label: (en() ? "✓ " : "") + "English", action: function () { setLanguage("en"); } },
      { label: (!en() ? "✓ " : "") + "中文", action: function () { setLanguage("zh"); } },
      { header: true, label: T("实时写入模式") },
      {
        label: (S.writeOnRelease ? "✓ " : "") + T("停止拖动后写入"),
        action: function () {
          S.writeOnRelease = !S.writeOnRelease;
          saveState();
          st(S.writeOnRelease ? "实时写入模式：停止拖动后写入" : "实时写入模式：随时写入",
            S.writeOnRelease ? "Live write mode: on release" : "Live write mode: continuous");
        }
      }
    ];
    menu = { x: x, y: y, w: 214, items: items };
    redraw(true);
  }
  function menuLayout(g) {
    if (!menu) return null;
    var itemH = 28, headerH = 22, pad = 6, w = menu.w || 210, h = pad * 2, i;
    for (i = 0; i < menu.items.length; i++) h += menu.items[i].header ? headerH : itemH;
    var x = clamp(menu.x, 8, (L ? L.W : 600) - w - 8);
    var y = clamp(menu.y, 8, (L ? L.H : 780) - h - 8);
    var rect = { x: x, y: y, w: w, h: h };
    menu.rect = rect;
    var cy = y + pad, items = [];
    for (i = 0; i < menu.items.length; i++) {
      var it = menu.items[i], ih = it.header ? headerH : itemH;
      it.rect = { x: x + pad, y: cy, w: w - pad * 2, h: ih };
      items.push(it);
      cy += ih;
    }
    menu.items = items;
    return menu;
  }
  function drawMenu(g) {
    if (!menu) return;
    menuLayout(g);
    var m = menu, i;
    fillRound(g, m.rect.x + 1, m.rect.y + 3, m.rect.w, m.rect.h, 20, withAlpha(P.shadow, 0.55));
    fillRound(g, m.rect.x, m.rect.y, m.rect.w, m.rect.h, 20, P.high);
    for (i = 0; i < m.items.length; i++) {
      var it = m.items[i];
      if (it.header) {
        textBox(g, it.label, it.rect.x + 10, it.rect.y, it.rect.w - 20, it.rect.h, 9.5, P.faint, "left", "REGULAR");
        continue;
      }
      if (hoverId === "menu:" + i) fillRound(g, it.rect.x, it.rect.y, it.rect.w, it.rect.h, 11, P.highest);
      textBox(g, it.label, it.rect.x + 12, it.rect.y, it.rect.w - 24, it.rect.h, 11, it.danger ? P.danger : P.text, "left", "REGULAR");
    }
  }

  // ---------------------------------------------------------------- presets: actions
  function loadPreset(group, preset, applyNow) {
    S.anchors = cloneAnchors(preset.anchors);
    S.selectedAnchor = 0;
    S.selectedPreset = { groupId: group.id, presetId: preset.id };
    // Detect overshoot before completing handles: ensureMultiHandles() clamps y to 0..1 when the
    // overshoot switch is off, which used to flatten imported bounce presets.
    if (!S.allowOvershoot) {
      var outside = false;
      for (var i = 0; i < S.anchors.length; i++) {
        var a = S.anchors[i];
        if (a.y < 0 || a.y > 1) outside = true;
        if (a.hIn && (a.hIn.y < 0 || a.hIn.y > 1)) outside = true;
        if (a.hOut && (a.hOut.y < 0 || a.hOut.y > 1)) outside = true;
      }
      if (outside) S.allowOvershoot = true;
    }
    if (S.anchors.length > 2) ensureMultiHandles(S.anchors);
    if (!S.allowOvershoot) clampAllAnchors();
    saveState();
    if (applyNow || (S.realtime && !isMulti())) {
      applyCurrent(false);
    } else {
      status(TR("已加载预设“" + presetDisplayName(preset) + "”，点 √ 写入关键帧",
      "Loaded preset “" + presetDisplayName(preset) + "”; click √ to write keyframes"));
    }
    redraw();
  }
  function openPresetPicker() {
    var items = [], groups = allGroups(), i, j;
    for (i = 0; i < groups.length; i++) {
      items.push({ header: true, label: groupDisplayName(groups[i]) });
      for (j = 0; j < groups[i].presets.length; j++) {
        (function (gr, pr) {
          items.push({ label: presetDisplayName(pr), action: function () { loadPreset(gr, pr, false); } });
        })(groups[i], groups[i].presets[j]);
      }
      if (!groups[i].presets.length) items.push({ label: T("（空）"), disabled: true });
    }
    items.push({ header: true, label: T("提示") });
    items.push({ label: T("更多操作在下方预设库"), disabled: true });
    menu = { x: (L ? L.func.x : 20), y: (L ? L.func.y + 100 : 100), w: 220, items: items };
    redraw();
  }
  function saveCurrentAsPreset() {
    var groups = S.userGroups, names = [], values = [], i;
    for (i = 0; i < groups.length; i++) { names.push(groupDisplayName(groups[i])); values.push(groups[i].name); }
    var name = TR("我的缓动", "My Ease");
    // 1.0.12: the dialog defaults to the group selected in the panel, so right-click → save while
    // 经典 is selected saves into 经典 without touching the dropdown.
    var cur = null;
    for (i = 0; i < groups.length; i++) if (groups[i].id === S.selectedGroupId) { cur = groups[i]; break; }
    if (!cur && groups.length) cur = groups[0];
    var groupName = cur ? groupDisplayName(cur) : TR("我的预设", "My Presets");
    var res = presetSaveDialog(name, groupName, names);
    if (!res) return;
    var gname = cleanName(res.group), pname = cleanName(res.name);
    for (i = 0; i < names.length; i++) if (names[i] === res.group) { gname = values[i]; break; }
    if (!pname) { st("预设名称不能为空", "Preset name cannot be empty"); return; }
    var grp = null;
    for (i = 0; i < S.userGroups.length; i++) if (S.userGroups[i].name.toLowerCase() === gname.toLowerCase()) grp = S.userGroups[i];
    if (!grp) {
      grp = { id: makeId("g"), name: gname || "我的预设", presets: [] };
      S.userGroups.push(grp);
    }
    var existing = null;
    for (i = 0; i < grp.presets.length; i++) if (grp.presets[i].name.toLowerCase() === pname.toLowerCase()) existing = grp.presets[i];
    if (existing) {
      existing.anchors = cloneAnchors(S.anchors);
      status(TR("已替换预设“" + pname + "”", "Replaced preset “" + pname + "”"));
    } else {
      grp.presets.push({ id: makeId("p"), name: pname, anchors: cloneAnchors(S.anchors), multi: S.anchors.length > 2 });
      status(TR("已保存预设“" + pname + "”到“" + groupDisplayName(grp) + "”", "Saved preset “" + pname + "” to “" + groupDisplayName(grp) + "”"));
    }
    S.collapsed[grp.id] = false;
    saveState();
    redraw();
  }
  function renamePreset(group, preset) {
    if (isBuiltinGroup(group)) { status(TR("内置预设只读，可复制到“我的预设”后再改名", "Built-in presets are read-only; copy to My Presets first")); return; }
    var res = inputDialog(T("重命名预设"), T("预设名称"), preset.name);
    if (res === null) return;
    var name = cleanName(res);
    if (!name) { st("名称不能为空", "Name cannot be empty"); return; }
    for (var i = 0; i < group.presets.length; i++) {
      if (group.presets[i] !== preset && group.presets[i].name.toLowerCase() === name.toLowerCase()) {
        st("该组里已有同名预设", "This group already has a preset with that name"); return;
      }
    }
    preset.name = name;
    status(TR("预设已重命名为“" + name + "”", "Preset renamed to “" + name + "”"));
    saveState(); redraw();
  }
  function updatePresetFromCurve(group, preset) {
    if (isBuiltinGroup(group)) { st("内置预设只读", "Built-in presets are read-only"); return; }
    if (!confirmDialog(T("用当前曲线更新该预设"),
      TR("用编辑器里的当前曲线覆盖预设“" + presetDisplayName(preset) + "”吗？",
        "Replace preset “" + presetDisplayName(preset) + "” with the current curve?"))) return;
    preset.anchors = cloneAnchors(S.anchors);
    preset.multi = S.anchors.length > 2;
    S.selectedPreset = { groupId: group.id, presetId: preset.id };
    status(TR("已更新预设“" + presetDisplayName(preset) + "”", "Updated preset “" + presetDisplayName(preset) + "”"));
    saveState(); redraw();
  }
  function deletePreset(group, preset) {
    if (isBuiltinGroup(group)) { st("内置预设不能删除", "Built-in presets cannot be deleted"); return; }
    if (!confirmDialog(T("删除预设"), TR("确定删除预设“" + preset.name + "”吗？", "Delete preset “" + preset.name + "”?"))) return;
    for (var i = 0; i < group.presets.length; i++) {
      if (group.presets[i] === preset) { group.presets.splice(i, 1); break; }
    }
    status(TR("已删除预设“" + preset.name + "”", "Deleted preset “" + preset.name + "”"));
    saveState(); redraw();
  }
  function duplicateToUserGroup(preset) {
    var grp = S.userGroups.length ? S.userGroups[0] : null;
    if (!grp) {
      grp = { id: makeId("g"), name: "我的预设", presets: [] };
      S.userGroups.push(grp);
    }
    var base = TR(preset.name + " 副本", preset.name + " copy"), name = base, k = 2;
    function exists(nm) {
      for (var i = 0; i < grp.presets.length; i++) if (grp.presets[i].name.toLowerCase() === nm.toLowerCase()) return true;
      return false;
    }
    while (exists(name)) { name = base + " " + k; k++; }
    grp.presets.push({ id: makeId("p"), name: name, anchors: cloneAnchors(preset.anchors), multi: preset.anchors.length > 2 });
    S.collapsed[grp.id] = false;
    status(TR("已复制到“" + groupDisplayName(grp) + "”", "Copied to “" + groupDisplayName(grp) + "”"));
    saveState(); redraw();
  }
  function duplicatePreset(group, preset) {
    if (isBuiltinGroup(group)) { duplicateToUserGroup(preset); return; }
    var base = TR(preset.name + " 副本", preset.name + " copy"), name = base, k = 2;
    function exists(nm) {
      for (var i = 0; i < group.presets.length; i++) if (group.presets[i].name.toLowerCase() === nm.toLowerCase()) return true;
      return false;
    }
    while (exists(name)) { name = base + " " + k; k++; }
    group.presets.push({ id: makeId("p"), name: name, anchors: cloneAnchors(preset.anchors), multi: preset.anchors.length > 2 });
    status(TR("已复制预设“" + name + "”", "Duplicated preset “" + name + "”"));
    saveState(); redraw();
  }
  function createGroup() {
    var res = inputDialog(T("新建预设组"), T("组名称"), T("新组"));
    if (res === null) return;
    var name = cleanName(res);
    if (!name) { st("组名称不能为空", "Group name cannot be empty"); return; }
    for (var i = 0; i < S.userGroups.length; i++) if (S.userGroups[i].name.toLowerCase() === name.toLowerCase()) {
      st("已有同名预设组", "A group with that name already exists"); return;
    }
    var g = { id: makeId("g"), name: name, presets: [] };
    S.userGroups.push(g);
    if (!S.groupOrder) S.groupOrder = [];
    S.groupOrder.push(g.id);
    S.collapsed[g.id] = false;
    status(TR("已新建预设组“" + name + "”", "Created preset group “" + name + "”"));
    saveState(); redraw();
  }
  function renameGroup(group) {
    var res = inputDialog(T("重命名预设组"), T("组名称"), groupDisplayName(group));
    if (res === null) return;
    var name = cleanName(res);
    if (!name) { st("组名称不能为空", "Group name cannot be empty"); return; }
    for (var i = 0; i < S.userGroups.length; i++) {
      if (S.userGroups[i] !== group && S.userGroups[i].name.toLowerCase() === name.toLowerCase()) {
        st("已有同名预设组", "A group with that name already exists"); return;
      }
    }
    group.name = name;
    status(TR("预设组已重命名为“" + name + "”", "Preset group renamed to “" + name + "”"));
    saveState(); redraw();
  }
  function deleteGroup(group) {
    if (isBuiltinGroup(group)) { st("内置预设组不能删除", "Built-in preset groups cannot be deleted"); return; }
    if (S.userGroups.length <= 1) { st("至少保留一个自定义预设组", "Keep at least one custom preset group"); return; }
    if (!confirmDialog(T("删除预设组"), TR("确定删除“" + groupDisplayName(group) + "”及其中的 " + group.presets.length + " 个预设吗？",
      "Delete “" + groupDisplayName(group) + "” and its " + group.presets.length + " pre" + (group.presets.length === 1 ? "set" : "sets") + "?"))) return;
    for (var i = 0; i < S.userGroups.length; i++) {
      if (S.userGroups[i] === group) { S.userGroups.splice(i, 1); break; }
    }
    if (S.groupOrder) {
      for (var oi = 0; oi < S.groupOrder.length; oi++) {
        if (S.groupOrder[oi] === group.id) { S.groupOrder.splice(oi, 1); break; }
      }
    }
    status(TR("已删除预设组“" + groupDisplayName(group) + "”", "Deleted preset group “" + groupDisplayName(group) + "”"));
    saveState(); redraw();
  }

  // ---------------------------------------------------------------- native dialogs
  function inputDialog(titleText, labelText, initial) {
    var dlg = new Window("dialog", titleText);
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 8;
    dlg.margins = 14;
    var lbl = dlg.add("statictext", undefined, labelText);
    lbl.preferredSize = [72, 18];
    var field = dlg.add("edittext", undefined, initial || "");
    field.characters = 26;
    var buttons = dlg.add("group");
    buttons.alignment = ["right", "top"];
    buttons.add("button", undefined, T("取消"), { name: "cancel" });
    var ok = buttons.add("button", undefined, T("确定"), { name: "ok" });
    var out = null;
    ok.onClick = function () { out = field.text; dlg.close(1); };
    buttons.children[0].onClick = function () { dlg.close(0); };
    dlg.show();
    return out;
  }
  function confirmDialog(titleText, message) {
    var dlg = new Window("dialog", titleText);
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 14;
    var msg = dlg.add("statictext", undefined, message);
    msg.preferredSize = [320, 18];
    var buttons = dlg.add("group");
    buttons.alignment = ["right", "top"];
    var cancel = buttons.add("button", undefined, T("取消"), { name: "cancel" });
    var ok = buttons.add("button", undefined, T("删除"), { name: "ok" });
    var out = false;
    ok.onClick = function () { out = true; dlg.close(1); };
    cancel.onClick = function () { dlg.close(0); };
    dlg.show();
    return out;
  }
  function presetSaveDialog(defaultName, defaultGroup, groupNames) {
    var dlg = new Window("dialog", T("保存预设"));
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 18;
    var form = dlg.add("group");
    form.orientation = "column";
    form.alignment = ["fill", "top"];
    form.alignChildren = ["fill", "top"];
    form.spacing = 8;
    function addRow(labelText, kind, value) {
      var row = form.add("group");
      row.alignment = ["fill", "top"];
      row.alignChildren = ["left", "center"];
      row.spacing = 10;
      var lbl = row.add("statictext", undefined, labelText);
      lbl.preferredSize = [76, 20];
      lbl.justify = "right";
      var control = row.add(kind, undefined, value);
      control.alignment = ["fill", "center"];
      control.preferredSize = [176, 24];
      return control;
    }
    var name = addRow(T("预设名称"), "edittext", defaultName);
    name.characters = 24;
    var drop = addRow(T("保存到组"), "dropdownlist", groupNames.length ? groupNames : [T("我的预设")]);
    drop.preferredSize = [176, 24];
    drop.selection = 0;
    if (defaultGroup && groupNames.length) {
      for (var i = 0; i < groupNames.length; i++) if (groupNames[i] === defaultGroup) drop.selection = i;
    }
    var newGroup = addRow(T("新建组名"), "edittext", "");
    newGroup.characters = 24;
    newGroup.helpTip = T("填写后会新建这个组；留空则使用上方所选组");
    var buttons = dlg.add("group");
    buttons.alignment = ["fill", "top"];
    buttons.alignChildren = ["right", "center"];
    buttons.spacing = 8;
    var cancel = buttons.add("button", undefined, T("取消"), { name: "cancel" });
    var ok = buttons.add("button", undefined, T("保存"), { name: "ok" });
    cancel.preferredSize = [82, 26];
    ok.preferredSize = [82, 26];
    dlg.preferredSize = [338, 214];
    var out = null;
    ok.onClick = function () {
      var g = String(newGroup.text || "");
      var list = drop.items;
      var selected = drop.selection ? drop.selection.text : (list.length ? list[0].text : "我的预设");
      out = { name: name.text, group: g ? g : selected };
      dlg.close(1);
    };
    cancel.onClick = function () { dlg.close(0); };
    dlg.show();
    return out;
  }

  // ---------------------------------------------------------------- hit testing
  function hitTest(x, y) {
    if (!L) return null;
    // menu first
    if (menu && menu.rect && pointInRect(x, y, menu.rect)) {
      for (var mi = 0; mi < menu.items.length; mi++) {
        var it = menu.items[mi];
        if (!it.header && !it.disabled && pointInRect(x, y, it.rect)) return { kind: "menu", index: mi, item: it };
      }
      return { kind: "menuBlank" };
    }
    // resize (floating editor only; the docked panel is fixed-size)
    if (!embedded) {
      if (pointInRect(x, y, L.resize.se)) return { kind: "resize", edge: "se" };
      if (x >= L.W - 6) return { kind: "resize", edge: "e" };
      if (y >= L.H - 6) return { kind: "resize", edge: "s" };
    }
    // Choose the closest anchor/handle, with a tiny bias towards anchors. A handle clamped at
    // the viewport edge can sit very close to its point; always preferring anchors made that
    // lever impossible to grab, so the user could only move the point up/down.
    var i, bestAnchor = null, bestHandle = null, bestAD = 1e9, bestHD = 1e9;
    for (i = 0; i < L.anchors.length; i++) {
      var a = L.anchors[i];
      var ax = x - a.x, ay = y - a.y, ad = ax * ax + ay * ay;
      if (ad <= a.r * a.r && ad < bestAD) { bestAD = ad; bestAnchor = a; }
    }
    for (i = 0; i < L.handles.length; i++) {
      var h = L.handles[i];
      var dx = x - h.x, dy = y - h.y, hd = dx * dx + dy * dy;
      if (hd <= h.r * h.r && hd < bestHD) { bestHD = hd; bestHandle = h; }
    }
    if (bestHandle && (!bestAnchor || bestHD + 4 < bestAD)) return bestHandle;
    if (bestAnchor) return bestAnchor;
    if (bestHandle) return bestHandle;
    // preset area (before the generic control list, so rows/headers keep their kinds)
    var pl = L.presetLayout;
    if (pl && pointInRect(x, y, L.preset)) {
      if (pointInRect(x, y, pl.save.rect)) return pl.save;
      if (pointInRect(x, y, pl.newGroup.rect)) return pl.newGroup;
      if (pl.scrollbar && pointInRect(x, y, { x: pl.scrollbar.x, y: pl.scrollbar.y, w: pl.scrollbar.w, h: pl.scrollbar.h })) return { kind: "scrollbar", rect: pl.scrollbar };
      for (i = 0; i < pl.chips.length; i++) {
        if (pointInRect(x, y, pl.chips[i].rect)) return { kind: "groupChip", group: pl.chips[i].group, chip: pl.chips[i] };
      }
      for (i = 0; i < pl.cells.length; i++) {
        if (pointInRect(x, y, pl.cells[i].rect) && pointInRect(x, y, pl.list)) {
          return { kind: "preset", group: pl.cells[i].group, preset: pl.cells[i].preset, cell: pl.cells[i] };
        }
      }
      return { kind: "presetBlank" };
    }
    // function controls
    var ctrls = L.controls || [];
    for (i = 0; i < ctrls.length; i++) if (pointInRect(x, y, ctrls[i].rect)) return ctrls[i];
    return null;
  }
  function idOf(hit) {
    if (!hit) return null;
    if (hit.kind === "menu") return "menu:" + hit.index;
    if (hit.kind === "handle") return "handle:" + hit.i + ":" + hit.side;
    if (hit.kind === "anchor") return "anchor:" + hit.i;
    if (hit.kind === "preset") return "preset:" + hit.group.id + ":" + hit.preset.id;
    if (hit.kind === "groupChip") return "group:" + hit.group.id;
    if (hit.kind === "moreGroups") return "button:moreGroups";
    if (hit.kind === "scrollbar") return "scrollbar";
    if (hit.id) return hit.id;
    return null;
  }

  // ---------------------------------------------------------------- interactions
  function canvasMouseDown(e) {
    var themed = refreshTheme();
    if (themed && !drag) redraw();
    if (e.button === 2) {
      var r = hitTest(e.clientX, e.clientY);
      openContextFor(r, e.clientX, e.clientY);
      return;
    }
    if (menu) {
      var mh = hitTest(e.clientX, e.clientY);
      if (mh && mh.kind === "menu") { var act = mh.item.action; closeMenu(); if (act) act(); }
      else if (!mh || mh.kind !== "menuBlank") closeMenu();
      else closeMenu();
      return;
    }
    var hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.kind === "resize") {
      drag = { kind: "resize", edge: hit.edge, w0: win.size.width, h0: win.size.height, x0: e.clientX, y0: e.clientY, lastT: 0, t0: nowMs() };
      return;
    }
    if (hit.kind === "handle") {
      S.selectedAnchor = hit.i;
      drag = { kind: "handle", i: hit.i, side: hit.side, moved: false, t0: nowMs() };
      liveMode = S.realtime;
      return;
    }
    if (hit.kind === "anchor") {
      S.selectedAnchor = hit.i;
      var anchor0 = S.anchors[hit.i];
      drag = {
        kind: "anchor", i: hit.i, x0: e.clientX, y0: e.clientY,
        ax: anchor0.x, ay: anchor0.y,
        hIn0: anchor0.hIn ? { x: anchor0.hIn.x, y: anchor0.hIn.y } : null,
        hOut0: anchor0.hOut ? { x: anchor0.hOut.x, y: anchor0.hOut.y } : null,
        moved: false, t0: nowMs()
      };
      liveMode = S.realtime;
      redraw();
      return;
    }
    if (hit.kind === "scrollbar") {
      var sb = hit.rect;
      drag = { kind: "scrollbar", y0: e.clientY, scroll0: S.scroll | 0, sb: sb, t0: nowMs() };
      return;
    }
    if (hit.kind === "presetBlank") {
      // Drag the empty part of the preset list up/down to scroll. EffectCraft's ScriptUI does not
      // deliver wheel events to scripts, so this is the mouse-only fallback.
      drag = { kind: "presetPan", y0: e.clientY, scroll0: S.scroll | 0, moved: false, t0: nowMs() };
      return;
    }
    if (hit.kind === "preset") {
      S.selectedPreset = { groupId: hit.group.id, presetId: hit.preset.id };
      // Load on press: a click always loads the curve even if the host later reports a stray
      // pointer movement; dragging the row then reorders it. Built-in presets are read-only and
      // are rebuilt on every launch, so they never start a reorder drag.
      loadPreset(hit.group, hit.preset, false);
      pressedId = idOf(hit);
      redraw();
      return;
    }
    if (hit.kind === "groupChip") {
      drag = {
        kind: "group", group: hit.group, x0: e.clientX, y0: e.clientY,
        active: false, targetId: null, t0: nowMs()
      };
      pressedId = idOf(hit);
      redraw();
      return;
    }
    if (hit.kind === "menu") return;
    var pressId = idOf(hit);
    if (pressId) {
      pressedId = pressId;
      redraw();
    }
  }

  function canvasMouseMove(e) {
    if (drag) {
      // Synthetic mouse commands (and the real pointer settling right after a press) must not turn
      // a click into a drag. A real drag produces several mousemove events a few frames later.
      drag.moves = (drag.moves || 0) + 1;
      if (drag.moves < 2) return;
      if (drag.kind === "resize") {
        var nw = drag.edge === "s" ? drag.w0 : clamp(Math.round(drag.w0 + (e.clientX - drag.x0)), MIN_W, 2400);
        var nh = drag.edge === "e" ? drag.h0 : clamp(Math.round(drag.h0 + (e.clientY - drag.y0)), MIN_H, 2000);
        if (nw === win.size.width && nh === win.size.height) return;
        var rnow = nowMs();
        if (drag.lastT && rnow - drag.lastT < 24) return;
        drag.lastT = rnow;
        win.size = [nw, nh];
        win.layout.layout(true);
        redraw();
        return;
      }
      if (drag.kind === "scrollbar") {
        var sb = drag.sb;
        var maxScroll = L.presetLayout.maxScroll || 0;
        var travel = sb.thumbH !== undefined ? (sb.h - sb.thumbH) : 1;
        var delta = (e.clientY - drag.y0) / Math.max(1, travel) * maxScroll;
        S.scroll = clamp(Math.round(drag.scroll0 + delta), 0, maxScroll);
        redraw();
        return;
      }
      if (drag.kind === "presetPan") {
        var panMax = L.presetLayout.maxScroll || 0;
        if (!drag.moved && Math.abs(e.clientY - drag.y0) > 2) drag.moved = true;
        S.scroll = clamp(Math.round(drag.scroll0 - (e.clientY - drag.y0)), 0, panMax);
        redraw();
        return;
      }
      if (drag.kind === "handle") {
        var a = S.anchors[drag.i];
        var pt = screenToCurve(e.clientX, e.clientY);
        if (pt) {
          var h = a[drag.side];
          if (!h && drag.side === "hOut") h = a.hOut = { x: a.x, y: a.y };
          if (!h && drag.side === "hIn") h = a.hIn = { x: a.x, y: a.y };
          h.x = pt.x; h.y = pt.y;
          if (a.smooth && drag.i > 0 && drag.i < S.anchors.length - 1) {
            var other = drag.side === "hOut" ? a.hIn : a.hOut;
            if (other) {
              var lenOther = Math.sqrt((other.x - a.x) * (other.x - a.x) + (other.y - a.y) * (other.y - a.y)) || 0.15;
              var dx = h.x - a.x, dy = h.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 0.15;
              other.x = a.x - dx / len * lenOther;
              other.y = a.y - dy / len * lenOther;
            }
          }
          clampAnchorHandles(drag.i);
          drag.moved = true;
          if (liveMode) applyLive();
          redraw();
        }
        return;
      }
      if (drag.kind === "anchor") {
        var ac = S.anchors[drag.i];
        var sc = plotScale();
        var curveDX = (e.clientX - drag.x0) / sc.sx;
        var curveDY = -(e.clientY - drag.y0) / sc.sy;
        var targetX = drag.ax + curveDX, targetY = drag.ay + curveDY;
        if (drag.i === 0) targetX = 0;
        else if (drag.i === S.anchors.length - 1) targetX = 1;
        else targetX = clamp(targetX, S.anchors[drag.i - 1].x + 0.003, S.anchors[drag.i + 1].x - 0.003);
        targetY = S.allowOvershoot ? clamp(targetY, -1, 2) : clamp(targetY, 0, 1);
        // Move the levers by the point's ACTUAL clamped displacement, not the raw pointer delta.
        // Otherwise a point stopped by its neighbours leaves the levers drifting and apparently
        // snapping to the border.
        var moveX = targetX - drag.ax, moveY = targetY - drag.ay;
        ac.x = targetX; ac.y = targetY;
        // Use the handles' positions at drag start + total displacement. Doing += on every
        // mousemove added the cumulative movement repeatedly, which shot the levers to the edges.
        if (ac.hIn && drag.hIn0) { ac.hIn.x = drag.hIn0.x + moveX; ac.hIn.y = drag.hIn0.y + moveY; }
        if (ac.hOut && drag.hOut0) { ac.hOut.x = drag.hOut0.x + moveX; ac.hOut.y = drag.hOut0.y + moveY; }
        clampAnchorHandles(drag.i);
        drag.moved = true;
        if (liveMode) applyLive();
        redraw();
        return;
      }
      if (drag.kind === "preset") {
        var dxp = e.clientX - drag.x0, dyp = e.clientY - drag.y0;
        if (!drag.active && (Math.abs(dxp) > 4 || Math.abs(dyp) > 4)) {
          drag.active = true;
          draggedPreset = { group: drag.group, preset: drag.preset, x: e.clientX, y: e.clientY };
        }
        if (drag.active) {
          draggedPreset.x = e.clientX;
          draggedPreset.y = e.clientY;
          drag.drop = computePresetDrop(e.clientX, e.clientY, drag.group);
          redraw();
        }
        return;
      }
      if (drag.kind === "group") {
        var dgx = e.clientX - drag.x0, dgy = e.clientY - drag.y0;
        if (!drag.active && (Math.abs(dgx) > 5 || Math.abs(dgy) > 5)) {
          drag.active = true;
          draggedGroup = drag.group;
          st("拖动预设组排序；松开鼠标放下", "Dragging preset group; release to drop");
        }
        if (drag.active) {
          drag.lastY = e.clientY;
          drag.targetId = groupDropTarget(e.clientX, e.clientY);
          redraw();
        }
        return;
      }
    }
    var hit = hitTest(e.clientX, e.clientY);
    var id = idOf(hit);
    if (id !== hoverId) {
      hoverId = id;
      redraw();
    }
    // window edge hover highlight
    if (!drag && (e.clientX >= L.W - 6 || e.clientY >= L.H - 6)) {
      hoverId = (e.clientX >= L.W - 6 && e.clientY >= L.H - 6) ? "resize:se" : e.clientX >= L.W - 6 ? "resize:e" : "resize:s";
      redraw();
    }
  }

  function canvasMouseUp(e) {
    if (drag) {
      if (drag.kind === "resize") {
        // Apply the final pointer position even if the last move was throttled.
        var fw = drag.edge === "s" ? drag.w0 : clamp(Math.round(drag.w0 + (e.clientX - drag.x0)), MIN_W, 2400);
        var fh = drag.edge === "e" ? drag.h0 : clamp(Math.round(drag.h0 + (e.clientY - drag.y0)), MIN_H, 2000);
        win.size = [fw, fh];
        win.layout.layout(true);
        S.size = [fw, fh];
        saveState();
        redraw(true);
        drag = null;
        return;
      }
      if (drag.kind === "scrollbar") { saveState(); drag = null; redraw(true); return; }
      if (drag.kind === "group") {
        if (drag.active) {
          applyGroupDrop(drag.group, groupDropTarget(e.clientX, e.clientY));
          draggedGroup = null;
          st("预设组顺序已更新", "Preset group order updated");
          saveState();
        } else {
          S.selectedGroupId = drag.group.id;
          S.scroll = 0;
          saveState();
        }
        drag = null; pressedId = null; redraw(true);
        return;
      }
      if (drag.kind === "handle" || drag.kind === "anchor") {
        // A live multi-point drag rebuilds keys, so the last (possibly throttled) pointer position
        // is written before the undo step closes. This runs inside the drag's undo group.
        if (liveMode && drag.moved && isMulti()) applyLive(true);
        endLiveGroup();
        liveMode = false;
        // 1.0.13: write-on-release mode: the drag only previews, the timeline is written once when
        // the pointer is released (multi-point curves rebuild the keys, single segments the eases).
        if (S.realtime && S.writeOnRelease && drag.moved) {
          try { if (isMulti()) applyMultiCurve(); else applyCurrent(false); } catch (e) {}
        }
        if (drag.moved) {
          if (isMulti()) {
            if (S.realtime) st(S.writeOnRelease ? "已写入关键帧（停止拖动后写入）" : "已实时写入多点关键帧",
              S.writeOnRelease ? "Keyframes written on release" : "Multi-point keyframes written live");
            else st("多点曲线已更新；点 √ 写入时间线关键帧", "Multi-point curve updated; click √ to write timeline keys");
          } else if (S.realtime) st(S.writeOnRelease ? "已写入缓动（停止拖动后写入）" : "已实时写入缓动",
            S.writeOnRelease ? "Easing written on release" : "Easing written live");
          else st("预览已更新，点 √ 写入关键帧", "Preview updated; click √ to write keyframes");
          saveState();
        }
        drag = null;
        redraw(true);
        return;
      }
      if (drag.kind === "preset") {
        if (drag.active) {
          applyPresetDrop(drag);
          draggedPreset = null;
          st("已调整预设顺序", "Preset order changed");
          saveState();
        } else {
          var now = nowMs();
          var clickId = "preset:" + drag.group.id + ":" + drag.preset.id;
          var dbl = lastClick.id === clickId && now - lastClick.t < 380;
          lastClick = { id: clickId, t: now };
          if (dbl) loadPreset(drag.group, drag.preset, true);
        }
        drag = null;
        pressedId = null;
        redraw(true);
        return;
      }
      drag = null;
    }
    if (pressedId) {
      var hit = hitTest(e.clientX, e.clientY);
      if (hit && idOf(hit) === pressedId) activate(hit, e.clientX, e.clientY);
      pressedId = null;
      redraw(true);
    }
  }

  function activate(hit, x, y) {
    var id = idOf(hit);
    if (!id) return;
    if (id === "icon:settings") { openSettingsMenu(x || 0, y || 0); return; }
    if (id === "icon:overshoot") {
      S.allowOvershoot = !S.allowOvershoot;
      if (!S.allowOvershoot) clampAllAnchors();
      st(S.allowOvershoot ? "超出边界：开（链条断开）" : "超出边界：关（链条连接）",
        S.allowOvershoot ? "Overshoot: On (chain broken)" : "Overshoot: Off (chain linked)");
      saveState(); redraw(); return;
    }
    if (id === "icon:realtime") {
      S.realtime = !S.realtime;
      if (isMulti()) {
        st(S.realtime ? "实时写入已开启：拖动点或操纵杆会立即重建时间线关键帧" : "实时写入已关闭",
          S.realtime ? "Live write on: dragging points or levers rebuilds the timeline keys" : "Live write is off");
      } else {
        st(S.realtime ? "实时写入已开启：拖动控制点会立即写入关键帧" : "实时写入已关闭：调整只预览",
          S.realtime ? "Live write on: dragging controls writes keyframes" : "Live write off: adjustments preview only");
      }
      saveState();
      // Single mode only applies the already-loaded curve here; multi-point apply rebuilds
      // keyframes, which should not happen just because the switch was turned on.
      if (S.realtime && !isMulti()) applyCurrent(false);
      redraw(); return;
    }
    if (id === "icon:import") { importCurve(); return; }
    if (id === "icon:add") { addAnchor(); return; }
    if (id === "icon:del") { deleteAnchor(); return; }
    if (id === "icon:smooth") { toggleSmooth(); return; }
    if (id === "button:apply") { applyCurrent(false); return; }
    if (id === "mode:in" || id === "mode:out" || id === "mode:inout") {
      if (isMulti()) {
        st("多点模式按点写入两侧，入 / 出 / 双侧只在单段模式生效",
          "Multi-point writes both sides; In/Out/Both only apply to single-segment mode");
        redraw();
        return;
      }
      S.applyMode = id === "mode:in" ? "in" : id === "mode:out" ? "out" : "inout";
      saveState(); redraw(); return;
    }
    if (id === "button:savePreset") { saveCurrentAsPreset(); return; }
    if (id === "button:newGroup") { createGroup(); return; }
    if (id === "button:groups" || id === "button:moreGroups") { S.showAllGroups = !S.showAllGroups; saveState(); redraw(); return; }
    if (hit.kind === "groupChip") { S.selectedGroupId = hit.group.id; S.scroll = 0; saveState(); redraw(); return; }
    if (hit.kind === "preset") { loadPreset(hit.group, hit.preset, false); return; }
  }

  function openContextFor(hit, x, y) {
    if (menu) { closeMenu(); return; }
    if (!hit) return;
    if (hit.kind === "preset") {
      // Every group is editable now (the built-ins are migrated into user groups), so one menu
      // covers loading, updating from the current curve, renaming, duplicating and deleting.
      menu = {
        x: x, y: y, w: 214, items: [
          { label: T("加载到编辑器"), action: function () { loadPreset(hit.group, hit.preset, false); } },
          { label: T("加载并应用"), action: function () { loadPreset(hit.group, hit.preset, true); } },
          { header: true, label: "" },
          { label: T("用当前曲线更新该预设"), action: function () { updatePresetFromCurve(hit.group, hit.preset); } },
          { label: T("重命名…"), action: function () { renamePreset(hit.group, hit.preset); } },
          { label: T("复制"), action: function () { duplicatePreset(hit.group, hit.preset); } },
          { label: T("删除"), danger: true, action: function () { deletePreset(hit.group, hit.preset); } }
        ]
      };
      redraw(); return;
    }
    if (hit.kind === "groupChip") {
      menu = {
        x: x, y: y, w: 190, items: [
          { label: T("显示这个组"), action: function () { S.selectedGroupId = hit.group.id; S.scroll = 0; saveState(); } },
          { header: true, label: "" },
          { label: T("新建组…"), action: createGroup },
          { label: T("重命名组…"), action: function () { renameGroup(hit.group); } },
          { label: T("删除组"), danger: true, action: function () { deleteGroup(hit.group); } }
        ]
      };
      redraw(); return;
    }
    if (pointInRect(x, y, L.preset)) {
      menu = {
        x: x, y: y, w: 190, items: [
          { label: T("保存当前曲线为预设…"), action: saveCurrentAsPreset },
          { label: T("新建预设组…"), action: createGroup }
        ]
      };
      redraw(); return;
    }
  }

  function plotScale() {
    if (!L || !L.plot) return { sx: 1, sy: 1 };
    var v = L.plot.view;
    return { sx: L.plot.w / (v.x1 - v.x0), sy: L.plot.h / (v.y1 - v.y0) };
  }
  function screenToCurve(x, y) {
    if (!L || !L.plot) return null;
    var p = L.plot, v = p.view;
    // Deliberately map points outside the plot too: overshoot handles can be dragged past the
    // plot edge and the drag should continue smoothly.
    return {
      x: v.x0 + (x - p.x) / p.w * (v.x1 - v.x0),
      y: v.y0 + (p.y + p.h - y) / p.h * (v.y1 - v.y0)
    };
  }

  // preset drag & drop
  function computePresetDrop(x, y, group) {
    var pl = L.presetLayout, rows = pl.rows, best = null, bestDist = 1e9, i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.group !== group) continue;
      var mid = r.rect.y + r.rect.h / 2;
      var d = Math.abs(y - mid);
      if (d < bestDist) { bestDist = d; best = { group: group, index: r.index, y: y < mid ? r.rect.y : r.rect.y + r.rect.h + 2 }; }
    }
    return best;
  }
  function applyPresetDrop(drag) {
    var drop = drag.drop;
    if (!drop) return;
    var group = drop.group, list = group.presets, from = -1, i;
    for (i = 0; i < list.length; i++) if (list[i] === drag.preset) { from = i; break; }
    if (from < 0) return;
    var to = clamp(drop.index, 0, list.length);
    list.splice(from, 1);
    if (to > from) to--;
    to = clamp(to, 0, list.length);
    list.splice(to, 0, drag.preset);
  }

  // Import 3+ selected keys as multi-point keyframe points (each point = one keyframe).
  function importMultiPoints() {
    var keyed = selectedKeyed(), p = null, keys = null, i, j;
    for (i = 0; i < keyed.length; i++) {
      if (keyed[i].keys.length >= 3) { p = keyed[i].prop; keys = keyed[i].keys; break; }
    }
    if (!p) return false;
    var t0 = p.keyTime(keys[0]), t1 = p.keyTime(keys[keys.length - 1]);
    if (!(t1 > t0)) return false;
    var v0 = p.keyValue(keys[0]), v1 = p.keyValue(keys[keys.length - 1]);
    var dim = 0, best = -1;
    if (v0 instanceof Array) {
      for (j = 0; j < Math.min(v0.length, v1.length); j++) {
        var sp = Math.abs((v1[j] || 0) - (v0[j] || 0));
        if (sp > best) { best = sp; dim = j; }
      }
      if (best <= 1e-9) return false;
    } else if (Math.abs(v1 - v0) <= 1e-9) return false;
    var pts = [], outside = false;
    for (j = 0; j < keys.length; j++) {
      var tt = p.keyTime(keys[j]), vv = p.keyValue(keys[j]);
      var y;
      if (v0 instanceof Array) y = ((vv[dim] || 0) - (v0[dim] || 0)) / ((v1[dim] || 0) - (v0[dim] || 0));
      else y = (vv - v0) / (v1 - v0);
      if (!isFinite(y)) return false;
      if (y < 0 || y > 1) outside = true;
      pts.push({ x: clamp((tt - t0) / (t1 - t0), 0, 1), y: y, hIn: null, hOut: null, smooth: false });
    }
    pts[0].x = 0; pts[pts.length - 1].x = 1;
    S.anchors = pts;
    ensureMultiHandles(S.anchors);
    S.selectedAnchor = 0;
    if (outside) S.allowOvershoot = true;
    if (!S.allowOvershoot) clampAllAnchors();
    saveState();
    status(TR("已读取 " + pts.length + " 个关键帧作为多点曲线（每个点=一个关键帧）",
      "Imported " + pts.length + " keyframes as a multi-point curve (each point is a keyframe)"));
    redraw();
    return true;
  }
  function importCurve() {
    // 3+ selected keys -> import their value curve as multi-point keyframes.
    if (importMultiPoints()) return;
    var c = captureCurve();
    if (!c) {
      st("读取失败：请选中两个相邻、值有变化的关键帧（Hold 不算；3 个以上会导入多点关键帧曲线）",
        "Import failed: select two adjacent keys with different values (Hold excluded; 3+ keys import as a multi-point curve)");
      return;
    }
    S.anchors = anchorsFromSegment(c.x1, c.y1, c.x2, c.y2);
    S.selectedAnchor = 0;
    var outside = c.y1 < 0 || c.y1 > 1 || c.y2 < 0 || c.y2 > 1;
    if (outside) S.allowOvershoot = true;
    if (!S.allowOvershoot) clampAllAnchors();
    saveState();
    status(en()
      ? "Read " + (c.count > 1 ? "the average of " : "") + c.count + " adjacent key pair" + (c.count === 1 ? "" : "s") + (outside ? " (values outside the boundary)" : "")
      : "已读取 " + c.count + " 组相邻关键帧的" + (c.count > 1 ? "平均" : "") + "曲线" + (outside ? "（含超出边界的值）" : ""));
    redraw();
  }

  // ---------------------------------------------------------------- window
  // The script no longer paints a full-canvas background: the host's panel colour shows through,
  // so the panel matches EffectCraft's interface (including its theme and brightness).
  function drawResize(g) {
    if (embedded) return;
    var W = L.W, H = L.H;
    var hotE = hoverId === "resize:e", hotS = hoverId === "resize:s", hotSE = hoverId === "resize:se";
    if (hotE || hotSE) line(g, W - 1.5, 10, W - 1.5, H - 10, withAlpha(P.primary, 0.7), 1);
    if (hotS || hotSE) line(g, 10, H - 1.5, W - 10, H - 1.5, withAlpha(P.primary, 0.7), 1);
    var col = hotSE ? P.primary : withAlpha(P.faint, 0.8);
    var i;
    for (i = 0; i < 3; i++) {
      line(g, W - 14 + i * 5, H - 6, W - 6, H - 14 + i * 5, col, 1);
    }
  }
  function drawDraggedPreset(g) {
    if (!draggedPreset) return;
    var x = draggedPreset.x - 40, y = draggedPreset.y - 18, w = 220, h = 38;
    fillRound(g, x, y, w, h, 19, withAlpha(P.highest, 0.97));
    textBox(g, presetDisplayName(draggedPreset.preset), x + 14, y, w - 80, h, 11, P.text, "left", "REGULAR");
    miniCurve(g, draggedPreset.preset.anchors, x + w - 62, y + 8, 48, 22, P.primary);
  }

  function onDraw() {
    var g = this.graphics, W = this.size.width, H = this.size.height;
    L = buildLayout(g, W, H);
    drawEditor(g, L);
    drawFunction(g, L);
    drawPresets(g, L);
    drawResize(g);
    drawDraggedPreset(g);
    drawMenu(g);
  }

  function bindCanvas(c) {
    canvas = c;
    c.alignment = ["fill", "fill"];
    c.onDraw = onDraw;
    c.addEventListener("mousedown", canvasMouseDown);
    c.addEventListener("mousemove", canvasMouseMove);
    c.addEventListener("mouseup", canvasMouseUp);
    c.addEventListener("mouseout", function () {
      if (drag) {
        // Never leave a resize/scroll drag alive after the pointer leaves the canvas: that made
        // the border keep moving on plain hover once the mouseup happened outside.
        if (drag.kind === "resize" && win) { S.size = [win.size.width, win.size.height]; saveState(); }
        else if (drag.kind === "scrollbar" || drag.kind === "presetPan") saveState();
        else if (drag.kind === "handle" || drag.kind === "anchor") { endLiveGroup(); liveMode = false; }
        else if (drag.kind === "group") draggedGroup = null;
        drag = null; pressedId = null; hoverId = null; redraw(true);
        return;
      }
      hoverId = null; redraw();
    });
  }
  function openEditor() {
    if (editorOpen && win) { try { win.show(); } catch (e) {} return; }
    refreshTheme();
    loadState();
    embedded = false;
    // Native OS resizing is disabled: the host changes the outer window without updating the
    // ScriptUI canvas, which left a large blank strip. Resizing goes through the custom edges.
    win = new Window("palette", "KCurve " + KCURVE_VERSION + " · " + T("缓动曲线"), undefined, { resizeable: false });
    win.orientation = "stack";
    win.alignChildren = ["fill", "fill"];
    win.margins = 0;
    win.spacing = 0;
    win.size = [S.size[0], S.size[1]];
    bindCanvas(win.add("panel", undefined, undefined, { name: "canvas" }));
    win.onClose = function () { stopSpinTask(); endLiveGroup(); saveState(); editorOpen = false; win = null; return true; };
    win.show();
    editorOpen = true;
    win.layout.layout(true);
    // If the host restored an outer window wider than the actual ScriptUI canvas (seen after
    // native-window resizes), shrink the outer window to the canvas so no blank strip remains.
    try {
      var cw = canvas.size ? canvas.size.width : 0, chh = canvas.size ? canvas.size.height : 0;
      if (cw > 0 && chh > 0 && (Math.abs(cw - win.size.width) > 1 || Math.abs(chh - win.size.height) > 1)) {
        win.size = [cw, chh];
        win.layout.layout(true);
      }
    } catch (e) {}
    canvas.notify("onDraw");
    statusText = T("选择关键帧 · 拖曲线 · 点 √ 写入");
    startSpinTask();
    redraw();
  }

  function buildPanelLauncher(panel) {
    // The installed ScriptUI panel is the fixed-size editor itself. 0.13 does not expose the
    // real docked area to onDraw, so the panel is designed for exactly 440x700; if the dock is
    // smaller the host shows its own scroll area, if larger the window keeps this fixed canvas.
    embedded = true;
    win = null;
    refreshTheme();
    loadState();
    panel.orientation = "stack";
    panel.alignChildren = ["fill", "fill"];
    panel.margins = 0;
    panel.spacing = 0;
    try { panel.preferredSize = [FIXED_W, FIXED_H]; } catch (e) {}
    try { panel.minimumSize = [FIXED_W, FIXED_H]; } catch (e) {}
    var c = panel.add("panel", undefined, undefined, { name: "canvas" });
    try { c.preferredSize = [FIXED_W, FIXED_H]; } catch (e) {}
    bindCanvas(c);
    panel.layout.layout(true);
    statusText = T("选择关键帧 · 拖曲线 · 点 √ 写入");
    redraw(true);
    editorOpen = true;
  }

  try {
    if (IS_PANEL) buildPanelLauncher(thisObj);
    else openEditor();
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (e && e.line !== undefined) msg += " @" + e.line + ":" + e.column;
    try { alert("KCurve: " + msg); } catch (e2) {}
  }
})(this);


