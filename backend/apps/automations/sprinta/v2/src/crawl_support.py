from __future__ import annotations

import asyncio
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List

try:
    from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
except ModuleNotFoundError:
    _vendor_dir = Path(__file__).resolve().parents[1] / "vendor" / "crawl4ai"
    if _vendor_dir.is_dir():
        import sys

        sys.path.insert(0, str(_vendor_dir))
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig  # type: ignore
    else:
        raise

EVENT_URL = "https://app.sprinta.com.br/event/30560768ac8e7500fef"

ASYNC_TIMEOUT = 40

KEYWORDS = ("enroll", "friend", "inscri", "amig", "register", "add")


class _TargetTagTextParser(HTMLParser):
    def __init__(self, target_tags: set[str]):
        super().__init__()
        self._target_tags = target_tags
        self._open_targets: List[Dict[str, object]] = []
        self.elements: List[Dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, str | None]]) -> None:
        if tag not in self._target_tags:
            return
        attrs_dict: Dict[str, str] = {k: (v or "") for k, v in attrs}
        self._open_targets.append(
            {
                "tag": tag,
                "classes": attrs_dict.get("class", ""),
                "text_parts": [],
            }
        )

    def handle_data(self, data: str) -> None:
        if not self._open_targets:
            return
        for t in self._open_targets:
            text_parts = t.get("text_parts")
            if isinstance(text_parts, list):
                text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._open_targets:
            return
        last = self._open_targets[-1]
        if last.get("tag") != tag:
            return
        text = " ".join(str(x).strip() for x in (last.get("text_parts") or []) if str(x).strip())
        text = " ".join(text.split())
        if text:
            self.elements.append(
                {
                    "tag": str(last.get("tag")),
                    "text": text,
                    "classes": str(last.get("classes") or ""),
                }
            )
        self._open_targets.pop()


def _extrair_elementos_relevantes(html: str) -> List[Dict[str, str]]:
    target_tags = {"button", "span", "div", "a"}
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(html, "html.parser")
        elementos: List[Dict[str, str]] = []
        for tag in soup.find_all(list(target_tags)):
            text = (tag.get_text(separator=" ", strip=True) or "").strip()
            if not text:
                continue
            if any(k in text.lower() for k in KEYWORDS):
                elementos.append(
                    {
                        "tag": tag.name,
                        "text": text,
                        "classes": " ".join(tag.get("class", [])),
                    }
                )
        return elementos
    except ModuleNotFoundError:
        parser = _TargetTagTextParser(target_tags=target_tags)
        parser.feed(html)
        return [e for e in parser.elements if any(k in e["text"].lower() for k in KEYWORDS)]


async def coletar_botoes(url: str = EVENT_URL) -> List[Dict[str, str]]:
    config = CrawlerRunConfig()
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)
        # Fallback se markdown vazio
        html = result.html or ""
        return _extrair_elementos_relevantes(html)

def diagnosticar_evento() -> None:
    botoes: List[Dict[str, str]] = asyncio.run(coletar_botoes())
    if not botoes:
        print('[diagnostico] Nenhum botão relevante encontrado via Crawl4AI.')
        return
    print('[diagnostico] Possíveis elementos de ação relacionados a inscrição:')
    for b in botoes:
        print(f" - <{b['tag']}> text='{b['text']}' classes='{b['classes']}'")

if __name__ == '__main__':
    diagnosticar_evento()
