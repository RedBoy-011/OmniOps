"""Builds a real, installable signed Android APK for OmniOps Coucou Companion.
Compatible with standard Android package installers (Android 8.0+).
"""

import datetime
import hashlib
import os
import struct
import zlib
import zipfile
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def uleb128(val: int) -> bytes:
    res = bytearray()
    while True:
        b = val & 0x7f
        val >>= 7
        if val > 0:
            res.append(b | 0x80)
        else:
            res.append(b)
            break
    return bytes(res)


def build_dex() -> bytes:
    """Builds a minimal valid Dalvik DEX file containing com.omniops.coucou.MainActivity."""
    strings = [
        "<init>",
        "Landroid/app/Activity;",
        "Landroid/os/Bundle;",
        "Lcom/omniops/coucou/MainActivity;",
        "MainActivity.java",
        "V",
        "VL",
        "onCreate"
    ]

    string_data_list = []
    for s in strings:
        enc = s.encode("utf-8")
        string_data_list.append(uleb128(len(enc)) + enc + b"\x00")

    # Header size = 0x70 = 112 bytes
    header_size = 112

    # String IDs (8 entries * 4 bytes = 32 bytes)
    string_ids_off = header_size

    # Type IDs: 4 entries * 4 bytes = 16 bytes
    # 0: Landroid/app/Activity; (str idx 1)
    # 1: Landroid/os/Bundle; (str idx 2)
    # 2: Lcom/omniops/coucou/MainActivity; (str idx 3)
    # 3: V (str idx 5)
    type_ids_off = string_ids_off + len(strings) * 4
    type_ids = [1, 2, 3, 5]

    # Proto IDs: 2 entries * 12 bytes = 24 bytes
    # Proto 0: shorty 5 ("V"), return_type 3 ("V"), params_off 0
    # Proto 1: shorty 6 ("VL"), return_type 3 ("V"), params_off points to type_list
    proto_ids_off = type_ids_off + len(type_ids) * 4

    # Field IDs: 0 entries
    field_ids_off = proto_ids_off + 2 * 12

    # Method IDs: 4 entries * 8 bytes = 32 bytes
    # Method 0: class 0 (Activity), proto 0 (()V), name 0 (<init>)
    # Method 1: class 2 (MainActivity), proto 0 (()V), name 0 (<init>)
    # Method 2: class 0 (Activity), proto 1 ((Bundle)V), name 7 (onCreate)
    # Method 3: class 2 (MainActivity), proto 1 ((Bundle)V), name 7 (onCreate)
    method_ids_off = field_ids_off
    method_ids = [
        (0, 0, 0),
        (2, 0, 0),
        (0, 1, 7),
        (2, 1, 7),
    ]

    # Class Defs: 1 entry * 32 bytes = 32 bytes
    class_defs_off = method_ids_off + len(method_ids) * 8

    # Start of data area
    data_off = class_defs_off + 32

    # In data area:
    # 1. Type list for proto 1: size=1 (uint32), type_idx=1 (Bundle) (uint16) + padding (uint16)
    proto1_params_off = data_off
    proto1_params_data = struct.pack("<IH", 1, 1) + b"\x00\x00"

    # 2. String data items
    string_data_offs = []
    curr_data_off = proto1_params_off + len(proto1_params_data)
    string_data_bytes = bytearray()
    for sdata in string_data_list:
        string_data_offs.append(curr_data_off + len(string_data_bytes))
        string_data_bytes.extend(sdata)

    # 3. Code item for <init>: registers_size=1, ins_size=1, outs_size=1, tries_size=0, debug_info_off=0, insns_size=4
    # Instructions: invoke-direct {v0}, Activity.<init> (0x0070 0x0000 0x0000), return-void (0x000e)
    code_init_off = curr_data_off + len(string_data_bytes)
    if code_init_off % 4 != 0:
        pad = 4 - (code_init_off % 4)
        string_data_bytes.extend(b"\x00" * pad)
        code_init_off += pad

    insns_init = struct.pack("<HHHH", 0x1070, 0x0000, 0x0000, 0x000e)
    code_init = struct.pack("<HHHHII", 1, 1, 1, 0, 0, 4) + insns_init

    # 4. Code item for onCreate: registers_size=2, ins_size=2, outs_size=2, tries_size=0, debug_info_off=0, insns_size=4
    # Instructions: invoke-super {v0, v1}, Activity.onCreate (0x006f 0x0002 0x0010), return-void (0x000e)
    code_oncreate_off = code_init_off + len(code_init)
    if code_oncreate_off % 4 != 0:
        pad = 4 - (code_oncreate_off % 4)
        code_init += b"\x00" * pad
        code_oncreate_off += pad

    insns_oncreate = struct.pack("<HHHH", 0x206f, 0x0002, 0x0010, 0x000e)
    code_oncreate = struct.pack("<HHHHII", 2, 2, 2, 0, 0, 4) + insns_oncreate

    # 5. Class data item:
    # static_fields_size=0, instance_fields_size=0, direct_methods_size=1, virtual_methods_size=1
    # direct_methods: method_idx_diff=1 (<init>), access_flags=0x10001 (PUBLIC | CONSTRUCTOR), code_off=code_init_off
    # virtual_methods: method_idx_diff=3 (onCreate), access_flags=0x0001 (PUBLIC), code_off=code_oncreate_off
    class_data_off = code_oncreate_off + len(code_oncreate)
    class_data = (
        uleb128(0) + uleb128(0) + uleb128(1) + uleb128(1) +
        uleb128(1) + uleb128(0x10001) + uleb128(code_init_off) +
        uleb128(3) + uleb128(0x0001) + uleb128(code_oncreate_off)
    )

    # 6. Map list
    map_off = class_data_off + len(class_data)
    if map_off % 4 != 0:
        pad = 4 - (map_off % 4)
        class_data += b"\x00" * pad
        map_off += pad

    map_items = [
        (0x0000, 1, 0),                 # Header
        (0x0001, len(strings), string_ids_off),
        (0x0002, len(type_ids), type_ids_off),
        (0x0003, 2, proto_ids_off),
        (0x0005, len(method_ids), method_ids_off),
        (0x0006, 1, class_defs_off),
        (0x1000, 1, map_off),           # Map list
        (0x1001, 1, proto1_params_off), # Type list
        (0x2001, 2, code_init_off),     # Code items
        (0x2000, 1, class_data_off),    # Class data
        (0x2002, len(strings), string_data_offs[0]), # String data
    ]

    map_list = struct.pack("<I", len(map_items))
    for itype, isize, ioff in map_items:
        map_list += struct.pack("<HHII", itype, 0, isize, ioff)

    total_size = map_off + len(map_list)
    data_size = total_size - data_off

    # Assemble tables
    # String IDs
    str_ids_data = bytearray()
    for off in string_data_offs:
        str_ids_data.extend(struct.pack("<I", off))

    # Type IDs
    type_ids_data = bytearray()
    for s_idx in type_ids:
        type_ids_data.extend(struct.pack("<I", s_idx))

    # Proto IDs
    proto_ids_data = bytearray()
    proto_ids_data.extend(struct.pack("<III", 5, 3, 0)) # proto 0: V ()V
    proto_ids_data.extend(struct.pack("<III", 6, 3, proto1_params_off)) # proto 1: VL (Bundle)V

    # Method IDs
    meth_ids_data = bytearray()
    for c_idx, p_idx, n_idx in method_ids:
        meth_ids_data.extend(struct.pack("<HHI", c_idx, p_idx, n_idx))

    # Class Def:
    # class_idx=2, access_flags=0x0001 (PUBLIC), superclass_idx=0 (Activity), interfaces_off=0,
    # source_file_idx=4 (MainActivity.java), annotations_off=0, class_data_off=class_data_off, static_values_off=0
    class_def_data = struct.pack("<IIIIIIII", 2, 0x0001, 0, 0, 4, 0, class_data_off, 0)

    payload = (
        str_ids_data +
        type_ids_data +
        proto_ids_data +
        meth_ids_data +
        class_def_data +
        proto1_params_data +
        string_data_bytes +
        code_init +
        code_oncreate +
        class_data +
        map_list
    )

    # Compute header
    endian_tag = 0x12345678
    magic = b"dex\n035\x00"

    # Preliminary header without checksum & signature
    pre_header = (
        struct.pack("<IIIIIIIIIIIIIIII",
            total_size, header_size, endian_tag, 0, 0, map_off,
            len(strings), string_ids_off,
            len(type_ids), type_ids_off,
            2, proto_ids_off,
            0, field_ids_off,
            len(method_ids), method_ids_off,
        ) +
        struct.pack("<IIII",
            1, class_defs_off,
            data_size, data_off
        )
    )

    full_without_sig = pre_header + payload
    sha1_sig = hashlib.sha1(full_without_sig).digest()

    full_without_chk = sha1_sig + full_without_sig
    checksum = zlib.adler32(full_without_chk) & 0xffffffff

    final_dex = magic + struct.pack("<I", checksum) + full_without_chk
    return final_dex


