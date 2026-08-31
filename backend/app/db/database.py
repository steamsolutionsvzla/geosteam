import asyncpg
import bcrypt

from app.config import settings

pool: asyncpg.Pool | None = None


async def connect_db():
    global pool
    pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=1,
        max_size=10
    )


async def disconnect_db():
    global pool
    if pool:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("El pool de base de datos no ha sido inicializado.")
    return pool


async def init_db():
    """
    Solo siembra datos iniciales (roles, workspaces, admin) si no existen.
    No crea tablas, porque se asume que ya existen.
    """
    db_pool = get_pool()
    async with db_pool.acquire() as connection:
        # 1. Insertar roles por defecto
        await connection.execute("""
            INSERT INTO roles (name)
            VALUES ('ROLE_ADMIN'), ('ROLE_LECTOR')
            ON CONFLICT (name) DO NOTHING;
        """)

        # 2. Insertar workspace por defecto
        await connection.execute("""
            INSERT INTO workspaces (name, description)
            VALUES ('geosteam', 'Workspace principal')
            ON CONFLICT (name) DO NOTHING;
        """)

        # 3. Crear usuario administrador si no existe
        admin_email = settings.ADMIN_SEED_EMAIL
        existing_admin = await connection.fetchval(
            "SELECT id FROM users WHERE email = $1", admin_email
        )
        if not existing_admin:
            hashed = bcrypt.hashpw(
                settings.ADMIN_SEED_PASSWORD.encode("utf-8"),
                bcrypt.gensalt()
            ).decode("utf-8")

            admin_row = await connection.fetchrow(
                """
                INSERT INTO users (fullname, email, password, is_active)
                VALUES ($1, $2, $3, true)
                RETURNING id
                """,
                settings.ADMIN_SEED_NOMBRE,
                admin_email,
                hashed
            )
            admin_id = admin_row["id"]

            # Obtener ids del rol y workspace
            role_id = await connection.fetchval(
                "SELECT id FROM roles WHERE name = 'ROLE_ADMIN'"
            )
            ws_id = await connection.fetchval(
                "SELECT id FROM workspaces WHERE name = 'geosteam'"
            )

            if role_id:
                await connection.execute(
                    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
                    admin_id, role_id
                )
            if ws_id:
                await connection.execute(
                    "INSERT INTO user_workspaces (user_id, workspace_id) VALUES ($1, $2)",
                    admin_id, ws_id
                )

            print(
                "🌱 Usuario administrador creado automáticamente -> "
                f"email: {admin_email}  password: {settings.ADMIN_SEED_PASSWORD}"
            )