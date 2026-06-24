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