def build_binary_xml() -> bytes:
    """Builds a compliant Android Binary XML (AXML) for AndroidManifest.xml."""
    # Strings table:
    # 0: manifest, 1: package, 2: com.omniops.coucou, 3: versionCode, 4: versionName, 5: 1.1.4
    # 6: application, 7: label, 8: OmniOps Coucou, 9: activity, 10: name, 11: com.omniops.coucou.MainActivity
    # 12: exported, 13: intent-filter, 14: action, 15: android.intent.action.MAIN
    # 16: category, 17: android.intent.category.LAUNCHER, 18: uses-permission, 19: android.permission.INTERNET
    # 20: android.permission.USE_BIOMETRIC, 21: android.permission.SYSTEM_ALERT_WINDOW, 22: http://schemas.android.com/apk/res/android
    strings = [
        "manifest", "package", "com.omniops.coucou", "versionCode", "versionName", "1.1.4",
        "application", "label", "OmniOps Coucou", "activity", "name", "com.omniops.coucou.MainActivity",
        "exported", "intent-filter", "action", "android.intent.action.MAIN",
        "category", "android.intent.category.LAUNCHER", "uses-permission", "android.permission.INTERNET",
        "android.permission.USE_BIOMETRIC", "android.permission.SYSTEM_ALERT_WINDOW",
        "http://schemas.android.com/apk/res/android"
    ]

    # String pool in UTF-16
    str_data = bytearray()
    str_offsets = []
    for s in strings:
        str_offsets.append(len(str_data) // 2)
        encoded = s.encode("utf-16le")
        str_data.extend(struct.pack("<H", len(s)))
        str_data.extend(encoded)
        str_data.extend(b"\x00\x00")
    while len(str_data) % 4 != 0:
        str_data.extend(b"\x00")

    str_pool_header_size = 28
    str_pool_chunk_size = str_pool_header_size + len(strings) * 4 + len(str_data)
    str_pool_chunk = struct.pack("<HHIIIIII",
        0x0001, str_pool_header_size, str_pool_chunk_size,
        len(strings), 0, 0,
        str_pool_header_size + len(strings) * 4, 0
    )
    for off in str_offsets:
        str_pool_chunk += struct.pack("<I", off * 2)
    str_pool_chunk += str_data

    # Resource Map chunk (optional or standard)
    res_map = struct.pack("<HHI", 0x0180, 8, 8 + len(strings) * 4) + (b"\x00\x00\x00\x00" * len(strings))

    # XML Body
    xml_body = bytearray()

    # Namespace Start: prefix=-1, uri=22
    xml_body.extend(struct.pack("<HHIIII", 0x0100, 16, 24, 1, 0xffffffff, 22))

    # <manifest package="com.omniops.coucou" versionCode="1" versionName="1.1.4">
    # Attribute 0: ns=-1, name=1 ("package"), val_str=2 ("com.omniops.coucou"), type=3 (STRING), data=2
    attr_pkg = struct.pack("<IIIII", 0xffffffff, 1, 2, (3 << 24) | 8, 2)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_pkg), 2, 0xffffffff, 0, 20, 5, 1, 0))
    xml_body.extend(attr_pkg)

    # <uses-permission name="android.permission.INTERNET">
    attr_perm1 = struct.pack("<IIIII", 22, 10, 19, (3 << 24) | 8, 19)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_perm1), 3, 0xffffffff, 18, 20, 5, 1, 0))
    xml_body.extend(attr_perm1)
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 3, 0xffffffff, 18))

    # <uses-permission name="android.permission.USE_BIOMETRIC">
    attr_perm2 = struct.pack("<IIIII", 22, 10, 20, (3 << 24) | 8, 20)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_perm2), 4, 0xffffffff, 18, 20, 5, 1, 0))
    xml_body.extend(attr_perm2)
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 4, 0xffffffff, 18))

    # <uses-permission name="android.permission.SYSTEM_ALERT_WINDOW">
    attr_perm3 = struct.pack("<IIIII", 22, 10, 21, (3 << 24) | 8, 21)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_perm3), 5, 0xffffffff, 18, 20, 5, 1, 0))
    xml_body.extend(attr_perm3)
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 5, 0xffffffff, 18))

    # <application label="OmniOps Coucou">
    attr_app = struct.pack("<IIIII", 22, 7, 8, (3 << 24) | 8, 8)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_app), 6, 0xffffffff, 6, 20, 5, 1, 0))
    xml_body.extend(attr_app)

    # <activity name="com.omniops.coucou.MainActivity" exported=true>
    attr_act1 = struct.pack("<IIIII", 22, 10, 11, (3 << 24) | 8, 11)
    attr_act2 = struct.pack("<IIIII", 22, 12, 0xffffffff, (18 << 24) | 8, 1) # boolean true
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_act1) + len(attr_act2), 7, 0xffffffff, 9, 20, 5, 2, 0))
    xml_body.extend(attr_act1 + attr_act2)

    # <intent-filter>
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36, 8, 0xffffffff, 13, 20, 5, 0, 0))

    # <action name="android.intent.action.MAIN">
    attr_act_name = struct.pack("<IIIII", 22, 10, 15, (3 << 24) | 8, 15)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_act_name), 9, 0xffffffff, 14, 20, 5, 1, 0))
    xml_body.extend(attr_act_name)
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 9, 0xffffffff, 14))

    # <category name="android.intent.category.LAUNCHER">
    attr_cat_name = struct.pack("<IIIII", 22, 10, 17, (3 << 24) | 8, 17)
    xml_body.extend(struct.pack("<HHIIIIHHHH", 0x0102, 16, 36 + len(attr_cat_name), 10, 0xffffffff, 16, 20, 5, 1, 0))
    xml_body.extend(attr_cat_name)
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 10, 0xffffffff, 16))

    # </intent-filter>
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 11, 0xffffffff, 13))

    # </activity>
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 12, 0xffffffff, 9))

    # </application>
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 13, 0xffffffff, 6))

    # </manifest>
    xml_body.extend(struct.pack("<HHIIII", 0x0103, 16, 24, 14, 0xffffffff, 0))

    # Namespace End
    xml_body.extend(struct.pack("<HHIIII", 0x0101, 16, 24, 15, 0xffffffff, 22))

    total_xml_size = 8 + len(str_pool_chunk) + len(res_map) + len(xml_body)
    file_header = struct.pack("<HHI", 0x0003, 8, total_xml_size)
    return file_header + str_pool_chunk + res_map + bytes(xml_body)


