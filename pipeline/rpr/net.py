"""Small HTTP helpers built on the standard library.

We identify ourselves honestly and retry transient failures with backoff.
"""

from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

USER_AGENT = "rue-par-rue-harvester/0.1 (open-source historical Paris map)"
RETRY_STATUS = {429, 500, 502, 503, 504}


def _request(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> urllib.request.Request:
    h = {"User-Agent": USER_AGENT, "Accept": "application/json, */*;q=0.5"}
    if headers:
        h.update(headers)
    return urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")


def fetch_bytes(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 4,
    timeout: float = 60,
) -> bytes:
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(_request(url, data=data, headers=headers), timeout=timeout) as resp:
                body = resp.read()
                # Some portals gzip responses even when not asked to.
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as err:
            if err.code not in RETRY_STATUS or attempt == retries:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries:
                raise
        time.sleep(delay)
        delay *= 2
    raise RuntimeError("unreachable")


def fetch_json(url: str, **kwargs: Any) -> Any:
    return json.loads(fetch_bytes(url, **kwargs))


def post_json(url: str, payload: Any, headers: dict[str, str] | None = None, **kwargs: Any) -> Any:
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    return json.loads(fetch_bytes(url, data=json.dumps(payload).encode(), headers=h, **kwargs))


def download(url: str, dest: Path, **kwargs: Any) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    body = fetch_bytes(url, **kwargs)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(body)
    tmp.replace(dest)
    return len(body)
