from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
import bcrypt

from app.db.database import get_pool
from app.core.security import CurrentUser, require_admin

router = APIRouter(prefix="/api/users", tags=["Usuarios"])


# --- Schemas ---
class UserCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)   # el frontend envía "nombre"
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    roles: List[str] = ["ROLE_LECTOR"]
    workspaces: List[str] = ["geosteam"]


class UserUpdateRoles(BaseModel):
    roles: List[str]


class UserUpdateWorkspaces(BaseModel):
    workspaces: List[str]


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "nombre": row["fullname"],  # mapeamos a "nombre" para el frontend
        "email": row["email"],
        "roles": row["roles"] if row["roles"] else [],
        "workspaces": row["workspaces"] if row["workspaces"] else [],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


# --- Endpoints ---

@router.get("")
async def list_users(_: CurrentUser = Depends(require_admin)):
    pool = get_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            SELECT
                u.id,
                u.fullname,
                u.email,
                u.created_at,
                array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS roles,
                array_agg(DISTINCT w.name) FILTER (WHERE w.name IS NOT NULL) AS workspaces
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            LEFT JOIN user_workspaces uw ON u.id = uw.user_id
            LEFT JOIN workspaces w ON uw.workspace_id = w.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
            """
        )

    usuarios = []
    for r in rows:
        roles = r["roles"] or []
        workspaces = r["workspaces"] or []
        usuarios.append({
            "id": r["id"],
            "nombre": r["fullname"],
            "email": r["email"],
            "roles": roles,
            "workspaces": workspaces,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })

    return {"total": len(usuarios), "usuarios": usuarios}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, _: CurrentUser = Depends(require_admin)):
    pool = get_pool()
    try:
        async with pool.acquire() as connection:
            # 1. Validar roles
            if payload.roles:
                role_rows = await connection.fetch(
                    "SELECT name FROM roles WHERE name = ANY($1)", payload.roles
                )
                found_roles = {r["name"] for r in role_rows}
                missing_roles = set(payload.roles) - found_roles
                if missing_roles:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Roles no encontrados: {', '.join(missing_roles)}"
                    )

            # 2. Validar workspaces
            if payload.workspaces:
                ws_rows = await connection.fetch(
                    "SELECT name FROM workspaces WHERE name = ANY($1)", payload.workspaces
                )
                found_ws = {w["name"] for w in ws_rows}
                missing_ws = set(payload.workspaces) - found_ws
                if missing_ws:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Workspaces no encontrados: {', '.join(missing_ws)}"
                    )

            # 3. Verificar email duplicado
            existing = await connection.fetchval(
                "SELECT id FROM users WHERE email = $1", payload.email
            )
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail="Ya existe un usuario con ese correo",
                )

            # 4. Insertar usuario (columna fullname, no nombre)
            hashed = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            user_row = await connection.fetchrow(
                """
                INSERT INTO users (fullname, email, password, is_active)
                VALUES ($1, $2, $3, true)
                RETURNING id, fullname, email, created_at
                """,
                payload.nombre, payload.email, hashed
            )
            user_id = user_row["id"]

            # 5. Asignar roles
            if payload.roles:
                await connection.executemany(
                    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE name = $2))",
                    [(user_id, role_name) for role_name in payload.roles]
                )

            # 6. Asignar workspaces
            if payload.workspaces:
                await connection.executemany(
                    "INSERT INTO user_workspaces (user_id, workspace_id) VALUES ($1, (SELECT id FROM workspaces WHERE name = $2))",
                    [(user_id, ws_name) for ws_name in payload.workspaces]
                )

        # Devolver usuario creado
        return {
            "id": user_row["id"],
            "nombre": user_row["fullname"],
            "email": user_row["email"],
            "roles": payload.roles,
            "workspaces": payload.workspaces,
            "created_at": user_row["created_at"].isoformat() if user_row["created_at"] else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error interno al crear usuario: {str(e)}"
        )
@router.put("/{user_id}/roles")
async def update_roles(
    user_id: int,
    payload: UserUpdateRoles,
    admin: CurrentUser = Depends(require_admin)
):
    pool = get_pool()
    async with pool.acquire() as connection:
        user = await connection.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        role_rows = await connection.fetch(
            "SELECT name FROM roles WHERE name = ANY($1)", payload.roles
        )
        found_roles = {r["name"] for r in role_rows}
        missing_roles = set(payload.roles) - found_roles
        if missing_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Roles no encontrados: {', '.join(missing_roles)}"
            )

        await connection.execute("DELETE FROM user_roles WHERE user_id = $1", user_id)
        if payload.roles:
            await connection.executemany(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE name = $2))",
                [(user_id, role_name) for role_name in payload.roles]
            )

    return {"message": "Roles actualizados correctamente", "roles": payload.roles}


@router.put("/{user_id}/workspaces")
async def update_workspaces(
    user_id: int,
    payload: UserUpdateWorkspaces,
    admin: CurrentUser = Depends(require_admin)
):
    pool = get_pool()
    async with pool.acquire() as connection:
        user = await connection.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        ws_rows = await connection.fetch(
            "SELECT name FROM workspaces WHERE name = ANY($1)", payload.workspaces
        )
        found_ws = {w["name"] for w in ws_rows}
        missing_ws = set(payload.workspaces) - found_ws
        if missing_ws:
            raise HTTPException(
                status_code=400,
                detail=f"Workspaces no encontrados: {', '.join(missing_ws)}"
            )

        await connection.execute("DELETE FROM user_workspaces WHERE user_id = $1", user_id)
        if payload.workspaces:
            await connection.executemany(
                "INSERT INTO user_workspaces (user_id, workspace_id) VALUES ($1, (SELECT id FROM workspaces WHERE name = $2))",
                [(user_id, ws_name) for ws_name in payload.workspaces]
            )

    return {"message": "Workspaces actualizados correctamente", "workspaces": payload.workspaces}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, admin: CurrentUser = Depends(require_admin)):
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar tu propia cuenta mientras la usas",
        )
    pool = get_pool()
    async with pool.acquire() as connection:
        result = await connection.execute("DELETE FROM users WHERE id = $1", user_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return None


@router.get("/roles")
async def list_roles(_: CurrentUser = Depends(require_admin)):
    """Lista todos los roles disponibles (solo admin)."""
    pool = get_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch("SELECT id, name FROM roles ORDER BY name")
    return [{"id": r["id"], "name": r["name"]} for r in rows]