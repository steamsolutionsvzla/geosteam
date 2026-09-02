from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import Depends, Header, HTTPException, status
from jose import jwt, JWTError

from app.config import settings
from app.db.database import get_pool


class CurrentUser:
    def __init__(self, id: int, nombre: str, email: str, roles: List[str], workspaces: List[str]):
        self.id = id
        self.nombre = nombre
        self.email = email
        self.roles = roles or []
        self.workspaces = workspaces or []

    def to_dict(self):
        return {
            "id": self.id,
            "nombre": self.nombre,
            "email": self.email,
            "roles": self.roles,
            "workspaces": self.workspaces,
        }


def create_access_token(data: dict, expires_minutes: Optional[int] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
        )


async def get_current_user(authorization: Optional[str] = Header(None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se proporcionó un token de acceso",
        )

    token = authorization.split(" ", 1)[1].strip()
    payload = _decode_token(token)

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    pool = get_pool()
    async with pool.acquire() as connection:
        # 1. Obtener datos del usuario y sus ROLES
        row = await connection.fetchrow(
            """
            SELECT u.id, u.fullname AS nombre, u.email,
                   array_agg(r.name) AS roles
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.id = $1
            GROUP BY u.id
            """,
            int(user_id),
        )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El usuario del token ya no existe",
        )

    roles_list = [r for r in row["roles"] if r is not None]
    is_admin = "ROLE_ADMIN" in roles_list

    # 2. Obtener WORSPACES según el rol
    async with pool.acquire() as connection:
        if is_admin:
            # ADMIN: obtiene TODOS los workspaces existentes
            workspaces_rows = await connection.fetch(
                "SELECT name FROM workspaces ORDER BY name"
            )
            workspaces_list = [w["name"] for w in workspaces_rows]
        else:
            # Usuario normal: obtiene SOLO los asignados
            workspaces_rows = await connection.fetch(
                """
                SELECT w.name
                FROM user_workspaces uw
                JOIN workspaces w ON uw.workspace_id = w.id
                WHERE uw.user_id = $1
                ORDER BY w.name
                """,
                int(user_id),
            )
            workspaces_list = [w["name"] for w in workspaces_rows]

    return CurrentUser(
        id=row["id"],
        nombre=row["nombre"],
        email=row["email"],
        roles=roles_list,
        workspaces=workspaces_list,
    )


async def get_current_user_optional(
    authorization: Optional[str] = Header(None),
) -> Optional[CurrentUser]:
    """
    Igual que get_current_user, pero para endpoints que también deben
    funcionar sin sesión (modo invitado). Si no viene header
    Authorization, devuelve None en lugar de lanzar 401. Si viene un
    token pero es inválido/expirado, sí lanza 401 (para forzar
    reautenticación en vez de degradar silenciosamente a invitado).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return await get_current_user(authorization)


async def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if "ROLE_ADMIN" not in current_user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere rol de administrador para esta acción",
        )
    return current_user