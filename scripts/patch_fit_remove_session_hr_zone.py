#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import struct
import sys
from pathlib import Path

TARGET_DEVICE = {
    "serial_number": 3448008332,
    "manufacturer": 1,
    "product": 4315,
    "software_version": 2709,
}

MESG_FILE_ID = 0
MESG_SESSION = 18
MESG_DEVICE_INFO = 23

SESSION_HR_ZONE_FIELD_NUM = 65
SESSION_HR_ZONE_FIELD_SIZE = 20


def fit_crc16(data: bytes) -> int:
    crc_table = (
        0x0000, 0xCC01, 0xD801, 0x1400,
        0xF001, 0x3C00, 0x2800, 0xE401,
        0xA001, 0x6C00, 0x7800, 0xB401,
        0x5000, 0x9C01, 0x8801, 0x4400,
    )
    crc = 0
    for byte in data:
        tmp = crc_table[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ crc_table[byte & 0x0F]

        tmp = crc_table[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ crc_table[(byte >> 4) & 0x0F]

    return crc & 0xFFFF


def transform_payload(original_payload: bytes, definition: dict, changed: list) -> bytes:
    mesg_num = definition["mesg_num"]
    endian = definition["endian"]
    out = bytearray()

    pos = 0
    for field_num, size, _base_type in definition["fields"]:
        field_bytes = original_payload[pos:pos + size]

        if mesg_num == MESG_SESSION and field_num == SESSION_HR_ZONE_FIELD_NUM and size == SESSION_HR_ZONE_FIELD_SIZE:
            try:
                old_vals = struct.unpack(endian + "5I", field_bytes)
            except struct.error:
                old_vals = tuple(field_bytes)
            changed.append(("session", "remove_time_in_hr_zone", old_vals))
            pos += size
            continue

        if mesg_num == MESG_FILE_ID:
            if field_num == 1 and size >= 2:
                field_bytes = struct.pack(endian + "H", TARGET_DEVICE["manufacturer"]) + field_bytes[2:]
                changed.append(("file_id", "manufacturer", TARGET_DEVICE["manufacturer"]))
            elif field_num == 2 and size >= 2:
                field_bytes = struct.pack(endian + "H", TARGET_DEVICE["product"]) + field_bytes[2:]
                changed.append(("file_id", "product", TARGET_DEVICE["product"]))
            elif field_num == 3 and size >= 4:
                field_bytes = struct.pack(endian + "I", TARGET_DEVICE["serial_number"]) + b"\x00" * max(0, size - 4)
                changed.append(("file_id", "serial_number", TARGET_DEVICE["serial_number"]))
        elif mesg_num == MESG_DEVICE_INFO:
            if field_num == 2 and size >= 2:
                field_bytes = struct.pack(endian + "H", TARGET_DEVICE["manufacturer"]) + field_bytes[2:]
                changed.append(("device_info", "manufacturer", TARGET_DEVICE["manufacturer"]))
            elif field_num == 3 and size >= 4:
                field_bytes = struct.pack(endian + "I", TARGET_DEVICE["serial_number"]) + b"\x00" * max(0, size - 4)
                changed.append(("device_info", "serial_number", TARGET_DEVICE["serial_number"]))
            elif field_num == 4 and size >= 2:
                field_bytes = struct.pack(endian + "H", TARGET_DEVICE["product"]) + field_bytes[2:]
                changed.append(("device_info", "product", TARGET_DEVICE["product"]))
            elif field_num == 5 and size >= 2:
                field_bytes = struct.pack(endian + "H", TARGET_DEVICE["software_version"]) + field_bytes[2:]
                changed.append(("device_info", "software_version", TARGET_DEVICE["software_version"]))

        out.extend(field_bytes)
        pos += size

    for _field_num, size, _dev_data_index in definition["dev_fields"]:
        out.extend(original_payload[pos:pos + size])
        pos += size

    if pos != len(original_payload):
        raise ValueError("payload 解析长度不匹配")

    return bytes(out)


def patch_fit(input_fit: str, output_fit: str):
    src = Path(input_fit).read_bytes()
    if len(src) < 14:
        raise ValueError("文件过短，不像有效的 FIT 文件")

    header_size = src[0]
    if src[8:12] != b".FIT":
        raise ValueError("不是有效的 FIT 文件（缺少 .FIT 标识）")

    old_data_size = struct.unpack_from("<I", src, 4)[0]
    data_start = header_size
    data_end = header_size + old_data_size

    if data_end + 2 > len(src):
        raise ValueError("FIT 文件长度异常，data_size 与实际文件不匹配")

    data = src[data_start:data_end]
    out_data = bytearray()
    definitions = {}
    changed = []

    i = 0
    while i < len(data):
        rec_hdr = data[i]
        i += 1

        if (rec_hdr & 0x80) and not (rec_hdr & 0x40):
            local_msg_num = (rec_hdr >> 5) & 0x03
            if local_msg_num not in definitions:
                raise ValueError(f"遇到未定义的 compressed local message: {local_msg_num}")
            definition = definitions[local_msg_num]
            payload = data[i:i + definition["orig_size"]]
            if len(payload) != definition["orig_size"]:
                raise ValueError("compressed data message 越界")
            i += definition["orig_size"]

            new_payload = transform_payload(payload, definition, changed)
            out_data.append(rec_hdr)
            out_data.extend(new_payload)
            continue

        is_definition = bool(rec_hdr & 0x40)
        has_dev_fields = bool(rec_hdr & 0x20)
        local_msg_num = rec_hdr & 0x0F

        if is_definition:
            if i + 5 > len(data):
                raise ValueError("定义消息越界")

            reserved = data[i]
            arch = data[i + 1]
            i += 2

            endian = "<" if arch == 0 else ">"
            mesg_num = struct.unpack_from(endian + "H", data, i)[0]
            i += 2

            num_fields = data[i]
            i += 1

            fields = []
            orig_size = 0
            for _ in range(num_fields):
                if i + 3 > len(data):
                    raise ValueError("字段定义越界")
                field_num = data[i]
                size = data[i + 1]
                base_type = data[i + 2]
                i += 3
                fields.append((field_num, size, base_type))
                orig_size += size

            dev_fields = []
            num_dev_fields = 0
            if has_dev_fields:
                if i + 1 > len(data):
                    raise ValueError("开发者字段计数越界")
                num_dev_fields = data[i]
                i += 1
                for _ in range(num_dev_fields):
                    if i + 3 > len(data):
                        raise ValueError("开发者字段定义越界")
                    field_num = data[i]
                    size = data[i + 1]
                    dev_data_index = data[i + 2]
                    i += 3
                    dev_fields.append((field_num, size, dev_data_index))
                    orig_size += size

            new_fields = []
            for field_num, size, base_type in fields:
                if mesg_num == MESG_SESSION and field_num == SESSION_HR_ZONE_FIELD_NUM and size == SESSION_HR_ZONE_FIELD_SIZE:
                    changed.append(("session_definition", "remove_field_65", size))
                    continue
                new_fields.append((field_num, size, base_type))

            out_data.append(rec_hdr)
            out_data.extend(bytes([reserved, arch]))
            out_data.extend(struct.pack(endian + "H", mesg_num))
            out_data.append(len(new_fields))
            for field_num, size, base_type in new_fields:
                out_data.extend(bytes([field_num, size, base_type]))
            if has_dev_fields:
                out_data.append(num_dev_fields)
                for field_num, size, dev_data_index in dev_fields:
                    out_data.extend(bytes([field_num, size, dev_data_index]))

            definitions[local_msg_num] = {
                "mesg_num": mesg_num,
                "endian": endian,
                "fields": fields,
                "dev_fields": dev_fields,
                "orig_size": orig_size,
            }
        else:
            if local_msg_num not in definitions:
                raise ValueError(f"遇到未定义的 local message: {local_msg_num}")
            definition = definitions[local_msg_num]
            payload = data[i:i + definition["orig_size"]]
            if len(payload) != definition["orig_size"]:
                raise ValueError("data message 越界")
            i += definition["orig_size"]

            new_payload = transform_payload(payload, definition, changed)
            out_data.append(rec_hdr)
            out_data.extend(new_payload)

    out = bytearray(src[:header_size])
    struct.pack_into("<I", out, 4, len(out_data))

    if header_size == 14:
        header_crc = fit_crc16(out[:12])
        struct.pack_into("<H", out, 12, header_crc)

    out.extend(out_data)
    file_crc = fit_crc16(out)
    out.extend(struct.pack("<H", file_crc))

    Path(output_fit).write_bytes(out)
    return changed


def main():
    if len(sys.argv) == 1:
        input_fit = "input.fit"
        output_fit = "output-garmin965.fit"
    elif len(sys.argv) == 3:
        input_fit = sys.argv[1]
        output_fit = sys.argv[2]
    else:
        print("用法:")
        print("  python patch_fit_remove_session_hr_zone.py")
        print("  或")
        print("  python patch_fit_remove_session_hr_zone.py 输入.fit 输出.fit")
        sys.exit(1)

    changed = patch_fit(input_fit, output_fit)

    print("修改完成：", output_fit)
    print("修改内容：")
    for item in changed:
        print("  -", item)


if __name__ == "__main__":
    main()
