#!/usr/bin/env python3
"""
Authenticated Instagram sync for the Espaco Facial website.

Runs in GitHub Actions with an optional persisted instagrapi session file and
pushes normalized profile/media snapshots back into the website cache API.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import requests


SCRIPT_DIR = Path(__file__).resolve().parent
INSTAGRAPI_ROOT = SCRIPT_DIR.parent / "instagrapi"
if str(INSTAGRAPI_ROOT) not in sys.path:
    sys.path.insert(0, str(INSTAGRAPI_ROOT))



INSTAGRAM_APP_ID = "936619743392459"
INSTAGRAM_WEB_BASE = "https://www.instagram.com"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def int_env(name: str, default: int, min_value: int, max_value: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(min_value, min(max_value, value))


def float_env(name: str, default: float, min_value: float, max_value: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(min_value, min(max_value, value))


def normalize_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_count(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, parsed)


def iso_payload(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        if hasattr(value, "model_dump"):
            payload = value.model_dump(mode="json")
        elif hasattr(value, "dict"):
            payload = value.dict()
        else:
            payload = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return None


@dataclass
class SyncConfig:
    website_base_url: str
    sync_token: str
    session_file: Path
    username: str
    password: str
    sessionid: str
    verification_code: str
    include_stories: bool
    max_feed_items: int
    delay_seconds: float
    request_timeout_seconds: int
    summary_file: Optional[Path]
    handles: List[str]


@dataclass
class HandleSummary:
    handle: str
    ok: bool
    error: Optional[str]
    source: str
    fetched_items: int
    fetched_stories: int
    upserted_items: int


class InstagramSessionClient:
    def __init__(self, *, sessionid: str, request_timeout_seconds: int, cookies: Optional[Dict[str, str]] = None):
        self.sessionid = sessionid
        self.request_timeout_seconds = request_timeout_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "user-agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "accept": "application/json,text/plain,*/*",
                "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
                "x-ig-app-id": INSTAGRAM_APP_ID,
                "origin": INSTAGRAM_WEB_BASE,
                "referer": f"{INSTAGRAM_WEB_BASE}/",
            }
        )
        cookie_values = {key: value for key, value in (cookies or {}).items() if normalize_str(value)}
        cookie_values["sessionid"] = sessionid
        for name, value in cookie_values.items():
            self.session.cookies.set(name, value, domain=".instagram.com")
        csrf_token = cookie_values.get("csrftoken")
        if csrf_token:
            self.session.headers["x-csrftoken"] = csrf_token
        self.viewer_username: Optional[str] = None
        self.viewer_user_id: Optional[str] = None

    def export_cookies(self) -> Dict[str, str]:
        cookies: Dict[str, str] = {}
        for cookie in self.session.cookies:
            if not cookie.name or "instagram.com" not in (cookie.domain or ""):
                continue
            value = normalize_str(cookie.value)
            if value:
                cookies[cookie.name] = value
        return cookies

    def _get_json(self, url: str) -> Dict[str, Any]:
        response = self.session.get(url, timeout=self.request_timeout_seconds)
        response.raise_for_status()
        return response.json()

    def bootstrap_viewer(self) -> None:
        response = self.session.get(f"{INSTAGRAM_WEB_BASE}/", timeout=self.request_timeout_seconds)
        response.raise_for_status()
        csrf_cookie = normalize_str(self.session.cookies.get("csrftoken"))
        if csrf_cookie:
            self.session.headers["x-csrftoken"] = csrf_cookie

        try:
            web_profile = self._get_json(f"{INSTAGRAM_WEB_BASE}/api/v1/users/web_profile_info/?username=skincosofficial")
            user = ((web_profile.get("data") or {}).get("user")) or {}
            self.viewer_username = normalize_str(user.get("username"))
            self.viewer_user_id = normalize_str(user.get("id"))
        except Exception:
            self.viewer_username = self.viewer_username or "skincosofficial"
            self.viewer_user_id = self.viewer_user_id or normalize_str(self.session.cookies.get("ds_user_id"))

    def fetch_profile(self, handle: str) -> Dict[str, Any]:
        payload = self._get_json(
            f"{INSTAGRAM_WEB_BASE}/api/v1/users/web_profile_info/?username={requests.utils.quote(handle)}"
        )
        user = ((payload.get("data") or {}).get("user")) or {}
        if not user:
            raise RuntimeError(f"profile_not_found:{handle}")
        return user

    def fetch_feed_page(self, user_id: str, *, cursor: Optional[str], count: int) -> Dict[str, Any]:
        url = f"{INSTAGRAM_WEB_BASE}/api/v1/feed/user/{requests.utils.quote(user_id)}/?count={count}"
        if cursor:
            url += f"&max_id={requests.utils.quote(cursor)}"
        return self._get_json(url)

    def fetch_feed_items(self, user_id: str, *, amount: int) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        while len(items) < amount:
            page = self.fetch_feed_page(user_id, cursor=cursor, count=min(33, amount - len(items)))
            page_items = page.get("items") or []
            if isinstance(page_items, list):
                items.extend(item for item in page_items if isinstance(item, dict))
            more_available = bool(page.get("more_available"))
            cursor = normalize_str(page.get("next_max_id"))
            if not more_available or not cursor:
                break
        return items[:amount]

    def fetch_story_items(self, user_id: str) -> List[Dict[str, Any]]:
        try:
            payload = self._get_json(
                f"{INSTAGRAM_WEB_BASE}/api/v1/feed/reels_media/?reel_ids={requests.utils.quote(user_id)}"
            )
        except Exception:
            return []
        reels = payload.get("reels")
        if not isinstance(reels, dict):
            return []
        direct = reels.get(user_id)
        if isinstance(direct, dict) and isinstance(direct.get("items"), list):
            return [item for item in direct["items"] if isinstance(item, dict)]
        for value in reels.values():
            if isinstance(value, dict) and isinstance(value.get("items"), list):
                return [item for item in value["items"] if isinstance(item, dict)]
        return []


class WebsiteSyncClient:
    def __init__(self, config: SyncConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "authorization": f"Bearer {config.sync_token}",
                "content-type": "application/json",
                "user-agent": "skincos-instagrapi-sync/1.0",
            }
        )

    def _url(self, path: str) -> str:
        return f"{self.config.website_base_url.rstrip('/')}{path}"

    def fetch_targets(self) -> List[str]:
        if self.config.handles:
            return self.config.handles
        response = self.session.get(
            self._url("/api/instagram/sync-targets"),
            timeout=self.config.request_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        targets = payload.get("targets") or []
        handles: List[str] = []
        for target in targets:
            handle = normalize_str((target or {}).get("handle"))
            if handle:
                handles.append(handle.lower())
        return sorted(set(handles))

    def ingest_snapshot(
        self,
        handle: str,
        profile: Dict[str, Any],
        items: List[Dict[str, Any]],
        source: str,
    ) -> Dict[str, Any]:
        response = self.session.post(
            self._url("/api/instagram/ingest"),
            timeout=self.config.request_timeout_seconds,
            data=json.dumps(
                {
                    "handle": handle,
                    "source": source,
                    "profile": profile,
                    "items": items,
                },
                ensure_ascii=False,
            ),
        )
        response.raise_for_status()
        return response.json()


def build_config(args: argparse.Namespace) -> SyncConfig:
    base_url = normalize_str(args.base_url or os.getenv("WEBSITE_BASE_URL")) or "https://espacofacial.com"
    token = normalize_str(os.getenv("INSTAGRAM_SYNC_TOKEN")) or ""
    session_file = Path(
        normalize_str(args.session_file or os.getenv("INSTAGRAPI_SESSION_FILE"))
        or str(SCRIPT_DIR / ".instagrapi-session.json")
    )
    summary_file = normalize_str(args.summary_file or os.getenv("INSTAGRAPI_SYNC_SUMMARY_FILE"))
    handles = [handle.strip().lstrip("@").lower() for handle in (args.handles or "").split(",") if handle.strip()]
    return SyncConfig(
        website_base_url=base_url,
        sync_token=token,
        session_file=session_file,
        username=normalize_str(os.getenv("INSTAGRAPI_LOGIN_USERNAME")) or "",
        password=normalize_str(os.getenv("INSTAGRAPI_LOGIN_PASSWORD")) or "",
        sessionid=normalize_str(os.getenv("INSTAGRAPI_SESSIONID")) or "",
        verification_code=normalize_str(os.getenv("INSTAGRAPI_VERIFICATION_CODE")) or "",
        include_stories=bool_env("INSTAGRAPI_INCLUDE_STORIES", args.include_stories),
        max_feed_items=int_env("INSTAGRAPI_MAX_FEED_ITEMS", args.max_feed_items, 9, 180),
        delay_seconds=float_env("INSTAGRAPI_HANDLE_DELAY_SECONDS", args.delay_seconds, 0.0, 15.0),
        request_timeout_seconds=int_env("INSTAGRAPI_REQUEST_TIMEOUT_SECONDS", 60, 10, 300),
        summary_file=Path(summary_file) if summary_file else None,
        handles=handles,
    )


def ensure_session_parent(session_file: Path) -> None:
    session_file.parent.mkdir(parents=True, exist_ok=True)


def load_saved_session_state(session_file: Path) -> Dict[str, Any]:
    if not session_file.exists():
        return {}
    try:
        payload = json.loads(session_file.read_text())
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def load_saved_sessionid(session_file: Path) -> str:
    payload = load_saved_session_state(session_file)
    direct = normalize_str(payload.get("sessionid"))
    if direct:
        return direct
    cookies = payload.get("cookies")
    if isinstance(cookies, dict):
        return normalize_str(cookies.get("sessionid")) or ""
    return ""


def save_session_state(
    session_file: Path,
    *,
    sessionid: str,
    cookies: Dict[str, str],
    viewer_username: Optional[str],
    viewer_user_id: Optional[str],
) -> None:
    ensure_session_parent(session_file)
    session_file.write_text(
        json.dumps(
            {
                "sessionid": sessionid,
                "cookies": cookies,
                "viewer_username": viewer_username,
                "viewer_user_id": viewer_user_id,
                "saved_at": utc_now_iso(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def authenticate_client(config: SyncConfig) -> tuple[InstagramSessionClient, str]:
    saved_payload = load_saved_session_state(config.session_file)
    saved_cookies = saved_payload.get("cookies")
    cookie_bundle = saved_cookies if isinstance(saved_cookies, dict) else {}
    sessionid = config.sessionid or normalize_str(cookie_bundle.get("sessionid")) or load_saved_sessionid(config.session_file)
    if not sessionid:
        raise RuntimeError("instagrapi_not_configured")

    client = InstagramSessionClient(
        sessionid=sessionid,
        request_timeout_seconds=config.request_timeout_seconds,
        cookies={str(key): str(value) for key, value in cookie_bundle.items()},
    )
    try:
        client.bootstrap_viewer()
    except Exception:
        pass

    save_session_state(
        config.session_file,
        sessionid=sessionid,
        cookies=client.export_cookies(),
        viewer_username=client.viewer_username,
        viewer_user_id=client.viewer_user_id,
    )
    return client, "sessionid"


def best_resource_thumbnail(resources: Iterable[Any]) -> Optional[str]:
    for resource in resources:
        url = (
            normalize_str(value_of(resource, "thumbnail_url"))
            or normalize_str(value_of(resource, "src"))
            or normalize_str(value_of(resource, "url"))
            or normalize_str(value_of(resource, "display_url"))
        )
        if url:
            return url
    return None


def best_resource_video(resources: Iterable[Any]) -> Optional[str]:
    for resource in resources:
        url = (
            normalize_str(value_of(resource, "video_url"))
            or normalize_str(value_of(resource, "src"))
            or normalize_str(value_of(resource, "url"))
        )
        if url:
            return url
    return None


def value_of(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def media_permalink(handle: str, code: Optional[str], is_story: bool, media_type: str, media_pk: str) -> Optional[str]:
    if is_story:
        return f"https://www.instagram.com/stories/{handle}/{media_pk}/"
    if not code:
        return None
    if media_type == "video":
        return f"https://www.instagram.com/reel/{code}/"
    return f"https://www.instagram.com/p/{code}/"


def normalize_media(handle: str, media: Any, *, is_story: bool) -> Optional[Dict[str, Any]]:
    media_pk = normalize_str(value_of(media, "pk") or value_of(media, "id"))
    if not media_pk:
        return None

    media_type_number = int(value_of(media, "media_type", 1) or 1)
    media_type = "carousel" if media_type_number == 8 else "video" if media_type_number == 2 else "image"
    carousel = value_of(media, "carousel_media") or value_of(media, "resources") or []
    resources = list(carousel or [])

    thumbnail_url = (
        normalize_str(value_of(media, "thumbnail_url"))
        or normalize_str(value_of(media, "display_url"))
        or best_resource_thumbnail(value_of(media, "image_versions2", {}).get("candidates", []) if isinstance(value_of(media, "image_versions2"), dict) else [])
        or best_resource_thumbnail(resources)
        or normalize_str(value_of(media, "video_url"))
        or best_resource_video(value_of(media, "video_versions") or [])
        or best_resource_video(resources)
    )
    video_url = (
        normalize_str(value_of(media, "video_url"))
        or best_resource_video(value_of(media, "video_versions") or [])
        or best_resource_video(resources)
    )
    if not thumbnail_url:
        return None

    taken_at = value_of(media, "taken_at")
    taken_at_ms = None
    if isinstance(taken_at, datetime):
        taken_at_ms = int(taken_at.timestamp() * 1000)
    elif isinstance(taken_at, (int, float)):
        taken_at_ms = int(float(taken_at) * 1000)

    code = normalize_str(value_of(media, "code"))
    product_type = normalize_str(value_of(media, "product_type"))
    location = value_of(media, "location") or {}
    caption = value_of(media, "caption_text")
    if caption is None and isinstance(value_of(media, "caption"), dict):
        caption = value_of(value_of(media, "caption"), "text")
    resource_count = len(resources) if resources else None

    return {
        "mediaId": media_pk,
        "code": code,
        "mediaType": media_type,
        "isReel": product_type == "clips",
        "isStory": is_story,
        "caption": normalize_str(caption),
        "likeCount": normalize_count(value_of(media, "like_count")),
        "commentCount": normalize_count(value_of(media, "comment_count")),
        "playCount": normalize_count(value_of(media, "play_count")),
        "viewCount": normalize_count(value_of(media, "view_count") or value_of(media, "video_view_count")),
        "durationSeconds": value_of(media, "video_duration"),
        "locationName": normalize_str(value_of(location, "name")),
        "productType": product_type,
        "resourcesCount": resource_count,
        "isPinned": False,
        "takenAtMs": taken_at_ms,
        "thumbnailUrl": thumbnail_url,
        "videoUrl": video_url,
        "permalink": media_permalink(handle, code, is_story, media_type, media_pk),
        "payloadJson": iso_payload(media),
    }


def build_profile_payload(user: Any) -> Dict[str, Any]:
    followers_count = value_of(user, "follower_count")
    if followers_count is None and isinstance(value_of(user, "edge_followed_by"), dict):
        followers_count = value_of(value_of(user, "edge_followed_by"), "count")

    following_count = value_of(user, "following_count")
    if following_count is None and isinstance(value_of(user, "edge_follow"), dict):
        following_count = value_of(value_of(user, "edge_follow"), "count")

    media_count = value_of(user, "media_count")
    if media_count is None and isinstance(value_of(user, "edge_owner_to_timeline_media"), dict):
        media_count = value_of(value_of(user, "edge_owner_to_timeline_media"), "count")

    return {
        "userId": normalize_str(value_of(user, "pk") or value_of(user, "id")),
        "username": normalize_str(value_of(user, "username")),
        "fullName": normalize_str(value_of(user, "full_name")),
        "biography": normalize_str(value_of(user, "biography")),
        "avatarUrl": normalize_str(value_of(user, "profile_pic_url_hd"))
        or normalize_str(value_of(user, "profile_pic_url")),
        "isVerified": value_of(user, "is_verified"),
        "isPrivate": value_of(user, "is_private"),
        "isBusiness": value_of(user, "is_business") or value_of(user, "is_business_account"),
        "isProfessional": value_of(user, "account_type") in {2, 3} or bool(value_of(user, "is_professional_account")),
        "externalUrl": normalize_str(value_of(user, "external_url")),
        "categoryName": normalize_str(value_of(user, "category_name") or value_of(user, "business_category_name")),
        "publicEmail": normalize_str(value_of(user, "public_email") or value_of(user, "business_email")),
        "publicPhone": normalize_str(
            value_of(user, "public_phone_number")
            or value_of(user, "contact_phone_number")
            or value_of(user, "business_phone_number")
        ),
        "followersCount": normalize_count(followers_count),
        "followingCount": normalize_count(following_count),
        "mediaCount": normalize_count(media_count),
        "payloadJson": iso_payload(user),
    }


def write_summary(config: SyncConfig, payload: Dict[str, Any]) -> None:
    if not config.summary_file:
        return
    config.summary_file.parent.mkdir(parents=True, exist_ok=True)
    config.summary_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def sync_handle(client: InstagramSessionClient, website: WebsiteSyncClient, handle: str, config: SyncConfig, source: str) -> HandleSummary:
    try:
        user = client.fetch_profile(handle)
        user_id = normalize_str(user.get("id"))
        if not user_id:
            raise RuntimeError(f"profile_missing_id:{handle}")

        medias = client.fetch_feed_items(user_id, amount=config.max_feed_items)
        stories = client.fetch_story_items(user_id) if config.include_stories else []
        normalized_items = [
            item
            for item in [
                *(normalize_media(handle, media, is_story=False) for media in medias),
                *(normalize_media(handle, story, is_story=True) for story in stories),
            ]
            if item
        ]
        ingest_response = website.ingest_snapshot(
            handle=handle,
            profile=build_profile_payload(user),
            items=normalized_items,
            source=source,
        )
        result = ingest_response.get("result") or {}
        return HandleSummary(
            handle=handle,
            ok=bool(ingest_response.get("ok")),
            error=normalize_str(result.get("error")),
            source=source,
            fetched_items=len(medias),
            fetched_stories=len(stories),
            upserted_items=normalize_count(result.get("upsertedItems")) or 0,
        )
    except Exception as exc:  # pragma: no cover - exercised in live environments
        return HandleSummary(
            handle=handle,
            ok=False,
            error=str(exc),
            source=source,
            fetched_items=0,
            fetched_stories=0,
            upserted_items=0,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authenticated instagrapi sync for the website cache.")
    parser.add_argument("--base-url", default=None, help="Website base URL. Defaults to WEBSITE_BASE_URL or https://espacofacial.com.")
    parser.add_argument("--session-file", default=None, help="Path to the instagrapi session settings JSON.")
    parser.add_argument("--summary-file", default=None, help="Write a JSON summary to this path.")
    parser.add_argument("--handles", default="", help="Comma-separated handles to sync instead of fetching targets from the website.")
    parser.add_argument("--max-feed-items", type=int, default=120, help="Maximum number of feed items per handle.")
    parser.add_argument("--delay-seconds", type=float, default=0.75, help="Delay between handles.")
    parser.add_argument("--include-stories", action="store_true", default=True, help="Include story sync.")
    parser.add_argument("--no-include-stories", dest="include_stories", action="store_false", help="Disable story sync.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = build_config(args)
    summary: Dict[str, Any] = {
        "ok": False,
        "startedAt": utc_now_iso(),
        "mode": "instagrapi_primary",
        "configurationStatus": "initializing",
        "authMode": None,
        "targetsCount": 0,
        "successCount": 0,
        "failureCount": 0,
        "failedHandles": [],
        "results": [],
    }

    try:
        if not config.sync_token:
            raise RuntimeError("instagram_sync_token_missing")

        client, auth_mode = authenticate_client(config)
        summary["authMode"] = auth_mode
        summary["configurationStatus"] = "configured"

        website = WebsiteSyncClient(config)
        handles = website.fetch_targets()
        summary["targetsCount"] = len(handles)
        if not handles:
            summary["ok"] = True
            summary["finishedAt"] = utc_now_iso()
            write_summary(config, summary)
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        results: List[HandleSummary] = []
        for index, handle in enumerate(handles):
            if index > 0 and config.delay_seconds > 0:
                time.sleep(config.delay_seconds)
            results.append(sync_handle(client, website, handle, config, f"instagrapi:{auth_mode}"))

        failed = [result.handle for result in results if not result.ok]
        summary["results"] = [asdict(result) for result in results]
        summary["successCount"] = sum(1 for result in results if result.ok)
        summary["failureCount"] = len(failed)
        summary["failedHandles"] = failed
        summary["ok"] = len(failed) == 0
        summary["finishedAt"] = utc_now_iso()

        if config.session_file.exists():
            summary["sessionFile"] = str(config.session_file)

        write_summary(config, summary)
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if summary["ok"] else 2
    except Exception as exc:
        summary["configurationStatus"] = normalize_str(str(exc)) or "error"
        summary["finishedAt"] = utc_now_iso()
        write_summary(config, summary)
        print(json.dumps(summary, ensure_ascii=False))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
