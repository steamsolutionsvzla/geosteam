# app/api/workspaces.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db.database import get_pool
from app.core.security import require_admin, CurrentUser

router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None


@router.get("")
async def list_workspaces(_: CurrentUser = Depends(require_admin)):
    """Lista todos los workspaces (solo admin)."""
    pool = get_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            "SELECT id, name, description, created_at FROM workspaces ORDER BY name"
        )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate,
    _: CurrentUser = Depends(require_admin),
):
    """Crea un nuevo workspace (solo admin)."""
    pool = get_pool()
    async with pool.acquire() as connection:
        # Verificar duplicado
        existing = await connection.fetchval(
            "SELECT id FROM workspaces WHERE name = $1", payload.name
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Ya existe un workspace con ese nombre"
            )

        row = await connection.fetchrow(
            """
            INSERT INTO workspaces (name, description)
            VALUES ($1, $2)
            RETURNING id, name, description, created_at
            """,
            payload.name,
            payload.description,
        )
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }