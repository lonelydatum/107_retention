import { downloadBlob, safeFilename, sizeFromType } from "./utils.js";

function downscaleCanvasHalf(srcCanvas) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(srcCanvas.width / 2));
  out.height = Math.max(1, Math.round(srcCanvas.height / 2));

  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(srcCanvas, 0, 0, out.width, out.height);
  return out;
}

// draw image into canvas preserving aspect ratio
function drawContain(ctx, img, cw, ch, iw, ih) {
  const s = Math.min(cw / iw, ch / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dx, dy, dw, dh);
}

async function exportJpegUnderLimit(canvas, maxKB = 50) {
  const maxBytes = maxKB * 1024;
  const toBlobQ = (q) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));

  let blob = await toBlobQ(0.95);
  if (blob && blob.size <= maxBytes) return blob;

  let lo = 0.35;
  let hi = 0.95;
  let best = null;

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const b = await toBlobQ(mid);
    if (!b) break;

    if (b.size <= maxBytes) {
      best = b;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return best || (await toBlobQ(0.35));
}

async function ensureHtml2Canvas(doc, win) {
  if (win.html2canvas) return;
  await new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    s.onload = resolve;
    s.onerror = reject;
    doc.head.appendChild(s);
  });
}

async function inlineSvgToPng(doc, win) {
  const svgs = Array.from(doc.querySelectorAll("svg"));
  if (!svgs.length) return;

  const dpr = Math.max(1, win.devicePixelRatio || 1);

  await Promise.all(
    svgs.map(
      (svg) =>
        new Promise((resolve) => {
          try {
            const rect = svg.getBoundingClientRect();
            const cssW = Math.max(1, rect.width);
            const cssH = Math.max(1, rect.height);
            if (cssW <= 1 || cssH <= 1) return resolve();

            // Make sure xmlns exists (Safari can be picky)
            if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

            const xml = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
              try {
                const canvas = doc.createElement("canvas");

                // Backing store at DPR
                canvas.width = Math.round(cssW * dpr);
                canvas.height = Math.round(cssH * dpr);

                const ctx = canvas.getContext("2d");

                // Draw in CSS pixels (map CSS px -> device px)
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                // Use viewBox size if present (keeps aspect correct)
                let iw = cssW,
                  ih = cssH;
                const vb = svg.viewBox && svg.viewBox.baseVal;
                if (vb && vb.width && vb.height) {
                  iw = vb.width;
                  ih = vb.height;
                }

                drawContain(ctx, img, cssW, cssH, iw, ih);

                const replacement = doc.createElement("img");
                replacement.src = canvas.toDataURL("image/png");

                const cs = win.getComputedStyle(svg);
                Object.assign(replacement.style, {
                  width: cs.width,
                  height: cs.height,
                  position: cs.position,
                  left: cs.left,
                  top: cs.top,
                  right: cs.right,
                  bottom: cs.bottom,
                  transform: cs.transform,
                  transformOrigin: cs.transformOrigin,
                  display: cs.display,
                  zIndex: cs.zIndex,
                  pointerEvents: "none",
                  objectFit: "contain",
                  objectPosition: "center",
                });

                svg.replaceWith(replacement);
              } catch {}
              URL.revokeObjectURL(url);
              resolve();
            };

            img.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };

            // Important: decode sync-ish helps Safari sometimes
            img.decoding = "sync";
            img.src = url;
          } catch {
            resolve();
          }
        }),
    ),
  );
}

async function rasterizeSVGImages(doc, win) {
  const imgs = Array.from(doc.querySelectorAll("img[src$='.svg'], img[src*='.svg?']"));
  if (!imgs.length) return;

  const dpr = Math.max(1, win.devicePixelRatio || 1);

  await Promise.all(
    imgs.map(
      (imgEl) =>
        new Promise((resolve) => {
          try {
            const r = imgEl.getBoundingClientRect();
            const cssW = Math.max(1, r.width || 100);
            const cssH = Math.max(1, r.height || 100);

            const canvas = doc.createElement("canvas");
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);

            const ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const tmp = new Image();
            tmp.crossOrigin = "anonymous";
            tmp.onload = () => {
              const iw = Math.max(1, tmp.naturalWidth || cssW);
              const ih = Math.max(1, tmp.naturalHeight || cssH);
              drawContain(ctx, tmp, cssW, cssH, iw, ih);

              imgEl.src = canvas.toDataURL("image/png");
              imgEl.style.objectFit = "contain";
              imgEl.style.objectPosition = "center";
              resolve();
            };
            tmp.onerror = () => resolve();
            tmp.decoding = "sync";
            tmp.src = imgEl.src;
          } catch {
            resolve();
          }
        }),
    ),
  );
}

function parseTranslateScale(transform) {
  if (!transform || transform === "none") return { x: 0, y: 0, scaleX: 1, scaleY: 1 };

  const matrix = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrix) {
    const parts = matrix[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return {
      x: parts[4] || 0,
      y: parts[5] || 0,
      scaleX: parts[0] || 1,
      scaleY: parts[3] || 1,
    };
  }

  const translate = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  const scale = transform.match(/scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/);

  return {
    x: translate ? Number.parseFloat(translate[1]) : 0,
    y: translate ? Number.parseFloat(translate[2]) : 0,
    scaleX: scale ? Number.parseFloat(scale[1]) : 1,
    scaleY: scale ? Number.parseFloat(scale[2] || scale[1]) : 1,
  };
}

async function rasterizeYpyGroups(doc, win) {
  const groups = Array.from(doc.querySelectorAll(".ypy-all"));
  if (!groups.length) return;

  const dpr = Math.max(1, win.devicePixelRatio || 1);

  await Promise.all(
    groups.map(async (group) => {
      const slots = Array.from(group.querySelectorAll(".ypy_all"));
      if (!slots.length) return;

      const slotRects = slots.map((slot) => slot.getBoundingClientRect()).filter((rect) => rect.width > 1 && rect.height > 1);
      if (!slotRects.length) return;

      const bounds = {
        left: Math.min(...slotRects.map((rect) => rect.left)),
        top: Math.min(...slotRects.map((rect) => rect.top)),
        right: Math.max(...slotRects.map((rect) => rect.right)),
        bottom: Math.max(...slotRects.map((rect) => rect.bottom)),
      };
      const rect = {
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      };
      if (rect.width <= 1 || rect.height <= 1) return;

      const canvas = doc.createElement("canvas");
      canvas.width = Math.ceil(rect.width * dpr);
      canvas.height = Math.ceil(rect.height * dpr);

      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      for (const slot of slots) {
        const img = slot.querySelector("img");
        if (!img || !img.complete || !img.naturalWidth) continue;

        const slotRect = slot.getBoundingClientRect();
        const imgTransform = parseTranslateScale(win.getComputedStyle(img).transform);
        const slotTransform = parseTranslateScale(win.getComputedStyle(slot).transform);

        const dx = slotRect.left - rect.left + imgTransform.x * slotTransform.scaleX;
        const dy = slotRect.top - rect.top + imgTransform.y * slotTransform.scaleY;
        const dw = img.naturalWidth * imgTransform.scaleX * slotTransform.scaleX;
        const dh = img.naturalHeight * imgTransform.scaleY * slotTransform.scaleY;

        ctx.save();
        ctx.beginPath();
        ctx.rect(slotRect.left - rect.left, slotRect.top - rect.top, slotRect.width, slotRect.height);
        ctx.clip();
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      }

      const replacement = doc.createElement("img");
      replacement.src = canvas.toDataURL("image/png");

      const cs = win.getComputedStyle(group);
      const bannerRect = (doc.querySelector("#banner") || group.parentElement).getBoundingClientRect();
      Object.assign(replacement.style, {
        position: "absolute",
        left: `${rect.left - bannerRect.left}px`,
        top: `${rect.top - bannerRect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        transform: "none",
        transformOrigin: cs.transformOrigin,
        display: cs.display,
        zIndex: cs.zIndex,
        pointerEvents: "none",
      });

      group.replaceWith(replacement);
    }),
  );
}

export function makeScreenshotHandler({ iframe, getSelection }) {
  return async function () {
    const sel = getSelection();
    if (!sel) return;

    const { group, item } = sel;

    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) throw new Error("iframe not ready");

      await ensureHtml2Canvas(doc, win);

      // make image URLs absolute
      doc.querySelectorAll("img[src]").forEach((img) => {
        const raw = img.getAttribute("src");
        if (!raw || /^(data:|https?:|blob:)/i.test(raw)) return;
        img.src = new URL(raw, doc.location.href).href;
      });

      const target =
        doc.querySelector("#banner") || doc.querySelector("#ad") || doc.querySelector(".banner") || doc.body;

      await new Promise((r) => win.requestAnimationFrame(r));
      await inlineSvgToPng(doc, win);
      await rasterizeSVGImages(doc);
      await rasterizeYpyGroups(doc, win);

      const canvas = await win.html2canvas(target, {
        backgroundColor: "#00c853",
        scale: Math.max(1, win.devicePixelRatio || 1),
        useCORS: true,
      });

      // ✅ reduce back to half before encoding
      const halfCanvas = downscaleCanvasHalf(canvas);

      const blob = await exportJpegUnderLimit(halfCanvas, 48);
      if (!blob) throw new Error("encode failed");

      const { w, h } = sizeFromType(item.type);
      const name = safeFilename(item.path || group.title || "banner");
      const filename = `${name}.jpg`;

      downloadBlob(blob, filename);
    } catch (e) {
      console.error(e);
      alert("Screenshot failed — check console for details.");
    }
  };
}
