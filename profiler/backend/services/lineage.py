"""Workbook lineage extraction for Excel Power Query metadata."""

import base64
import io
import re
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional


M_PREVIEW_LIMIT = 4000


# XML/package helpers
def xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_xml_bytes(contents: bytes) -> ET.Element:
    return ET.fromstring(contents)


def get_xml_attr(element: ET.Element, name: str) -> Optional[str]:
    for key, value in element.attrib.items():
        if xml_local_name(key) == name:
            return value

    return None


def normalize_m_identifier(identifier: str) -> str:
    value = identifier.strip()

    if value.startswith("#\"") and value.endswith("\""):
        return value[2:-1].replace('""', '"')

    return value


def decode_text_part(contents: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "utf-16le", "utf-8"):
        try:
            return contents.decode(encoding)
        except UnicodeDecodeError:
            continue

    return contents.decode("utf-8", errors="ignore")


def read_zip_text(workbook: zipfile.ZipFile, path: str) -> str:
    return decode_text_part(workbook.read(path))


# Power Query M formulas are stored inside Excel's customXml DataMashup payload.
def read_mashup_local_files(payload: bytes) -> Dict[str, bytes]:
    # Excel's DataMashup payload embeds a small ZIP-like package with a short prefix.
    # Python's ZipFile does not always read it cleanly, so walk local file headers directly.
    files = {}
    offset = 0

    while True:
        header_index = payload.find(b"PK\x03\x04", offset)
        if header_index == -1 or header_index + 30 > len(payload):
            break

        try:
            (
                _version,
                _flags,
                compression,
                _modified_time,
                _modified_date,
                _crc,
                compressed_size,
                _uncompressed_size,
                name_length,
                extra_length,
            ) = struct.unpack("<HHHHHIIIHH", payload[header_index + 4:header_index + 30])
        except Exception:
            break

        name_start = header_index + 30
        name_end = name_start + name_length
        data_start = name_end + extra_length
        data_end = data_start + compressed_size

        if data_end > len(payload):
            break

        name = payload[name_start:name_end].decode("utf-8", errors="ignore")
        compressed = payload[data_start:data_end]

        try:
            if compression == 8:
                files[name] = zlib.decompress(compressed, -15)
            elif compression == 0:
                files[name] = compressed
        except zlib.error:
            pass

        offset = data_end

    return files


def extract_mashup_formulas(workbook: zipfile.ZipFile) -> List[Dict[str, str]]:
    formulas = []

    for path in workbook.namelist():
        if not path.startswith("customXml/") or not path.endswith(".xml"):
            continue

        try:
            text = read_zip_text(workbook, path)
        except Exception:
            continue

        if "DataMashup" not in text:
            continue

        try:
            root = ET.fromstring(text)
            encoded_payload = "".join(root.itertext()).strip()
            payload = base64.b64decode(encoded_payload)
        except Exception:
            continue

        for formula_path, contents in read_mashup_local_files(payload).items():
            if formula_path.lower().endswith(".m"):
                formulas.append({
                    "path": formula_path,
                    "code": decode_text_part(contents),
                })

    return formulas


# Workbook package metadata tells us which queries exist and where they load.
def parse_workbook_connections(workbook: zipfile.ZipFile) -> Dict[str, Dict[str, Any]]:
    if "xl/connections.xml" not in workbook.namelist():
        return {}

    connections = {}
    root = parse_xml_bytes(workbook.read("xl/connections.xml"))

    for connection in root.iter():
        if xml_local_name(connection.tag) != "connection":
            continue

        connection_id = get_xml_attr(connection, "id")
        if not connection_id:
            continue

        name = get_xml_attr(connection, "name") or f"Connection {connection_id}"
        query_name = name.removeprefix("Query - ").strip()
        db_pr = next((child for child in connection if xml_local_name(child.tag) == "dbPr"), None)
        command = get_xml_attr(db_pr, "command") if db_pr is not None else None
        connection_string = get_xml_attr(db_pr, "connection") if db_pr is not None else None

        location_match = re.search(r"Location=(?:&quot;|\")?([^;&\"]+)(?:&quot;|\")?", connection_string or "")
        if location_match:
            query_name = location_match.group(1).strip()

        connections[connection_id] = {
            "id": connection_id,
            "name": name,
            "queryName": query_name,
            "description": get_xml_attr(connection, "description") or "",
            "command": command or "",
            "connectionString": connection_string or "",
            "saveData": get_xml_attr(connection, "saveData") == "1",
            "backgroundRefresh": get_xml_attr(connection, "background") == "1",
        }

    return connections