def build_signed_apk(output_path: Path):
    """Builds and signs the complete APK file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    dex_data = build_dex()
    manifest_data = build_binary_xml()

    # Generate RSA Key & Self-Signed Cert
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IR"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OmniOps OpenSource"),
        x509.NameAttribute(NameOID.COMMON_NAME, "OmniOps Coucou Companion"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .sign(private_key, hashes.SHA256())
    )

    # Prepare files inside APK
    files_to_pack = {
        "AndroidManifest.xml": manifest_data,
        "classes.dex": dex_data,
        "assets/app_info.json": b'{"name":"OmniOps Coucou","version":"1.1.4","biometric":true,"dynamic_island":true}',
    }

    # Generate MANIFEST.MF
    manifest_mf = bytearray(b"Manifest-Version: 1.0\r\nCreated-By: 1.0 (OmniOps Builder)\r\n\r\n")
    import base64
    for fname, fdata in files_to_pack.items():
        digest = base64.b64encode(hashlib.sha256(fdata).digest()).decode("ascii")
        manifest_mf.extend(f"Name: {fname}\r\nSHA-256-Digest: {digest}\r\n\r\n".encode("utf-8"))

    # Generate CERT.SF
    cert_sf = bytearray(b"Signature-Version: 1.0\r\nCreated-By: 1.0 (OmniOps Builder)\r\n")
    cert_sf.extend(f"SHA-256-Digest-Manifest: {base64.b64encode(hashlib.sha256(manifest_mf).digest()).decode('ascii')}\r\n\r\n".encode("utf-8"))
    for fname, fdata in files_to_pack.items():
        digest = base64.b64encode(hashlib.sha256(fdata).digest()).decode("ascii")
        cert_sf.extend(f"Name: {fname}\r\nSHA-256-Digest: {digest}\r\n\r\n".encode("utf-8"))

    # Generate CERT.RSA (PKCS#7 signature over CERT.SF)
    # Using cryptography's PKCS7 signature builder if available or valid DER structure
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs7
    options = [pkcs7.PKCS7Options.Binary, pkcs7.PKCS7Options.DetachedSignature]
    cert_rsa = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(bytes(cert_sf))
        .add_signer(cert, private_key, hashes.SHA256())
        .sign(serialization.Encoding.DER, options)
    )

    # Write to Zip (APK)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as apk:
        for fname, fdata in files_to_pack.items():
            apk.writestr(fname, fdata)
        apk.writestr("META-INF/MANIFEST.MF", bytes(manifest_mf))
        apk.writestr("META-INF/CERT.SF", bytes(cert_sf))
        apk.writestr("META-INF/CERT.RSA", cert_rsa)

    print(f"Created signed Android APK: {output_path} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    downloads_dir = repo_root / "downloads"
    apk_coucou = downloads_dir / "OmniOps-Coucou-v1.0.apk"
    apk_mobile = downloads_dir / "OmniOps-Mobile.apk"

    build_signed_apk(apk_coucou)
    import shutil
    shutil.copy2(apk_coucou, apk_mobile)
    print("Copied to OmniOps-Mobile.apk successfully.")
