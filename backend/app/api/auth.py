from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
import bcrypt

from app.db.database import get_pool
from app.core.security import create_access_token, get_current_user, CurrentUser

router = APIRouter(prefix="/api", tags=["Auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
async def login(credentials: LoginRequest):
    pool = get_pool()

    async with pool.acquire() as connection:
        usuario_encontrado = await connection.fetchrow(
            "SELECT * FROM users WHERE email = $1",
            credentials.email
        )

    if not usuario_encontrado:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos"
        )

    password_valida = bcrypt.checkpw(
        credentials.password.encode('utf-8'),
        usuario_encontrado['password'].encode('utf-8')
    )

    if not password_valida:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos"
        )

    # Obtener roles y workspaces (misma lógica que get_current_user)
    user_id = usuario_encontrado["id"]
    async with pool.acquire() as connection:
        # Obtener roles
        roles_row = await connection.fetchrow(
            """
            SELECT array_agg(r.name) AS roles
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
            """,
            user_id
        )
        roles_list = [r for r in roles_row["roles"] if r is not None] if roles_row else []

        is_admin = "ROLE_ADMIN" in roles_list

        # Obtener workspaces
        if is_admin:
            workspaces_rows = await connection.fetch(
                "SELECT name FROM workspaces ORDER BY name"
            )
            workspaces_list = [w["name"] for w in workspaces_rows]
        else:
            workspaces_rows = await connection.fetch(
                """
                SELECT w.name
                FROM user_workspaces uw
                JOIN workspaces w ON uw.workspace_id = w.id
                WHERE uw.user_id = $1
                ORDER BY w.name
                """,
                user_id
            )
            workspaces_list = [w["name"] for w in workspaces_rows]

    token = create_access_token({
        "sub": str(user_id),
        "email": usuario_encontrado["email"],
        "roles": roles_list,
        "workspaces": workspaces_list,
    })

    return {
        "ok": True,
        "mensaje": "Inicio de sesión exitoso",
        "access_token": token,
        "token_type": "bearer",
        "usuario": {
            "id": user_id,
            "nombre": usuario_encontrado["fullname"],  # importante: fullname
            "email": usuario_encontrado["email"],
            "roles": roles_list,
            "workspaces": workspaces_list,
        },
    }


@router.get("/me")
async def me(current_user: CurrentUser = Depends(get_current_user)):
    return current_user.to_dict()