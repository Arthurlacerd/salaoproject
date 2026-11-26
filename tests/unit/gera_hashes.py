"""Gera senha_hash em formatos PLAUSÍVEIS para um app Python/Flask (hashlib real, mesmos esquemas do Werkzeug).
São formatos de teste — NÃO são dados nem o formato comprovado da 9.x. Uso: python3 -I gera_hashes.py <senha>"""
import base64
import hashlib
import json
import secrets
import string
import sys

pw = sys.argv[1].encode()
sal = secrets.token_bytes(16)
st = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))  # sal-texto, como o Werkzeug
b64 = lambda x: base64.b64encode(x).decode()
dk = lambda it, h="sha256": hashlib.pbkdf2_hmac(h, pw, sal, it)
werk = hashlib.pbkdf2_hmac("sha256", pw, st.encode(), 600000).hex()
scr = hashlib.scrypt(pw, salt=st.encode(), n=32768, r=8, p=1, maxmem=132 * 1024 * 1024).hex()
print(json.dumps({
    "app150k": "$".join(["pbkdf2", "150000", b64(sal), b64(dk(150000))]),
    "app600k": "$".join(["pbkdf2", "600000", b64(sal), b64(dk(600000))]),
    "app50k": "$".join(["pbkdf2", "50000", b64(sal), b64(dk(50000))]),
    "hex": "$".join(["pbkdf2", "150000", sal.hex(), dk(150000).hex()]),
    "sha512": "$".join(["pbkdf2", "150000", b64(sal), b64(dk(150000, "sha512"))]),
    "werkzeug": "$".join(["pbkdf2:sha256:600000", st, werk]),
    "scrypt": "$".join(["scrypt:32768:8:1", st, scr]),
}))