def parse_workbook_sheets(workbook: zipfile.ZipFile) -> Dict[str, str]:
    if "xl/workbook.xml" not in workbook.namelist() or "xl/_rels/workbook.xml.rels" not in workbook.namelist():
        return {}

    rels_root = parse_xml_bytes(workbook.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        get_xml_attr(rel, "Id"): get_xml_attr(rel, "Target")
        for rel in rels_root
        if get_xml_attr(rel, "Id") and get_xml_attr(rel, "Target")
    }
    sheets = {}
    workbook_root = parse_xml_bytes(workbook.read("xl/workbook.xml"))

    for sheet in workbook_root.iter():
        if xml_local_name(sheet.tag) != "sheet":
            continue

        sheet_name = get_xml_attr(sheet, "name")
        rel_id = get_xml_attr(sheet, "id")
        target = rel_targets.get(rel_id)

        if not sheet_name or not target:
            continue

        path = target.lstrip("/")
        if not path.startswith("xl/"):
            path = f"xl/{path}"

        sheets[path] = sheet_name

    return sheets


def normalize_part_path(base_path: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")

    parts = base_path.split("/")[:-1] + target.split("/")
    normalized = []

    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            if normalized:
                normalized.pop()
            continue
        normalized.append(part)

    return "/".join(normalized)


def parse_relationship_targets(workbook: zipfile.ZipFile, rel_path: str, relation_name: str) -> List[str]:
    if rel_path not in workbook.namelist():
        return []

    root = parse_xml_bytes(workbook.read(rel_path))
    base_path = rel_path.replace("/_rels/", "/").removesuffix(".rels")
    targets = []

    for rel in root:
        rel_type = get_xml_attr(rel, "Type") or ""
        target = get_xml_attr(rel, "Target")

        if relation_name in rel_type and target:
            targets.append(normalize_part_path(base_path, target))

    return targets


def parse_query_outputs(workbook: zipfile.ZipFile, connections: Dict[str, Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    sheets_by_path = parse_workbook_sheets(workbook)
    outputs_by_query = {}

    for sheet_path, sheet_name in sheets_by_path.items():
        sheet_number_match = re.search(r"sheet(\d+)\.xml$", sheet_path)
        if not sheet_number_match:
            continue

        rel_path = f"xl/worksheets/_rels/sheet{sheet_number_match.group(1)}.xml.rels"

        for table_path in parse_relationship_targets(workbook, rel_path, "relationships/table"):
            if table_path not in workbook.namelist():
                continue

            try:
                table_root = parse_xml_bytes(workbook.read(table_path))
            except Exception:
                continue

            table_name = get_xml_attr(table_root, "displayName") or get_xml_attr(table_root, "name") or table_path
            table_ref = get_xml_attr(table_root, "ref") or ""

            table_number_match = re.search(r"table(\d+)\.xml$", table_path)
            query_table_paths = []

            if table_number_match:
                query_rel_path = f"xl/tables/_rels/table{table_number_match.group(1)}.xml.rels"
                query_table_paths = parse_relationship_targets(workbook, query_rel_path, "relationships/queryTable")

            for query_table_path in query_table_paths:
                if query_table_path not in workbook.namelist():
                    continue

                try:
                    query_table_root = parse_xml_bytes(workbook.read(query_table_path))
                except Exception:
                    continue

                connection_id = get_xml_attr(query_table_root, "connectionId")
                connection = connections.get(connection_id or "")
                query_name = connection["queryName"] if connection else table_name

                outputs_by_query.setdefault(query_name, []).append({
                    "sheetName": sheet_name,
                    "tableName": table_name,
                    "range": table_ref,
                    "connectionId": connection_id,
                })

    return outputs_by_query


# Lightweight M-code parsing: enough to detect query definitions, dependencies, sources, and transforms.
def split_m_queries(formula_code: str) -> List[Dict[str, str]]:
    pattern = re.compile(
        r"(?ms)^shared\s+(?P<name>#\"(?:[^\"]|\"\")*\"|[A-Za-z_][\w.]*)\s*=\s*(?P<body>.*?);(?=\s*(?:shared\s+|$))"
    )

    return [
        {
            "name": normalize_m_identifier(match.group("name")),
            "rawName": match.group("name"),
            "code": match.group("body").strip(),
        }
        for match in pattern.finditer(formula_code)
    ]


def extract_transformations(m_code: str) -> List[Dict[str, str]]:
    known_functions = [
        ("Table.SelectColumns", "Kept selected columns"),
        ("Table.RemoveColumns", "Removed columns"),
        ("Table.RenameColumns", "Renamed columns"),
        ("Table.TransformColumnTypes", "Changed column types"),
        ("Table.SelectRows", "Filtered rows"),
        ("Table.NestedJoin", "Merged queries/tables"),
        ("Table.Join", "Joined queries/tables"),
        ("Table.Combine", "Appended tables"),
        ("Table.Group", "Grouped rows"),
        ("Table.Pivot", "Pivoted values"),
        ("Table.Unpivot", "Unpivoted columns"),
        ("Table.ExpandTableColumn", "Expanded nested table"),
        ("Table.AddColumn", "Added custom column"),
        ("Table.Sort", "Sorted rows"),
        ("Table.Distinct", "Removed duplicates"),
        ("Table.ReplaceValue", "Replaced values"),
    ]

    transformations = []

    for function_name, label in known_functions:
        count = m_code.count(function_name)
        if count:
            transformations.append({
                "function": function_name,
                "label": label,
                "count": count,
            })

    return transformations


def extract_sources(m_code: str) -> List[Dict[str, str]]:
    source_patterns = [
        (r"Excel\.CurrentWorkbook\(\)\{\[Name=\"([^\"]+)\"\]\}", "workbook-table"),
        (r"File\.Contents\(\"([^\"]+)\"\)", "file"),
        (r"Folder\.Files\(\"([^\"]+)\"\)", "folder"),
        (r"Web\.Contents\(\"([^\"]+)\"\)", "web"),
        (r"SharePoint\.Files\(\"([^\"]+)\"", "sharepoint"),
        (r"Sql\.Database\(\"([^\"]+)\"\s*,\s*\"([^\"]+)\"", "sql"),
        (r"Odbc\.DataSource\(\"([^\"]+)\"", "odbc"),
        (r"OData\.Feed\(\"([^\"]+)\"", "odata"),
    ]
    sources = []
    seen = set()

    for pattern, source_type in source_patterns:
        for match in re.finditer(pattern, m_code):
            value = " / ".join(group for group in match.groups() if group)
            key = (source_type, value)

            if key in seen:
                continue

            seen.add(key)
            sources.append({
                "type": source_type,
                "value": value,
            })

    return sources


def extract_query_dependencies(m_code: str, query_names: List[str], current_name: str) -> List[str]:
    dependencies = []

    for query_name in query_names:
        if query_name == current_name:
            continue

        patterns = [
            rf"(?<![\w.]){re.escape(query_name)}(?![\w.])",
            re.escape(f'#{chr(34)}{query_name}{chr(34)}'),
        ]

        if any(re.search(pattern, m_code) for pattern in patterns):
            dependencies.append(query_name)

    return sorted(set(dependencies))


def build_lineage_risks(queries: List[Dict[str, Any]], connections: Dict[str, Dict[str, Any]]) -> List[Dict[str, str]]:
    risks = []
    query_names = {query["name"] for query in queries}

    for connection in connections.values():
        if connection["queryName"] not in query_names:
            risks.append({
                "severity": "warning",
                "message": f"Connection '{connection['name']}' points to query '{connection['queryName']}', but no M definition was extracted.",
            })

    for query in queries:
        if not query["outputs"]:
            risks.append({
                "severity": "info",
                "message": f"Query '{query['name']}' appears to be connection-only or not loaded to a worksheet table.",
            })

        for source in query["sources"]:
            value = source["value"]
            if re.search(r"^[A-Za-z]:\\|/Users/|/home/", value):
                risks.append({
                    "severity": "warning",
                    "message": f"Query '{query['name']}' uses a local path: {value}",
                })

    for query in queries:
        for dependency in query["dependencies"]:
            if dependency not in query_names:
                risks.append({
                    "severity": "warning",
                    "message": f"Query '{query['name']}' references missing query '{dependency}'.",
                })

    return risks


# Public entry point used by upload/profile routes.
def inspect_workbook_lineage(contents: bytes, filename: str) -> Dict[str, Any]:
    if not filename.lower().endswith((".xlsx", ".xlsm")):
        return {
            "supported": False,
            "queries": [],
            "connections": [],
            "edges": [],
            "risks": [],
            "summary": {
                "queryCount": 0,
                "connectionCount": 0,
                "loadedQueryCount": 0,
                "sourceCount": 0,
                "riskCount": 0,
            },
        }

    try:
        with zipfile.ZipFile(io.BytesIO(contents)) as workbook:
            connections = parse_workbook_connections(workbook)
            outputs_by_query = parse_query_outputs(workbook, connections)
            formula_parts = extract_mashup_formulas(workbook)
    except zipfile.BadZipFile:
        return {
            "supported": False,
            "queries": [],
            "connections": [],
            "edges": [],
            "risks": [{"severity": "warning", "message": "Workbook package could not be inspected."}],
            "summary": {
                "queryCount": 0,
                "connectionCount": 0,
                "loadedQueryCount": 0,
                "sourceCount": 0,
                "riskCount": 1,
            },
        }

    parsed_queries = []

    for formula in formula_parts:
        for query in split_m_queries(formula["code"]):
            query["formulaPath"] = formula["path"]
            parsed_queries.append(query)

    query_names = [query["name"] for query in parsed_queries]
    queries = []
    edges = []

    for query in parsed_queries:
        dependencies = extract_query_dependencies(query["code"], query_names, query["name"])
        sources = extract_sources(query["code"])
        outputs = outputs_by_query.get(query["name"], [])

        for dependency in dependencies:
            edges.append({
                "from": dependency,
                "to": query["name"],
                "type": "query-reference",
            })

        for source in sources:
            edges.append({
                "from": source["value"],
                "to": query["name"],
                "type": source["type"],
            })

        for output in outputs:
            edges.append({
                "from": query["name"],
                "to": f"{output['sheetName']}!{output['tableName']}",
                "type": "loads-to",
            })

        queries.append({
            "name": query["name"],
            "formulaPath": query["formulaPath"],
            "dependencies": dependencies,
            "sources": sources,
            "outputs": outputs,
            "transformations": extract_transformations(query["code"]),
            "mCodePreview": query["code"][:M_PREVIEW_LIMIT],
            "mCodeLength": len(query["code"]),
        })

    risks = build_lineage_risks(queries, connections)
    source_count = sum(len(query["sources"]) for query in queries)

    return {
        "supported": True,
        "queries": queries,
        "connections": list(connections.values()),
        "edges": edges,
        "risks": risks,
        "summary": {
            "queryCount": len(queries),
            "connectionCount": len(connections),
            "loadedQueryCount": sum(1 for query in queries if query["outputs"]),
            "sourceCount": source_count,
            "riskCount": len(risks),
        },
    }
