from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

GUEST_TOKEN_PREFIX = "oa_guest_"


def generate_guest_token() -> str:
    return f"{GUEST_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_guest_token(token: str, secret: str) -> str:
    return hmac.new(
        key=secret.encode("utf-8"),
        msg=token.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()


def verify_guest_token(
    token: str,
    expected_hash: str,
    secret: str,
) -> bool:
    actual_hash = hash_guest_token(token, secret)

    return hmac.compare_digest(actual_hash, expected_hash)


def derive_guest_token(
    operation_key: str,
    request_fingerprint: str,
    secret: str,
) -> str:
    message = f"guest-credential:v1:" f"{operation_key}:" f"{request_fingerprint}"

    digest = hmac.new(
        key=secret.encode("utf-8"),
        msg=message.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).digest()

    encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    return f"{GUEST_TOKEN_PREFIX}{encoded}"
