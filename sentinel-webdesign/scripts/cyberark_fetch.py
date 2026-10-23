#!/usr/bin/env python3
"""
Fetch one credential from CyberArk through the Central Credential Provider (CCP) REST API.

    python cyberark_fetch.py --safe SF-JENKINS-PROD --object JENKINS-API-TOKEN
    -> {"value": "<secret>"}  on stdout, exit 0
    -> a short message on stderr, exit 1 (never contains the secret)

Settings (environment variables, set on the Sentinel server):
    CYBERARK_CCP_URL       e.g. https://ccp.corp.example/AIMWebService/api/Accounts       (required in production)
    CYBERARK_APP_ID        the AppID registered for Sentinel in CyberArk                   (required with CYBERARK_CCP_URL)
    CYBERARK_CLIENT_CERT   path to the client certificate (PEM) if the AppID uses certificate authentication
    CYBERARK_CLIENT_KEY    path to its private key (PEM)
    CYBERARK_CA_FILE       path to the CA bundle that signed the CCP server certificate
    CYBERARK_TIMEOUT_S     request timeout, default 4

Without CYBERARK_CCP_URL the script returns a fixed fake value so tests and development run without a vault.
It refuses to do that when NODE_ENV=production: a fake secret in production would look like a real one.
"""
import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request


def fail(message, code=1):
    sys.stderr.write(message + "\n")
    sys.exit(code)


def fetch_from_ccp(url, app_id, safe, obj):
    params = urllib.parse.urlencode({"AppID": app_id, "Safe": safe, "Object": obj})
    context = ssl.create_default_context(cafile=os.environ.get("CYBERARK_CA_FILE") or None)
    cert = os.environ.get("CYBERARK_CLIENT_CERT")
    if cert:
        context.load_cert_chain(cert, os.environ.get("CYBERARK_CLIENT_KEY") or None)
    request = urllib.request.Request(url + ("&" if "?" in url else "?") + params, headers={"Accept": "application/json"})
    timeout = float(os.environ.get("CYBERARK_TIMEOUT_S", "4"))
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # CCP answers 404 for an unknown safe/object and 403 for an AppID without access.
        fail(f"CyberArk CCP answered HTTP {e.code} for safe={safe} object={obj}")
    except Exception as e:  # network, TLS, bad JSON
        fail(f"CyberArk CCP request failed for safe={safe} object={obj}: {type(e).__name__}")
    value = body.get("Content") if isinstance(body, dict) else None
    if not value:
        fail(f"CyberArk CCP returned no Content for safe={safe} object={obj}")
    return value


def main():
    parser = argparse.ArgumentParser(description="Fetch a credential from CyberArk CCP")
    parser.add_argument("--safe", required=True)
    parser.add_argument("--object", required=True)
    args = parser.parse_args()

    ccp_url = os.environ.get("CYBERARK_CCP_URL", "").strip()
    if ccp_url:
        app_id = os.environ.get("CYBERARK_APP_ID", "").strip()
        if not app_id:
            fail("CYBERARK_APP_ID is not set")
        print(json.dumps({"value": fetch_from_ccp(ccp_url, app_id, args.safe, args.object)}))
        return

    if os.environ.get("NODE_ENV") == "production":
        fail("CYBERARK_CCP_URL is not set; refusing to return a fake credential in production", 2)
    if "INVALID" in args.safe or "INVALID" in args.object:
        fail(f"CyberArk object non-existent: safe={args.safe}, object={args.object}")
    print(json.dumps({"value": f"CYBERARK_SECRET_{args.safe}_{args.object}"}))


if __name__ == "__main__":
    main()
