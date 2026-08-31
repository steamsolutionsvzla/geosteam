from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "127.0.0.1"
    DEBUG: bool = True

    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5433
    DB_NAME: str = "geosteam"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "0907"

    # ---- Seguridad JWT ----
    SECRET_KEY: str = "change-this-secret-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # ---- Usuario administrador sembrado en el primer arranque ----
    # Si la tabla "users" está vacía, se crea automáticamente esta cuenta
    # para poder entrar al panel de administrador la primera vez.
    ADMIN_SEED_NOMBRE: str = "Administrador GeoSteam"
    ADMIN_SEED_EMAIL: str = "admin@geosteam.com"
    ADMIN_SEED_PASSWORD: str = "Admin123!"

    # ---- GeoServer ----
    # URL pública (accesible desde el navegador) de la consola de GeoServer.
    # Es distinta de la URL interna que usa el backend para el proxy WFS.
    GEOSERVER_PUBLIC_URL: str = "http://localhost:8080/geoserver/web/"

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    model_config = SettingsConfigDict(
        env_file=None,  # Desactiva la búsqueda obligatoria de archivo físico y lee del entorno del sistema
        extra="ignore"
    )

settings = Settings()