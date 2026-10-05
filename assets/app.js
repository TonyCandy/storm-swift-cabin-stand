/* 聚合搜索 · 静态版
   数据来源：与本页面同目录的 关键词表.csv + 搜索引擎表.csv（建议 UTF-8，兼容 GBK 自动回退）
   更新数据：替换服务器上的 CSV 文件 → 浏览器按 F5 重新加载即可，无需任何服务端程序。
   CSV 解析逻辑与原项目 src/lib/catalog.ts 完全一致。 */

(function () {
  "use strict";

  const CSV_KEYWORDS = "关键词表.csv";
  const CSV_SITES = "搜索引擎表.csv";

  /* ---------- CSV 解析（与原 catalog.ts 同一套逻辑） ---------- */

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    const s = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c !== "\r") {
        cur += c;
      }
    }
    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim()));
  }

  function safeHttpUrl(value) {
    const t = value.trim();
    if (!t) return "";
    try {
      const u = new URL(t);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      return "";
    }
    return "";
  }

  function looksLikeUrl(value) {
    return Boolean(safeHttpUrl(value));
  }

  function findCol(headers, pattern) {
    return headers.findIndex((h) => pattern.test(h));
  }

  function parseWorkCell(cell) {
    const t = cell.trim();
    if (!t) return null;
    const pipe = t.lastIndexOf("|");
    if (pipe > 0) {
      const title = t.slice(0, pipe).trim();
      const url = safeHttpUrl(t.slice(pipe + 1));
      if (title && url) return { title, url };
    }
    const url = safeHttpUrl(t);
    if (url) return { title: "作品", url };
    return null;
  }

  function parsePeople(csv) {
    const rows = parseCsv(csv);
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim());
    const headerJoined = headers.join(" ");
    const hasHeader = /名字|关键词|keyword|name|头像/i.test(headerJoined);
    const data = hasHeader ? rows.slice(1) : rows;

    let nameIdx = findCol(headers, /名字|关键词|keyword|^name$/i);
    let avatarIdx = findCol(headers, /头像|avatar|图片/i);
    let regionIdx = findCol(headers, /地区|区域|国家/);
    let bodyIdx = findCol(headers, /体型|身材/);
    if (!hasHeader || nameIdx < 0) nameIdx = 0;
    if (!hasHeader && avatarIdx < 0) avatarIdx = 1;

    const workIdx = headers
      .map((h, i) => (/作品/.test(h) ? i : -1))
      .filter((i) => i >= 0);

    const reserved = new Set(
      [nameIdx, avatarIdx, regionIdx, bodyIdx, ...workIdx].filter((i) => i >= 0),
    );
    const socialIdx = headers
      .map((h, i) => ({ h, i }))
      .filter(({ i }) => !reserved.has(i));

    const seen = new Set();
    const out = [];
    for (const r of data) {
      const name = (r[nameIdx] ?? "").trim();
      if (!name || looksLikeUrl(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const avatarRaw = avatarIdx >= 0 ? (r[avatarIdx] ?? "").trim() : "";
      const region = regionIdx >= 0 ? (r[regionIdx] ?? "").trim() : "";
      const body = bodyIdx >= 0 ? (r[bodyIdx] ?? "").trim() : "";

      const socials = [];
      for (const { h, i } of socialIdx) {
        const url = safeHttpUrl(r[i] ?? "");
        const label = h.replace(/（.*?）|\(.*?\)/g, "").trim();
        if (url && label) socials.push({ label, url });
      }

      const works = [];
      for (const i of workIdx) {
        const work = parseWorkCell(r[i] ?? "");
        if (work) works.push(work);
      }

      out.push({ name, avatar: safeHttpUrl(avatarRaw), region, body, socials, works });
    }
    return out;
  }

  function parseSites(csv) {
    const rows = parseCsv(csv);
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim());
    const headerLooksLikeData =
      looksLikeUrl(headers[1] ?? "") || looksLikeUrl(headers[0] ?? "");
    const data = headerLooksLikeData ? rows : rows.slice(1);
    const out = [];
    const seen = new Set();
    for (const r of data) {
      const a = (r[0] ?? "").trim();
      const b = (r[1] ?? "").trim();
      let name = a;
      let template = b;
      if (looksLikeUrl(a) && !looksLikeUrl(b)) {
        name = b || a;
        template = a;
      }
      if (!name || !looksLikeUrl(template)) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, template });
    }
    return out;
  }

  function buildSearchUrl(template, query) {
    const encoded = encodeURIComponent(query);
    return template
      .replaceAll("%7Bq%7D", encoded)
      .replaceAll("%7bq%7d", encoded)
      .replaceAll("{q}", encoded)
      .replaceAll("{Q}", encoded);
  }

  function initials(name) {
    const t = name.trim();
    if (!t) return "?";
    if (/[\u4e00-\u9fff]/.test(t)) return t.slice(0, 2);
    const parts = t.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return t.slice(0, 2).toUpperCase();
  }

  /* ---------- 数据加载 ---------- */

  function decodeText(buf) {
    // 兼容两种 UTF-8 文件：带 BOM（UTF-8 with BOM，WPS/Excel 另存常见）与纯 UTF-8（无 BOM）
    // 检测到 EF BB BF 开头时跳过 BOM 字节，避免 \uFEFF 混入表头/首行
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      start = 3;
    }
    // 优先按 UTF-8 严格解码；失败时回退 GBK（Excel 另存的常见编码）
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
    } catch {
      return new TextDecoder("gbk").decode(bytes.subarray(start));
    }
  }

  async function loadCsv(path) {
    // cache: no-store —— 保证按 F5 时总是重新向服务器要最新的 CSV
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return decodeText(await res.arrayBuffer());
  }

  /* ---------- 状态 ---------- */

  const state = {
    people: [],
    sites: [],
    query: "",
    region: "all",
    body: "all",
    works: "all",
    errors: [],
  };

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    );
  }

  const $status = document.getElementById("status");
  const $list = document.getElementById("list");
  const $warning = document.getElementById("warning");
  const $warningText = document.getElementById("warning-text");
  const $q = document.getElementById("q");

  function filteredPeople() {
    const q = state.query.trim().toLowerCase();
    return state.people.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (state.region !== "all" && p.region !== state.region) return false;
      if (state.body !== "all" && p.body !== state.body) return false;
      if (state.works === "yes" && p.works.length === 0) return false;
      if (state.works === "no" && p.works.length > 0) return false;
      return true;
    });
  }

  /* ---------- 渲染 ---------- */

  function renderStatus(count) {
    $status.textContent =
      count + "/" + state.people.length + " · " + state.sites.length + " 站点";
  }

  function renderWarning() {
    // 只在 CSV 真正读取失败时才显示警告条，正常情况保持隐藏
    if (!state.errors.length) {
      $warning.hidden = true;
      return;
    }
    const tips = state.errors.slice();
    if (location.protocol === "file:") {
      tips.push(
        "当前是双击打开（file://）模式，浏览器禁止读取本地 CSV。请把本文件夹放到任意静态服务器上访问（如 IIS / nginx / 宝塔 / python -m http.server）。",
      );
    } else {
      tips.push("请确认 CSV 文件与本页面在同一目录，且已保存为 UTF-8 编码。");
    }
    $warningText.textContent = tips.join(" ");
    $warning.hidden = false;
  }

  function renderFilterGroup(containerId, label, options, current, onPick) {
    const box = document.getElementById(containerId);
    box.innerHTML = "";
    const span = document.createElement("span");
    span.className = "flabel";
    span.textContent = label;
    box.appendChild(span);
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn" + (current === opt.id ? " active" : "");
      btn.textContent = opt.text;
      btn.addEventListener("click", () => {
        onPick(opt.id);
        renderFilters();
        renderList();
      });
      box.appendChild(btn);
    }
  }

  function renderFilters() {
    const regionOptions = uniqueSorted(state.people.map((p) => p.region));
    const bodyOptions = uniqueSorted(state.people.map((p) => p.body));

    renderFilterGroup(
      "f-region",
      "地区",
      [{ id: "all", text: "全部" }, ...regionOptions.map((r) => ({ id: r, text: r }))],
      state.region,
      (id) => (state.region = id),
    );
    renderFilterGroup(
      "f-body",
      "体型",
      [{ id: "all", text: "全部" }, ...bodyOptions.map((r) => ({ id: r, text: r }))],
      state.body,
      (id) => (state.body = id),
    );
    renderFilterGroup(
      "f-works",
      "作品",
      [
        { id: "all", text: "全部" },
        { id: "yes", text: "有作品" },
        { id: "no", text: "无作品" },
      ],
      state.works,
      (id) => (state.works = id),
    );
  }

  function personHtml(p) {
    const meta = [p.region, p.body].filter(Boolean).join(" · ");
    const socials = p.socials
      .map(
        (s) =>
          '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(s.label) +
          "</a>",
      )
      .join("");
    const works = p.works
      .map(
        (w) =>
          '<a class="work-chip" href="' + esc(w.url) + '" target="_blank" rel="noopener noreferrer">' +
          "<span>" + esc(w.title) + "</span></a>",
      )
      .join("");
    const engines = state.sites
      .map(
        (s) =>
          '<a class="engine-btn" href="' + esc(buildSearchUrl(s.template, p.name)) +
          '" target="_blank" rel="noopener noreferrer" title="' + esc(s.name) + '">' +
          "<span>" + esc(s.name) + "</span></a>",
      )
      .join("");
    const avatarImg = p.avatar
      ? '<img src="' + esc(p.avatar) + '" alt="" loading="lazy" onerror="this.remove()" />'
      : "";

    return (
      '<article class="person">' +
      '<div class="p-id">' +
      '<span class="avatar"><span class="fallback">' + esc(initials(p.name)) + "</span>" + avatarImg + "</span>" +
      '<div class="p-info">' +
      '<h2 class="p-name">' + esc(p.name) + "</h2>" +
      (meta ? '<p class="p-meta">' + esc(meta) + "</p>" : "") +
      (socials ? '<div class="socials">' + socials + "</div>" : "") +
      "</div></div>" +
      '<div class="p-works">' + works + "</div>" +
      '<div class="p-engines">' + engines + "</div>" +
      "</article>"
    );
  }

  function renderList() {
    const list = filteredPeople();
    renderStatus(list.length);
    if (!list.length) {
      const failed = state.errors.length > 0;
      $list.innerHTML =
        '<div class="empty"><p class="t">' +
        (failed ? "数据加载失败" : "没有匹配的人物") +
        '</p><p class="s">' +
        (failed
          ? "请检查 CSV 文件后按 F5 重新加载。"
          : "换个筛选条件，或清空搜索。") +
        "</p></div>";
      return;
    }
    $list.innerHTML = list.map(personHtml).join("");
  }

  /* ---------- 启动 ---------- */

  async function init() {
    $q.addEventListener("input", () => {
      state.query = $q.value;
      renderList();
    });

    const [kwRes, stRes] = await Promise.allSettled([
      loadCsv(CSV_KEYWORDS),
      loadCsv(CSV_SITES),
    ]);

    if (kwRes.status === "fulfilled") {
      state.people = parsePeople(kwRes.value);
      if (!state.people.length) {
        state.errors.push("「关键词表.csv」为空或格式不对。");
      }
    } else {
      state.errors.push(
        "无法读取「关键词表.csv」（" + (kwRes.reason?.message || "未知错误") + "）。",
      );
    }

    if (stRes.status === "fulfilled") {
      state.sites = parseSites(stRes.value);
      if (!state.sites.length) {
        state.errors.push("「搜索引擎表.csv」为空或格式不对。");
      }
    } else {
      state.errors.push(
        "无法读取「搜索引擎表.csv」（" + (stRes.reason?.message || "未知错误") + "）。",
      );
    }

    renderWarning();
    renderFilters();
    renderList();
  }

  init();
})();
