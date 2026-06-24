export const DEPLOY_DIR = "deploy";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(s) {
  return String(s || "")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sizeFromType(type) {
  if (type && typeof type === "object" && Number.isFinite(type.w) && Number.isFinite(type.h)) {
    return { w: type.w, h: type.h };
  }
  switch (type) {
    case "SS":
      return { w: 160, h: 600 };
    case "BB":
      return { w: 300, h: 250 };
    case "DBB":
      return { w: 300, h: 600 };
    case "LB":
      return { w: 728, h: 90 };
    default:
      return { w: 300, h: 250 };
  }
}

export function clampIndex(n, max) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, max));
}

// hash format: #/<bannerGroupIndex>/<sizeIndex>
export function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  return {
    bannerGroupIndex: parseInt(parts[0] || "0", 10),
    sizeIndex: parseInt(parts[1] || "0", 10),
  };
}

export function setHash(gi, si) {
  location.hash = `#/${gi}/${si}`;
}

export function bannerSrc(path) {
  const safe = String(path || "").replace(/^\//, "");
  if (!safe) return null;
  return `${DEPLOY_DIR}/${safe}/index.html`;
}

export function zipSrc(path) {
  const safe = String(path || "").replace(/^\//, "");
  if (!safe) return null;
  return `zip/${safe}.zip`;
}
