#!/usr/bin/env python3.13
"""Builds src/data/auSuburbPostcodes.json: every Australian suburb/locality with the postcode it
lies in, from official ABS data only (Australian Statistical Geography Standard, Edition 3, 2021):

  - Suburbs and Localities (SAL) 2021 boundaries
  - Postal Areas (POA) 2021 boundaries
  (c) Australian Bureau of Statistics, CC BY 4.0 -- https://www.abs.gov.au

A suburb gets a postcode only when a single postal area covers at least 80% of its area. A suburb
split between postcodes gets none -- the label shows the name alone rather than a wrong number.
The label point is a point inside the suburb (polylabel-style representative point).

  /usr/local/bin/python3.13 scripts/build-au-postcodes.py   (needs shapely; downloads ~40 MB)
"""
import json
import os
import sys
import urllib.parse
import urllib.request

from shapely.geometry import shape
from shapely.strtree import STRtree

BASE = "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/{layer}/MapServer/0/query"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "src/data/auSuburbPostcodes.json")
CACHE = os.path.join(ROOT, ".cache-abs")
COVER_MIN = 0.8
STATES = {"New South Wales": "NSW", "Victoria": "VIC", "Queensland": "QLD", "South Australia": "SA", "Western Australia": "WA",
          "Tasmania": "TAS", "Northern Territory": "NT", "Australian Capital Territory": "ACT", "Other Territories": "OT"}
PAGE = 1000


def fetch(layer, fields):
    os.makedirs(CACHE, exist_ok=True)
    feats = []
    offset = 0
    while True:
        cache = os.path.join(CACHE, f"{layer}-{offset}.json")
        if os.path.exists(cache):
            data = json.load(open(cache))
        else:
            q = urllib.parse.urlencode({
                "where": "1=1", "outFields": fields, "returnGeometry": "true", "outSR": "4326",
                "maxAllowableOffset": "0.0003", "geometryPrecision": "5", "f": "geojson",
                "resultOffset": offset, "resultRecordCount": PAGE, "orderByFields": "objectid",
            })
            with urllib.request.urlopen(BASE.format(layer=layer) + "?" + q, timeout=180) as r:
                data = json.load(r)
            json.dump(data, open(cache, "w"))
        got = data.get("features", [])
        feats += got
        print(layer, offset, len(got), file=sys.stderr)
        if len(got) < PAGE:
            return feats
        offset += PAGE


def clean_name(name):
    # SAL names carry a state suffix where a name repeats across states: "Punchbowl (NSW)".
    return name.split(" (")[0].strip()


def main():
    sal = fetch("SAL", "sal_code_2021,sal_name_2021,state_name_2021")
    poa = fetch("POA", "poa_code_2021")
    poa_geoms, poa_codes = [], []
    for f in poa:
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"]).buffer(0)
        if g.is_empty:
            continue
        poa_geoms.append(g)
        poa_codes.append(f["properties"]["poa_code_2021"])
    tree = STRtree(poa_geoms)

    rows = []
    split = 0
    for f in sal:
        p = f["properties"]
        name = clean_name(p["sal_name_2021"])
        if not f.get("geometry") or name.startswith(("No usual address", "Migratory", "Outside")):
            continue
        g = shape(f["geometry"]).buffer(0)
        if g.is_empty or g.area == 0:
            continue
        best_code, best_share = None, 0.0
        for i in tree.query(g):
            share = g.intersection(poa_geoms[i]).area / g.area
            if share > best_share:
                best_code, best_share = poa_codes[i], share
        code = best_code if best_share >= COVER_MIN else None
        if code is None:
            split += 1
        pt = g.representative_point()
        rows.append([name, round(pt.y, 4), round(pt.x, 4), code, STATES.get(p["state_name_2021"], "OT")])

    rows.sort(key=lambda r: (r[4], r[0]))
    out = {
        "_source": "ABS ASGS Edition 3 (2021): Suburbs and Localities + Postal Areas, (c) Australian Bureau of Statistics, CC BY 4.0. "
        "A suburb has a postcode only when one postal area covers >= 80% of it.",
        "fields": ["name", "lat", "lng", "postcode", "state"],
        "rows": rows,
    }
    json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{len(rows)} suburbs, {split} without a single postcode -> {OUT} ({os.path.getsize(OUT) // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
