from __future__ import annotations

import hashlib
import hmac
import ipaddress


def build_guest_rate_key(
    client_ip: str,
    secret: str,
) -> str:
    address = ipaddress.ip_address(client_ip)

    if address.version == 4:
        network = ipaddress.ip_network(
            f"{client_ip}/24",
            strict=False,
        )
    else:
        network = ipaddress.ip_network(
            f"{client_ip}/64",
            strict=False,
        )

    message = f"guest-rate:v1:{network}"

    return hmac.new(
        key=secret.encode("utf-8"),
        msg=message.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()
