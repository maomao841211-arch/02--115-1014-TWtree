#!/usr/bin/env python3
"""
在本機起一個 HTTPS 靜態伺服器，供手機（同一個 WiFi）連進來測試 height-clinometer.html。

為什麼要 HTTPS：iOS Safari 只有在 HTTPS（安全來源）下才會給動作/方向感測器權限，
所以不能直接用 http。本腳本自動產生一張自簽憑證（含本機區網 IP），手機第一次連線
會出現「憑證不受信任」警告，點「仍要前往/繼續」即可（因為是你自己電腦發的憑證）。

用法：
    python dev-tools/serve-https.py
然後用手機瀏覽器開啟畫面上印出的網址（或掃 QR）。結束按 Ctrl+C。
"""
import datetime
import http.server
import ipaddress
import os
import socket
import ssl
import sys

PORT = 8443
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # 專案根目錄:讓 app/ 與 dev-tools/ 都能被存取
CERT = os.path.join(HERE, "_devcert.pem")
KEY = os.path.join(HERE, "_devkey.pem")
PAGE = "app/index.html"  # 預設開啟完整 app(測試頁仍在 dev-tools/ar-measure.html)


def lan_ip() -> str:
    """找出對外網路介面的區網 IPv4（不會真的送出封包）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip: str) -> None:
    """若憑證不存在，用 cryptography 產一張含 IP/localhost 的自簽憑證。"""
    if os.path.exists(CERT) and os.path.exists(KEY):
        return
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "twtrees-dev")])
    sans = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    try:
        sans.append(x509.IPAddress(ipaddress.ip_address(ip)))
    except ValueError:
        pass
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .sign(key, hashes.SHA256())
    )
    with open(KEY, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    with open(CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    print("已產生自簽憑證：", CERT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    ip = lan_ip()
    if not os.path.exists(os.path.join(ROOT, PAGE)):
        print("找不到", PAGE, "，請確認 app/index.html 存在。")
        sys.exit(1)
    ensure_cert(ip)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    url = f"https://{ip}:{PORT}/{PAGE}"
    print("=" * 56)
    print("  HTTPS 伺服器已啟動。手機與電腦請連同一個 WiFi。")
    print("  手機瀏覽器開啟：")
    print("   ", url)
    print()
    print("  第一次連線會出現憑證警告 → 點「繼續/仍要前往」即可。")
    print("  若手機連不上：Windows 防火牆首次會問，請允許 Python 於")
    print("  『私人網路』通訊；或確認兩者在同一 WiFi、非訪客網路。")
    print("  結束：按 Ctrl+C")
    print("=" * 56)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止伺服器。")


if __name__ == "__main__":
    main()
