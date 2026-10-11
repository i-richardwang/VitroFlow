const ZOOM_MIN = 0.05;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.15;
const FIT_SLOP = 0.02;

let photos = [];
let index = 0;
let filter = "all";
let query = "";
let scale = 1;
let tx = 0;
let ty = 0;
let drag = null;

const stage = document.getElementById("stage");
const photo = document.getElementById("photo");
const note = document.getElementById("note");
const notice = document.getElementById("notice");

function suggestionText(item) {
  if (item.reason) return item.reason;
  return item.suitable ? "seeds can be counted" : "cannot be counted";
}

function standing(item) {
  const decision = item.decision;
  if (!decision) return { label: "unconfirmed", tone: "" };
  if (decision.suitable === null) return { label: "not sure", tone: "warning" };
  const tone = decision.suitable ? "success" : "error";
  if (decision.suitable === item.suitable) return { label: "accepted", tone };
  return { label: decision.suitable ? "can be counted" : "cannot be counted", tone };
}

function shown(item) {
  if (query && !item.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
  const decision = item.decision;
  if (filter === "unconfirmed") return !decision;
  if (filter === "not-sure") return !!decision && decision.suitable === null;
  if (filter === "accepted") return !!decision && decision.suitable === item.suitable;
  if (filter === "changed") return !!decision && decision.suitable !== item.suitable;
  return true;
}

function renderList() {
  const current = photos[index];
  const list = document.getElementById("list");
  list.replaceChildren();
  for (const item of photos.filter(shown)) {
    const row = document.createElement("li");
    if (current && item.index === current.index) row.className = "current";
    const img = document.createElement("img");
    img.src = "/thumb/" + item.index;
    img.alt = "";
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = suggestionText(item);
    const mark = standing(item);
    const tag = document.createElement("span");
    tag.className = "tag " + mark.tone;
    tag.textContent = mark.label;
    text.append(name, meta, tag);
    row.append(img, text);
    row.onclick = () => select(item.index);
    list.append(row);
  }
  list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  const confirmed = photos.filter((item) => item.decision).length;
  const changed = photos.filter((item) => shownChanged(item)).length;
  document.getElementById("count").textContent =
    `${confirmed} confirmed of ${photos.length}` + (changed ? `, ${changed} changed` : "");
}

function shownChanged(item) {
  return item.decision && item.decision.suitable !== item.suitable;
}

function show(item) {
  document.getElementById("suggestion").textContent = suggestionText(item);
  note.value = item.decision ? item.decision.note : "";
  document.getElementById("accept").setAttribute(
    "aria-pressed",
    item.decision && item.decision.suitable === item.suitable ? "true" : "false",
  );
  for (const button of document.querySelectorAll("#choice button[data-suitable]")) {
    const actual = item.decision ? String(item.decision.suitable) : "";
    button.setAttribute("aria-pressed", button.dataset.suitable === actual ? "true" : "false");
  }
  photo.alt = item.name;
  photo.src = "/photo/" + item.index;
  location.hash = String(item.index);
  const following = photos[index + 1];
  if (following) {
    const ahead = new Image();
    ahead.src = "/photo/" + following.index;
  }
}

function select(next) {
  if (next < 0 || next >= photos.length) return;
  index = next;
  show(photos[index]);
  renderList();
}

function move(step) {
  const rows = photos.filter(shown);
  if (!rows.length) return;
  const at = rows.findIndex((item) => item.index === index);
  const start = at < 0 ? 0 : at;
  select(rows[Math.min(rows.length - 1, Math.max(0, start + step))].index);
}

function nextOpen() {
  for (let step = 1; step <= photos.length; step++) {
    const item = photos[(index + step) % photos.length];
    if (!item.decision) {
      select(item.index);
      return;
    }
  }
}

function showEmpty(data) {
  document.getElementById("count").textContent = data.skipped
    ? `${data.skipped} skipped, none to review`
    : "No photographs";
}

function applyState(data) {
  photos = data.photos;
  if (!photos.length) {
    showEmpty(data);
    return;
  }
  if (index >= photos.length) index = 0;
  show(photos[index]);
  renderList();
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  notice.hidden = response.ok;
  if (response.ok) applyState(await response.json());
  return response.ok;
}

function write(suitable, advance) {
  post("/api/photos/" + index, { suitable, note: note.value }).then((ok) => {
    if (ok && advance) nextOpen();
  });
}

function toggle(suitable) {
  const item = photos[index];
  if (item.decision && item.decision.suitable === suitable) {
    post("/api/photos/" + index, { clear: true });
    return;
  }
  write(suitable, true);
}

function applyTransform() {
  photo.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  document.getElementById("zoom").textContent = Math.round(scale * 100) + "%";
}

function fit() {
  if (!photo.naturalWidth) return;
  scale = Math.min(
    stage.clientWidth / photo.naturalWidth,
    stage.clientHeight / photo.naturalHeight,
  );
  tx = (stage.clientWidth - photo.naturalWidth * scale) / 2;
  ty = (stage.clientHeight - photo.naturalHeight * scale) / 2;
  applyTransform();
}

function fittedScale() {
  if (!photo.naturalWidth) return 1;
  return Math.min(
    stage.clientWidth / photo.naturalWidth,
    stage.clientHeight / photo.naturalHeight,
  );
}

function zoomAt(mx, my, next) {
  next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const ratio = next / scale;
  tx = mx - (mx - tx) * ratio;
  ty = my - (my - ty) * ratio;
  scale = next;
  applyTransform();
}

photo.addEventListener("load", fit);
stage.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = stage.getBoundingClientRect();
  const step = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  zoomAt(event.clientX - rect.left, event.clientY - rect.top, scale * step);
}, { passive: false });
stage.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, tx, ty };
  stage.classList.add("dragging");
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  tx = drag.tx + event.clientX - drag.x;
  ty = drag.ty + event.clientY - drag.y;
  applyTransform();
});
function endDrag() {
  drag = null;
  stage.classList.remove("dragging");
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("dblclick", (event) => {
  if (Math.abs(scale - fittedScale()) < FIT_SLOP) {
    const rect = stage.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, 1);
  } else {
    fit();
  }
});

