from contextlib import asynccontextmanager
import os
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx
from app.api import workspaces
from app.config import settings
# Importamos las funciones correctas del database.py
from app.db.database import connect_db, disconnect_db, init_db, get_pool

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.stats import router as stats_router
from app.core.security import get_current_user
from starlette.middleware.base import BaseHTTPMiddleware
import traceback

# --- CONFIGURACIÓN DE ENTORNO ---
# URL interna de GeoServer (dentro de la red Docker)
GEOSERVER_URL = os.getenv("GEOSERVER_URL", "http://geoserver:8080")

# Orígenes permitidos para CORS (leídos desde el .env, separados por comas)
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5500")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

# --- PALETA DE COLORES ESRI ---
ESRI_COLORS = {
    "agua": "#007AC2",       # Azul Esri
    "vegetacion": "#6A9A23", # Verde Esri
    "infraestructura": "#D94801", # Naranja/Rojo Esri
    "riesgo": "#E30613",     # Rojo intenso
    "limites": "#FFE000",    # Amarillo
    "petroleo": "#843C0C",   # Marrón
    "default": "#4E9A51"     # Verde neutro
}

def get_esri_color(layer_name):
    # Lógica simple para asignar colores basados en palabras clave del nombre
    name = layer_name.lower()
    if "agua" in name or "rio" in name or "lago" in name:
        return ESRI_COLORS["agua"]
    if "veget" in name or "bosque" in name or "parque" in name:
        return ESRI_COLORS["vegetacion"]
    if "oleoducto" in name or "tuberia" in name or "planta" in name or "estacion" in name:
        return ESRI_COLORS["infraestructura"]
    if "riesgo" in name or "peligro" in name:
        return ESRI_COLORS["riesgo"]
    if "limite" in name or "frontera" in name:
        return ESRI_COLORS["limites"]
    if "petrol" in name or "campo" in name or "bloque" in name:
        return ESRI_COLORS["petroleo"]
    return ESRI_COLORS["default"]


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

# --- MIDDLEWARE CORS (Ahora es dinámico desde el .env) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
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
    # Obtener los workspaces asignados al usuario
    try:
        db_pool = get_pool()
        async with db_pool.acquire() as connection:
            rows = await connection.fetch("""
                SELECT w.name 
                FROM workspaces w
                JOIN user_workspaces uw ON w.id = uw.workspace_id
                WHERE uw.user_id = $1
            """, current_user.id)
            available_workspaces = [row["name"] for row in rows]
    except Exception as e:
        print(f"Error leyendo workspaces: {e}")
        available_workspaces = ["petroleros"]

    if not available_workspaces:
        return {"workspace": "", "available_workspaces": [], "layers": []}

    headers = {"Authorization": settings.GEOSERVER_AUTH_HEADER}
    final_layers = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 🔄 ITERAMOS SOBRE TODOS LOS WORKSPACES ASIGNADOS
        for workspace in available_workspaces:
            try:
                # Obtener lista de capas para CADA workspace
                url_layers = f"{GEOSERVER_URL}/geoserver/rest/workspaces/{workspace}/layers.json"
                res_layers = await client.get(url_layers, headers=headers)
                
                if res_layers.status_code != 200:
                    continue

                data = res_layers.json()
                if not isinstance(data, dict):
                    continue

                layers_data = data.get("layers", {})
                if isinstance(layers_data, dict):
                    raw_layers = layers_data.get("layer", [])
                elif isinstance(layers_data, list):
                    raw_layers = layers_data
                else:
                    raw_layers = []

                # 🔄 ITERAMOS SOBRE CADA CAPA DEL WORKSPACE
                for layer in raw_layers:
                    layer_name = layer.get("name", "") if isinstance(layer, dict) else ""
                    if not layer_name:
                        continue

                    # ⬇️⬇️⬇️ CORRECCIÓN DEFINITIVA DE GEOMETRÍA ⬇️⬇️⬇️
                    geom_type = "Polygon"
                    try:
                        url_ft = f"{GEOSERVER_URL}/geoserver/rest/workspaces/{workspace}/featuretypes/{layer_name}.json"
                        res_ft = await client.get(url_ft, headers=headers)
                        if res_ft.status_code == 200:
                            ft_data = res_ft.json().get("featureType", {})
                            
                            # 1. Intentar leer el campo "geometry" (puede ser None o vacío)
                            raw_geom = ft_data.get("geometry")
                            
                            # 2. Si no está en el nivel superior, buscar en los atributos (¡La clave!)
                            if not raw_geom:
                                attributes = ft_data.get("attributes", {}).get("attribute", [])
                                for attr in attributes:
                                    if attr.get("name") == "geometry":
                                        # El binding nos dice la clase Java (ej: org.locationtech.jts.geom.Point)
                                        raw_geom = attr.get("binding", "")
                                        break
                                        
                            # 3. Si aún así está vacío, usar Polygon como último recurso
                            if not raw_geom:
                                raw_geom = "Polygon"
                                
                            # Convertir a string y buscar palabras clave en mayúsculas
                            geom_str = str(raw_geom).upper()
                            if "POINT" in geom_str:
                                geom_type = "Point"
                            elif "LINE" in geom_str:
                                geom_type = "LineString"
                            else:
                                geom_type = "Polygon"
                    except Exception:
                        pass
                    # ⬆️⬆️⬆️ FIN DE LA CORRECCIÓN ⬆️⬆️⬆️

                    # 🏷️ AGREGAMOS LA CAPA CON SU GRUPO CORRESPONDIENTE
                    final_layers.append({
                        "id": layer_name,
                        "group": workspace.capitalize(),
                        "label": layer_name.replace('_', ' '),
                        "typeName": layer_name,
                        "workspace": workspace,
                        "geometryType": geom_type,
                        "color": get_esri_color(layer_name),
                        "defaultVisible": False,
                        "opacity": 0.75,
                        "attributeLabels": {},
                        "demoData": { "type": "FeatureCollection", "features": [] }
                    })

            except Exception as e:
                print(f"Error obteniendo capas del workspace {workspace}: {e}")
                continue

    return {
        "workspace": available_workspaces[0], 
        "available_workspaces": available_workspaces,
        "layers": final_layers
    }


@app.api_route("/geoserver/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def geoserver_proxy(path: str, request: Request, current_user=Depends(get_current_user)):
    geoserver_url = f"{GEOSERVER_URL}/geoserver/{path}"

    body = await request.body()
    headers = dict(request.headers)
    headers["Authorization"] = settings.GEOSERVER_AUTH_HEADER

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