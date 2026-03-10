from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Protocol, cast

from .auth import log


_RECORDER_STORAGE_KEY = "EF_RECORDER_EVENTS_V1"
_RECORDER_KEEP_LAST = 20


class _RecorderDriver(Protocol):
    def execute_cdp_cmd(self, cmd: str, cmd_args: dict[str, Any]) -> Any: ...

    def execute_script(self, script: str, *args: Any) -> Any: ...

    def get(self, url: str) -> Any: ...

    def get_screenshot_as_png(self) -> bytes: ...


def _recorder_js_source() -> str:
    # Notes:
    # - Uses localStorage to persist across navigations on same origin.
    # - Masks password-like fields.
    # - Records click + change (not per-keystroke input) to reduce noise.
    storage_key_json = json.dumps(_RECORDER_STORAGE_KEY)
    js = r"""
(function () {
  const STORAGE_KEY = __STORAGE_KEY__;
  const MAX_EVENTS = 2000;
  // Tuned defaults (richer context; still controlled by cleanup).
  const SNAPSHOT_EVERY = 5;
  const DEDUPE_WINDOW_MS = 1200;

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function loadEvents() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveEvents(events) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch (e) {
      // ignore
    }
  }

  function isPasswordField(el) {
    if (!el) return false;
    const t = (el.getAttribute && el.getAttribute('type')) ? String(el.getAttribute('type')).toLowerCase() : "";
    if (t === 'password') return true;
    const n = (el.getAttribute && el.getAttribute('name')) ? String(el.getAttribute('name')).toLowerCase() : "";
    const id = (el.getAttribute && el.getAttribute('id')) ? String(el.getAttribute('id')).toLowerCase() : "";
    const a = (el.getAttribute && el.getAttribute('aria-label')) ? String(el.getAttribute('aria-label')).toLowerCase() : "";
    return (n.includes('pass') || id.includes('pass') || a.includes('senha') || a.includes('password'));
  }

  function safeValue(el) {
    try {
      if (!el) return "";
      if (isPasswordField(el)) return "***";
      if (el.value === undefined || el.value === null) return "";
      const v = String(el.value);
      if (v.length > 200) return v.slice(0, 200) + "...";
      return v;
    } catch (e) {
      return "";
    }
  }

  function textSnippet(el) {
    try {
      const txt = (el && el.innerText) ? String(el.innerText) : "";
      const t = txt.replace(/\s+/g, ' ').trim();
      return t.length > 200 ? (t.slice(0, 200) + "...") : t;
    } catch (e) {
      return "";
    }
  }

  function outerHtmlSnippet(el) {
    try {
      if (!el || !el.outerHTML) return "";
      const html = String(el.outerHTML);
      return html.length > 800 ? (html.slice(0, 800) + "...") : html;
    } catch (e) {
      return "";
    }
  }

  function pageSnapshot() {
    try {
      const html = String(document && document.documentElement ? document.documentElement.outerHTML : "");
      if (!html) return "";
      return html.length > 3000 ? (html.slice(0, 3000) + "...") : html;
    } catch (e) {
      return "";
    }
  }

  function rectInfo(el) {
    try {
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    } catch (e) {
      return null;
    }
  }

  function cssEscapeIdent(s) {
    // Minimal escape for ids/classes.
    return String(s).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function cssPath(el) {
    try {
      if (!el || !el.tagName) return "";
      if (el.id) return `#${cssEscapeIdent(el.id)}`;

      const parts = [];
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 8) {
        let part = node.tagName.toLowerCase();

        if (node.classList && node.classList.length) {
          const cls = Array.from(node.classList).slice(0, 3).map(cssEscapeIdent).join('.');
          if (cls) part += '.' + cls;
        }

        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(node) + 1;
            part += `:nth-of-type(${idx})`;
          }
        }

        parts.unshift(part);
        const candidate = parts.join(' > ');
        try {
          const found = document.querySelectorAll(candidate);
          if (found && found.length === 1) return candidate;
        } catch (e) {
          // ignore
        }

        node = node.parentElement;
        depth += 1;
      }

      return parts.join(' > ');
    } catch (e) {
      return "";
    }
  }

  function xpath(el) {
    try {
      if (!el || !el.tagName) return "";
      if (el.id) return `//*[@id="${el.id}"]`;

      const segments = [];
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 10) {
        const tag = node.tagName.toLowerCase();
        let index = 1;
        let sib = node.previousSibling;
        while (sib) {
          if (sib.nodeType === 1 && sib.tagName && sib.tagName.toLowerCase() === tag) index += 1;
          sib = sib.previousSibling;
        }
        segments.unshift(`${tag}[${index}]`);
        node = node.parentElement;
        depth += 1;
      }
      return '/' + segments.join('/');
    } catch (e) {
      return "";
    }
  }

  function describe(el) {
    try {
      if (!el) return {};
      return {
        tag: (el.tagName || '').toLowerCase(),
        id: el.id || '',
        name: (el.getAttribute && el.getAttribute('name')) ? String(el.getAttribute('name')) : '',
        type: (el.getAttribute && el.getAttribute('type')) ? String(el.getAttribute('type')) : '',
        classes: (el.className && typeof el.className === 'string') ? el.className : '',
        ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) ? String(el.getAttribute('aria-label')) : '',
        role: (el.getAttribute && el.getAttribute('role')) ? String(el.getAttribute('role')) : '',
        dataWwUid: (el.getAttribute && el.getAttribute('data-ww-uid')) ? String(el.getAttribute('data-ww-uid')) : '',
        dataWwComponentId: (el.getAttribute && el.getAttribute('data-ww-component-id')) ? String(el.getAttribute('data-ww-component-id')) : '',
        dataWwLayoutId: (el.getAttribute && el.getAttribute('data-ww-layout-id')) ? String(el.getAttribute('data-ww-layout-id')) : '',
        dataWwRepeatIndex: (el.getAttribute && el.getAttribute('data-ww-repeat-index')) ? String(el.getAttribute('data-ww-repeat-index')) : '',
      };
    } catch (e) {
      return {};
    }
  }

  function closestClickable(el) {
    try {
      if (!el || !el.closest) return null;
      const target = el.closest('button,a,[role="button"],input[type="button"],input[type="submit"]');
      if (!target) return null;
      return {
        tag: (target.tagName || '').toLowerCase(),
        id: target.id || '',
        name: (target.getAttribute && target.getAttribute('name')) ? String(target.getAttribute('name')) : '',
        text: textSnippet(target),
        selectors: {
          css: cssPath(target),
          xpath: xpath(target),
        },
      };
    } catch (e) {
      return null;
    }
  }

  function selectedOptions(el) {
    try {
      if (!el || !el.tagName) return null;
      if (String(el.tagName).toLowerCase() !== 'select') return null;
      const opts = Array.from(el.selectedOptions || []);
      return opts.map(o => ({ value: String(o.value || ''), text: String(o.text || '') }));
    } catch (e) {
      return null;
    }
  }

  function record(kind, el, extra) {
    const events = loadEvents();
    const nowMs = Date.now();
    const entry = {
      t: nowIso(),
      ts: nowMs,
      kind,
      url: String(window.location && window.location.href ? window.location.href : ''),
      title: String(document && document.title ? document.title : ''),
      target: describe(el),
      selectors: {
        css: cssPath(el),
        xpath: xpath(el),
      },
      text: textSnippet(el),
      value: safeValue(el),
      extra: extra || {},
    };
    const last = events.length ? events[events.length - 1] : null;
    if (last && last.kind === entry.kind && last.url === entry.url) {
      const sameSelectors = (last.selectors && entry.selectors
        && last.selectors.css === entry.selectors.css
        && last.selectors.xpath === entry.selectors.xpath);
      const sameValue = (last.value || "") === (entry.value || "");
      const sameText = (last.text || "") === (entry.text || "");
      const lastTs = typeof last.ts === 'number' ? last.ts : 0;
      if (sameSelectors && sameValue && sameText && (nowMs - lastTs) <= DEDUPE_WINDOW_MS) {
        return;
      }
    }

    entry.extra = Object.assign({
      rect: rectInfo(el),
      html: outerHtmlSnippet(el),
      closestClickable: closestClickable(el),
      selectedOptions: selectedOptions(el),
    }, entry.extra || {});

    const nextIndex = events.length + 1;
    if (SNAPSHOT_EVERY > 0 && (nextIndex % SNAPSHOT_EVERY === 0)) {
      entry.extra.snapshot = pageSnapshot();
    }
    events.push(entry);
    saveEvents(events);
  }

  if (window.__efRecorderAttached) {
    return;
  }
  window.__efRecorderAttached = true;

  document.addEventListener('click', function (ev) {
    record('click', ev.target, {});
  }, true);

  document.addEventListener('change', function (ev) {
    record('change', ev.target, {});
  }, true);

  const inputTimers = new WeakMap();
  document.addEventListener('input', function (ev) {
    const el = ev.target;
    try {
      if (!el) return;
      if (isPasswordField(el)) return;
      if (inputTimers.has(el)) clearTimeout(inputTimers.get(el));
      const t = setTimeout(() => {
        record('input', el, {});
      }, 350);
      inputTimers.set(el, t);
    } catch (e) {
      // ignore
    }
  }, true);

  document.addEventListener('submit', function (ev) {
    record('submit', ev.target, {});
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev && ev.key === 'Enter') {
      record('keydown-enter', ev.target, {});
    }
  }, true);

  window.addEventListener('popstate', function () {
    record('nav', document.body, { reason: 'popstate' });
  });

  window.addEventListener('hashchange', function () {
    record('nav', document.body, { reason: 'hashchange' });
  });

  try {
    const _push = history.pushState;
    history.pushState = function () {
      const ret = _push.apply(this, arguments);
      record('nav', document.body, { reason: 'pushState' });
      return ret;
    };
    const _replace = history.replaceState;
    history.replaceState = function () {
      const ret = _replace.apply(this, arguments);
      record('nav', document.body, { reason: 'replaceState' });
      return ret;
    };
  } catch (e) {
    // ignore
  }
})();
"""
    return js.replace("__STORAGE_KEY__", storage_key_json)