document.getElementById("fit").onclick = fit;
document.getElementById("actual").onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1);
document.getElementById("prev").onclick = () => move(-1);
document.getElementById("next").onclick = () => move(1);
document.getElementById("choice").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const item = photos[index];
  if (!item) return;
  const suitable = button.id === "accept"
    ? item.suitable
    : button.dataset.suitable === "null" ? null : button.dataset.suitable === "true";
  toggle(suitable);
};
document.getElementById("accept-all").onclick = () => post("/api/accept-remaining", {});
note.addEventListener("change", () => {
  const item = photos[index];
  if (!item || !item.decision) return;
  write(item.decision.suitable, false);
});
document.getElementById("q").addEventListener("input", (event) => {
  query = event.target.value;
  renderList();
});
document.getElementById("filters").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  filter = button.dataset.filter;
  for (const other of document.querySelectorAll("#filters button")) {
    other.setAttribute("aria-pressed", other === button ? "true" : "false");
  }
  renderList();
};
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  const item = photos[index];
  if (!item) return;
  if (event.key === "ArrowLeft") move(-1);
  else if (event.key === "ArrowRight") move(1);
  else if (event.key === "a") toggle(item.suitable);
  else if (event.key === "1") write(true, true);
  else if (event.key === "2") write(false, true);
  else if (event.key === "3") write(null, true);
  else if (event.key === "f") fit();
});
window.addEventListener("resize", fit);
window.addEventListener("hashchange", () => {
  const wanted = Number(location.hash.slice(1));
  if (Number.isInteger(wanted) && wanted !== index) select(wanted);
});

fetch("/api/review").then((response) => response.json()).then((data) => {
  photos = data.photos;
  if (!photos.length) {
    showEmpty(data);
    return;
  }
  const wanted = Number(location.hash.slice(1));
  const pending = photos.findIndex((item) => !item.decision);
  select(Number.isInteger(wanted) && photos[wanted] ? wanted : (pending < 0 ? 0 : pending));
});
