from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx
from app.api import workspaces
from app.config import settings
from app.db.database import connect_db, disconnect_db, init_db

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.stats import router as stats_router
from app.core.security import get_current_user
from starlette.middleware.base import BaseHTTPMiddleware
import traceback


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await init_db()  # crea tablas (users, page_visits) y siembra el admin inicial
    yield
    await disconnect_db()


app = FastAPI(
    title="Geoportal API Backend",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
   
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Routers ----
app.include_router(auth_router)    # /api/login, /api/me
app.include_router(users_router)   # /api/users (CRUD, solo admin)
app.include_router(stats_router)   # /api/stats/visit, /api/stats/visits
app.include_router(workspaces.router)

# =========================================================
# ENDPOINTS PARA GESTIÓN DE CAPAS Y PROXY DE GEOSERVER
# =========================================================


@app.get("/api/mis-capas")
async def get_mis_capas(current_user=Depends(get_current_user)):
    workspace = getattr(current_user, "workspace", "geosteam") or "geosteam"

    # Credenciales de ADMIN de GeoServer (nunca deben ir en el frontend)
    headers = {"Authorization": "Basic YWRtaW46Z2Vvc2VydmVy"}

    async with httpx.AsyncClient() as client:
        url = f"http://geoserver:8080/geoserver/rest/workspaces/{workspace}/layers.json"
        res = await client.get(url, headers=headers)

        if res.status_code != 200:
            return Response(content=res.content, status_code=res.status_code, media_type="application/json")

        return Response(content=res.content, status_code=200, media_type="application/json")


@app.api_route("/geoserver/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def geoserver_proxy(path: str, request: Request, current_user=Depends(get_current_user)):
    geoserver_url = f"http://geoserver:8080/geoserver/{path}"

    body = await request.body()
    headers = dict(request.headers)
    headers["Authorization"] = "Basic YWRtaW46Z2Vvc2VydmVy"

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.request(
            request.method,
            geoserver_url,
            params=request.query_params,
            content=body,
            headers=headers
        )

    return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type"))


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Geoportal API Backend activo"}
class ExceptionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            return await call_next(request)
        except Exception as e:
            print("=" * 80)
            print("Error en la aplicación:")
            traceback.print_exc()
            print("=" * 80)
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=500,
                content={"detail": f"Error interno: {str(e)}"}
            )

app.add_middleware(ExceptionMiddleware)