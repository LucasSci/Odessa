## 2024-05-24 - [Fix SSRF bypass via 0.0.0.0]
**Vulnerability:** The proxy endpoint was vulnerable to SSRF by passing `0.0.0.0` or `::` as the host. The `ipaddress` module considers these IPs as "unspecified" rather than "private" or "loopback".
**Learning:** Checking for `.is_private`, `.is_loopback`, `.is_link_local`, and `.is_multicast` on `ipaddress` objects is insufficient to prevent SSRF because `.is_unspecified` must also be checked to prevent `0.0.0.0` routing locally on Linux systems.
**Prevention:** When mitigating SSRF using the `ipaddress` module, always include an explicit check for `ip_obj.is_unspecified`.
