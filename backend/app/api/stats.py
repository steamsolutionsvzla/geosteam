from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.db.database import get_pool
from app.core.security import CurrentUser, require_admin

router = APIRouter(prefix="/api/stats", tags=["Estadísticas"])


class VisitIn(BaseModel):
    path: str
    referrer: str | None = None


@router.post("/visit", status_code=204)
async def registrar_visita(payload: VisitIn):
    """
    Endpoint público: cada página del sitio hace un POST silencioso aquí
    (ver js/visit-tracker.js) para poder graficar visitas en el panel.
    """
    pool = get_pool()
    async with pool.acquire() as connection:
        await connection.execute(
            "INSERT INTO page_visits (path, referrer) VALUES ($1, $2)",
            payload.path[:500],
            (payload.referrer or "")[:500],
        )
    return None


@router.get("/visits")
async def visitas(
    days: int = Query(14, ge=1, le=90),
    _: CurrentUser = Depends(require_admin),
):
    pool = get_pool()
    desde = date.today() - timedelta(days=days - 1)

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            SELECT date_trunc('day', visited_at)::date AS dia, COUNT(*) AS total
            FROM page_visits
            WHERE visited_at >= $1
            GROUP BY dia
            ORDER BY dia
            """,
            desde,
        )
        total_historico = await connection.fetchval("SELECT COUNT(*) FROM page_visits")
        total_hoy = await connection.fetchval(
            "SELECT COUNT(*) FROM page_visits WHERE visited_at::date = CURRENT_DATE"
        )
        paginas_top = await connection.fetch(
            """
            SELECT path, COUNT(*) AS total
            FROM page_visits
            WHERE visited_at >= $1
            GROUP BY path
            ORDER BY total DESC
            LIMIT 5
            """,
            desde,
        )

    por_dia = {r["dia"].isoformat(): r["total"] for r in rows}
    serie = []
    for i in range(days):
        d = (desde + timedelta(days=i)).isoformat()
        serie.append({"fecha": d, "visitas": por_dia.get(d, 0)})

    return {
        "rango_dias": days,
        "total_historico": total_historico,
        "total_hoy": total_hoy,
        "serie": serie,
        "paginas_top": [{"path": r["path"], "total": r["total"]} for r in paginas_top],
    }
