#!/usr/bin/env python3

from __future__ import annotations

import ipaddress
import os
import socket
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from _common import host_names

VALID_DAYS = 730
AUTHORITY_FILE = "ams-ca.crt"

USAGE = """Create an HTTPS certificate for serving AMS on a local network.

    python make_cert.py CERT_PATH KEY_PATH [extra-host-or-ip ...]

The certificate covers localhost, this computer's host name and its main LAN
address, plus anything listed on the command line. It is signed by a one-time
local authority whose certificate is written next to it as ams-ca.crt. Install
that file on each device and browsers trust this server without a warning.
"""


def subject_names(extra: list[str]) -> list[x509.GeneralName]:
    names: list[x509.GeneralName] = []
    for value in host_names(extra):
        try:
            names.append(x509.IPAddress(ipaddress.ip_address(value)))
        except ValueError:
            names.append(x509.DNSName(value))
    return names


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)


def main() -> int:
    if len(sys.argv) < 3:
        print(USAGE, file=sys.stderr)
        return 2
    cert_path, key_path = Path(sys.argv[1]), Path(sys.argv[2])
    authority_path = cert_path.parent / AUTHORITY_FILE
    cert_path.parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    starts, ends = now - timedelta(minutes=5), now + timedelta(days=VALID_DAYS)
    names = subject_names(sys.argv[3:])

    authority_key = ec.generate_private_key(ec.SECP256R1())
    label = f"AMS local authority {now:%Y-%m-%d} {socket.gethostname()}"[:64]
    authority_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, label)])
    authority = (
        x509.CertificateBuilder()
        .subject_name(authority_name)
        .issuer_name(authority_name)
        .public_key(authority_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(starts)
        .not_valid_after(ends)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(authority_key.public_key()), critical=False)
        .sign(authority_key, hashes.SHA256())
    )

    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "AMS")]))
        .issuer_name(authority_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(starts)
        .not_valid_after(ends)
        .add_extension(x509.SubjectAlternativeName(names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(authority_key.public_key()), critical=False
        )
        .sign(authority_key, hashes.SHA256())
    )
    del authority_key

    write_private(
        key_path,
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    authority_path.write_bytes(authority.public_bytes(serialization.Encoding.PEM))

    covered = ", ".join(str(getattr(n, "value", n)) for n in names)
    print(f"Certificate written to {cert_path}")
    print(f"  valid for      : {covered}")
    print(f"  valid until    : {ends:%Y-%m-%d}")
    print(f"  SHA-256        : {cert.fingerprint(hashes.SHA256()).hex(':').upper()}")
    print(f"Authority certificate written to {authority_path}")
    print(f"  SHA-256        : {authority.fingerprint(hashes.SHA256()).hex(':').upper()}")
    print("  Install the authority certificate on each device once and browsers stop warning,")
    print("  and will refuse any other server that pretends to be this one. See SETUP.md.")
    print("  Its private key was not kept, so it cannot be used to sign anything else.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
