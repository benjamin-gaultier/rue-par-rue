"""Paris Musées collections (Carnavalet: Marville, Atget, ...), CC0 open content.

The GraphQL API needs a free token, created at
https://apicollections.parismusees.paris.fr/ and sent in the `auth-token`
header. Set it as the PARISMUSEES_TOKEN environment variable.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

from rpr import net

ENDPOINT = "https://apicollections.parismusees.paris.fr/graphql"

INTROSPECT = """
query { __schema { queryType { fields { name args { name type { name kind ofType { name kind } } } } } } }
"""


def headers() -> dict[str, str]:
    token = os.environ.get("PARISMUSEES_TOKEN")
    if not token:
        raise SystemExit(
            "PARISMUSEES_TOKEN is not set. Create a free token at "
            "https://apicollections.parismusees.paris.fr/ and export it."
        )
    return {"auth-token": token}


def query(q: str, variables: dict | None = None) -> Any:
    resp = net.post_json(ENDPOINT, {"query": q, "variables": variables or {}}, headers=headers())
    if resp.get("errors"):
        raise RuntimeError(json.dumps(resp["errors"], ensure_ascii=False)[:2000])
    return resp["data"]


def introspect(log: Callable[[str], Any] = print) -> None:
    data = query(INTROSPECT)
    for f in data["__schema"]["queryType"]["fields"]:
        args = ", ".join(a["name"] for a in f["args"])
        log(f"  {f['name']}({args})")


def harvest(log: Callable[[str], Any] = print):
    raise SystemExit(
        "The Paris Musées harvester is written against the live schema once a "
        "token is available. Run `python -m rpr parismusees --introspect` first."
    )
