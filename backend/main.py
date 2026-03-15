from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db, get_async_db
from app.auth import hash_password
from app.routers import auth, dashboard, transactions, accounts, sources, categories, reports, imports, budgets

app = FastAPI(
    title=settings.APP_NAME,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(transactions.router)
app.include_router(accounts.router)
app.include_router(sources.router)
app.include_router(categories.router)
app.include_router(reports.router)
app.include_router(imports.router)
app.include_router(budgets.router)


@app.on_event("startup")
async def startup():
    # Init DB
    init_db()

    # Create default admin user if not exists
    db = await get_async_db()
    try:
        cursor = await db.execute("SELECT id FROM users WHERE username = ?", (settings.DEFAULT_USERNAME,))
        if not await cursor.fetchone():
            pw_hash = hash_password(settings.DEFAULT_PASSWORD)
            await db.execute(
                "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
                (settings.DEFAULT_USERNAME, pw_hash, "管理员"),
            )
            await db.commit()
            print(f"[FinPad] Default admin created: {settings.DEFAULT_USERNAME}")
    finally:
        await db.close()


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