def start_recorder(driver: _RecorderDriver) -> None:
    """Enable recording in this Chrome session.

    Uses CDP to inject the recorder script into all future documents, and also
    runs it on the current document.
    """

    js = _recorder_js_source()
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": js})
    except Exception:
        # Not fatal; we can still inject into the current page.
        pass

    try:
        driver.execute_script(js)
    except Exception:
        pass


RecordedEvent = dict[str, Any]


def fetch_recorded_events(driver: _RecorderDriver, *, clear: bool = False) -> list[RecordedEvent]:
    script = (
        "return (function(){"
        "const clear = arguments[0] === true;"
        f"const k='{_RECORDER_STORAGE_KEY}';"
        "try { const raw = window.localStorage.getItem(k); const arr = raw ? JSON.parse(raw) : [];"
        "if (clear) window.localStorage.removeItem(k);"
        "return Array.isArray(arr) ? arr : []; } catch(e) { return []; }"
        "})();"
    )
    try:
        events = driver.execute_script(script, clear)
        if isinstance(events, list):
            return cast(list[RecordedEvent], events)
    except Exception:
        return []
    return []


@dataclass(frozen=True)
class RecorderResult:
    json_path: Path
    screenshot_path: Optional[Path]
    event_count: int


def run_recorder_session(
    driver: _RecorderDriver,
    *,
    start_url: str,
    output_dir: Path,
    label: str = "session",
) -> RecorderResult:
    """Open a browser and let the user interact while we record click/change events.

    Stop condition: user presses ENTER in the terminal.
    """

    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = "".join(ch if (ch.isalnum() or ch in {"_", "-"}) else "_" for ch in label).strip("_-") or "session"

    json_path = output_dir / f"recorder_{safe_label}_{ts}.json"
    screenshot_path: Optional[Path] = None

    log("Recorder: opening browser (interactive)")
    driver.get(start_url)
    time.sleep(2)

    start_recorder(driver)

    print("\n=== Recorder mode ===")
    print("Interaja com o site normalmente (cliques, selects, preencher campos).")
    print("Quando terminar, volte aqui e pressione ENTER para salvar.")
    input("> ")

    events = fetch_recorded_events(driver, clear=True)

    # Best-effort screenshot at the end (useful for context)
    try:
        screenshot_path = output_dir / f"recorder_{safe_label}_{ts}.png"
        png_bytes = driver.get_screenshot_as_png()
        screenshot_path.write_bytes(png_bytes)
    except Exception:
        screenshot_path = None

    payload: dict[str, Any] = {
        "meta": {
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "start_url": start_url,
            "label": safe_label,
        },
        "events": events,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"Recorder: saved {len(events)} events")
    log(f"Recorder: saved JSON: {json_path}")
    if screenshot_path:
        log(f"Recorder: saved screenshot: {screenshot_path}")

    removed = _cleanup_old_recorder_files(output_dir, keep=_RECORDER_KEEP_LAST)
    if removed:
        log(f"Recorder: cleaned {removed} old files")

    if os.getenv("EF_RECORDER_PURGE", "").strip().lower() in {"1", "true", "yes", "y", "sim"}:
        purged = cleanup_all_recorder_files(output_dir)
        log(f"Recorder: purged {purged} files (EF_RECORDER_PURGE)")

    return RecorderResult(json_path=json_path, screenshot_path=screenshot_path, event_count=len(events))


def _cleanup_old_recorder_files(output_dir: Path, *, keep: int) -> int:
    """Keep only the most recent recorder runs to avoid accumulating large artifacts."""

    try:
        files = sorted(
            output_dir.glob("recorder_*_*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except Exception:
        return 0

    if keep < 0:
        keep = 0

    keep_stems = {p.stem for p in files[:keep]} if keep else set()
    removed = 0
    for f in files[keep:]:
        try:
            if f.stem not in keep_stems and f.exists():
                f.unlink()
                removed += 1
        except Exception:
            pass
        try:
            png = output_dir / f"{f.stem}.png"
            if png.exists():
                png.unlink()
                removed += 1
        except Exception:
            pass

    return removed


def cleanup_all_recorder_files(output_dir: Path) -> int:
    """Remove all recorder JSON/PNG artifacts."""

    removed = 0
    for f in output_dir.glob("recorder_*_*.json"):
        try:
            f.unlink()
            removed += 1
        except Exception:
            pass
        try:
            png = output_dir / f"{f.stem}.png"
            if png.exists():
                png.unlink()
                removed += 1
        except Exception:
            pass
    return removed
