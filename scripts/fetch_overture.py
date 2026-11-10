"""Overture Maps buildings for the bbox, read straight from the public S3 bucket.

    .venv/bin/python scripts/fetch_overture.py

DuckDB filters on each row group's bbox statistics, so only the few row groups
that touch Chennai are downloaded. Output: raw/overture/buildings-<release>.parquet
(geometry as WKB plus height, floors, class and the source datasets).
"""
from __future__ import annotations

import re
import time
import urllib.request

import duckdb

from common import BBOX, RAW, USER_AGENT, log

BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
MARGIN = 0.003


def latest_release() -> str:
    req = urllib.request.Request(f"{BUCKET}/?list-type=2&prefix=release/&delimiter=/",
                                 headers={"User-Agent": USER_AGENT})
    xml = urllib.request.urlopen(req, timeout=60).read().decode()
    releases = sorted(re.findall(r"<Prefix>release/([^<]+)/</Prefix>", xml))
    if not releases:
        raise SystemExit(f"Could not list Overture releases at {BUCKET}/?list-type=2&prefix=release/")
    return releases[-1]


def main():
    release = latest_release()
    out = RAW / "overture" / f"buildings-{release}.parquet"
    if out.exists():
        log(f"overture: cached {out.name}")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    s, w, n, e = BBOX["south"] - MARGIN, BBOX["west"] - MARGIN, BBOX["north"] + MARGIN, BBOX["east"] + MARGIN
    con = duckdb.connect()
    con.execute("SET memory_limit='1GB'; SET threads=4;")
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    src = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
    sql = f"""
    COPY (
      SELECT id,
             names.primary AS name,
             subtype, class, height, num_floors, min_height, roof_shape, is_underground, has_parts,
             list_transform(sources, lambda x: x.dataset) AS datasets,
             list_transform(sources, lambda x: x.record_id) AS record_ids,
             list_transform(sources, lambda x: x.confidence) AS confidences,
             ST_AsWKB(geometry) AS wkb
      FROM read_parquet('{src}', hive_partitioning=1)
      WHERE bbox.xmin <= {e} AND bbox.xmax >= {w} AND bbox.ymin <= {n} AND bbox.ymax >= {s}
    ) TO '{out.with_suffix(".part")}' (FORMAT PARQUET, COMPRESSION ZSTD);
    """
    t0 = time.time()
    log(f"overture: querying release {release} (this reads row-group stats from every file, a few minutes)")
    try:
        con.execute(sql)
    except Exception as exc:  # network or bucket layout problems
        raise SystemExit(
            f"\nOverture query failed: {exc}\nURL: {src}\n"
            "Manual fallback: install the overturemaps CLI elsewhere and run\n"
            f"  overturemaps download --bbox={w},{s},{e},{n} -f geoparquet --type=building -o buildings.parquet\n"
            f"then save it as {out}\n")
    out.with_suffix(".part").rename(out)
    n_rows = con.execute(f"SELECT count(*) FROM read_parquet('{out}')").fetchone()[0]
    stats = con.execute(f"""
        SELECT datasets[1] AS ds, count(*) AS n, count(height) AS with_h, count(num_floors) AS with_f
        FROM read_parquet('{out}') GROUP BY 1 ORDER BY 2 DESC""").fetchall()
    log(f"overture: {n_rows} buildings in {time.time()-t0:.0f}s -> {out.name} ({out.stat().st_size/1e6:.1f} MB)")
    for ds, cnt, wh, wf in stats:
        log(f"  {ds}: {cnt} buildings, {wh} with height, {wf} with floors")


if __name__ == "__main__":
    main()
