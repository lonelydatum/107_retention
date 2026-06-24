// import { data } from "./data.js";
import { sizeFromType, clampIndex, parseHash, setHash, bannerSrc, zipSrc } from "./utils.js";
import { makeScreenshotHandler } from "./screenshot.js";

// (function normalizeUrl() {
//   const clean = window.location.origin + window.location.pathname;
//   console.log(clean, window.location.href);

//   if (window.location.href !== clean) {
//     history.replaceState(null, "", clean);
//   }
// })();

function mount() {
  const root = document.getElementById("app");
  root.innerHTML = "";

  const state = { group: null, item: null };

  const app = document.createElement("div");
  app.className = "app";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  const title = document.createElement("h1");
  title.className = "title";
  title.textContent = data.title || "BANNERS";
  sidebar.appendChild(title);

  const preview = document.createElement("main");
  preview.className = "preview";

  const previewMeta = document.createElement("div");
  previewMeta.className = "meta";
  preview.appendChild(previewMeta);

  const previewInner = document.createElement("div");
  previewInner.className = "preview-inner";
  preview.appendChild(previewInner);

  const frameWrap = document.createElement("div");
  frameWrap.className = "frame-wrap";
  previewInner.appendChild(frameWrap);

  const iframe = document.createElement("iframe");
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer";
  frameWrap.appendChild(iframe);

  const below = document.createElement("div");
  below.className = "below";
  previewInner.appendChild(below);

  const btnShot = document.createElement("button");
  btnShot.textContent = "screenshot";
  btnShot.className = "btn-shot";
  if (window.location.host.includes("localhost")) {
    below.appendChild(btnShot);
  }
  btnShot.style.display = "block";
  const dl = document.createElement("a");
  dl.textContent = "download zip file";
  dl.target = "_blank";
  dl.rel = "noopener";
  below.appendChild(dl);

  btnShot.addEventListener(
    "click",
    makeScreenshotHandler({
      iframe,
      getSelection: () => (state.group && state.item ? state : null),
    }),
  );

  // Sidebar sections
  const sections = [];
  data.banners.forEach((bannerGroup, gi) => {
    const section = document.createElement("section");
    section.className = "section";

    const head = document.createElement("div");
    head.className = "section-head";

    const h3 = document.createElement("h3");
    h3.textContent = bannerGroup.title || `Banner ${gi + 1}`;
    head.appendChild(h3);

    const toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = "(expand)";
    head.appendChild(toggle);

    section.appendChild(head);

    const ul = document.createElement("ul");
    ul.className = "sizes";

    bannerGroup.list.forEach((item, si) => {
      const li = document.createElement("li");
      li.className = "size-item";
      li.textContent = item.title || `Size ${si + 1}`;

      const hasPath = !!item.path;

      if (!hasPath) {
        li.classList.add("disabled");
        li.title = "Not available";
      } else {
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          setHash(gi, si);
        });
      }

      ul.appendChild(li);
    });

    section.appendChild(ul);

    head.addEventListener("click", () => {
      const isOpen = section.classList.toggle("open");
      toggle.textContent = isOpen ? "(collapse)" : "(expand)";
    });

    sidebar.appendChild(section);
    sections.push({ section, toggle, ul });
  });

  app.appendChild(sidebar);
  app.appendChild(preview);
  root.appendChild(app);

  function renderSelection() {
    const { bannerGroupIndex, sizeIndex } = parseHash();
    const gi = clampIndex(bannerGroupIndex, data.banners.length - 1);
    const group = data.banners[gi];

    const si = clampIndex(sizeIndex, group.list.length - 1);
    const item = group.list[si];

    state.group = group;
    state.item = item;

    sections.forEach((s, idx) => {
      const open = idx === gi;
      s.section.classList.toggle("open", open);
      s.toggle.textContent = open ? "(collapse)" : "(expand)";

      [...s.ul.children].forEach((li, liIdx) => {
        li.classList.toggle("active", open && liIdx === si);
      });
    });

    const { w, h } = sizeFromType(item.type);
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;

    const src = bannerSrc(item.path);
    if (!src) {
      iframe.removeAttribute("src");
      dl.style.display = "none";
      previewMeta.innerHTML = `<b>${group.title}</b> — ${item.title} — <span style="color:#b00">Missing path</span>`;
      return;
    }

    btnShot.style.display = "";
    previewMeta.innerHTML = `<b>${group.title}</b> — <span>${w}×${h}</span>`;

    const z = zipSrc(item.path);
    dl.style.display = z ? "" : "none";
    dl.href = z || "#";

    iframe.src = `${src}?cb=${Date.now()}`;
  }

  window.addEventListener("hashchange", renderSelection);

  if (!location.hash || location.hash === "#") setHash(0, 0);
  else renderSelection();
}

document.addEventListener("DOMContentLoaded", mount);
