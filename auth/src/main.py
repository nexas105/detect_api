"""Auth Service — multi-tenant user management with JWT and API keys."""

from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_api_key,
    hash_api_key,
    hash_password,
    verify_password,
)
from db.src.database import get_db, init_db
from db.src.webhook_security import validate_webhook_url
from .models import APIKey, DemoLog, DetectionResult, Plan, PLAN_LIMITS, Role, Tenant, UsageLog, User, WebhookDelivery, WebhookEndpoint, WebhookTrigger

# ── Config ───────────────────────────────────────────────────────────────────

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

INTERNAL_AUTH_SECRET = os.getenv("INTERNAL_AUTH_SECRET", "")
if not INTERNAL_AUTH_SECRET:
    raise RuntimeError(
        "INTERNAL_AUTH_SECRET must be set — shared secret between the "
        "auth service and the API service for internal endpoints."
    )


def _require_internal(x_internal_token: str = Header(..., alias="X-Internal-Token")) -> None:
    """Guard internal endpoints called only by the API service.

    Required on any route that Traefik exposes publicly but which is
    only meant to be reachable from the API service (validate-key,
    usage/log, detections POST, demo/key, webhooks/by-key, ...).
    """
    if not hmac.compare_digest(x_internal_token, INTERNAL_AUTH_SECRET):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Internal access denied")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _ensure_default_tenant()
    await _ensure_admin()
    global _demo_api_key
    _demo_api_key = await _ensure_demo_account()
    yield


app = FastAPI(title="Auth Service", version="1.0.0", lifespan=lifespan)

# CORS: a wildcard origin together with credentials is unsafe (and rejected by
# browsers anyway). Only enable credentials when concrete origins/regex are
# configured; otherwise fall back to an anonymous wildcard.
# In production set CORS_ORIGINS to the Studio domain(s).
if CORS_ORIGINS or CORS_ORIGIN_REGEX:
    _cors_allow_origins = CORS_ORIGINS
    _cors_allow_credentials = True
else:
    _cors_allow_origins = ["*"]
    _cors_allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=_cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bearer = HTTPBearer()


# ── Schemas ──────────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="Password must be at least 8 characters")
    tenant_name: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    tenant_id: str
    tenant_name: str


class RefreshRequest(BaseModel):
    refresh_token: str


class APIKeyCreate(BaseModel):
    name: str
    is_master: bool = False


class APIKeyResponse(BaseModel):
    id: str
    name: str
    key: str
    is_master: bool
    rate_limit: int
    tenant_id: str
    created_at: str


class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    tenant_id: str
    is_active: bool


class RoleUpdate(BaseModel):
    role: Role


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="Password must be at least 8 characters")
    role: Role = Role.user
    tenant_id: str | None = None  # super admin can assign to any tenant


class TenantCreateRequest(BaseModel):
    name: str
    plan: Plan = Plan.free


class TenantResponse(BaseModel):
    id: str
    name: str
    plan: str
    is_active: bool
    user_count: int
    key_count: int
    limits: dict


class PlanUpdate(BaseModel):
    plan: Plan


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _ensure_default_tenant():
    from db.src.database import async_session

    async with async_session() as db:
        result = await db.execute(select(Tenant).where(Tenant.name == "default"))
        if not result.scalar_one_or_none():
            db.add(Tenant(name="default", plan=Plan.enterprise))
            await db.commit()


async def _ensure_demo_account():
    """Seed a 'demo' tenant + user + API key. All demo requests use this account."""
    from .auth import generate_api_key, hash_api_key
    from db.src.database import async_session

    async with async_session() as db:
        # Tenant
        result = await db.execute(select(Tenant).where(Tenant.name == "demo"))
        tenant = result.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(name="demo", plan=Plan.free)
            db.add(tenant)
            await db.flush()

        # User
        result = await db.execute(select(User).where(User.email == "demo@erohub.system"))
        demo_user = result.scalar_one_or_none()
        if not demo_user:
            demo_user = User(
                email="demo@erohub.system",
                password_hash=hash_password(generate_api_key()),  # random pw, no login
                role=Role.free,
                tenant_id=tenant.id,
            )
            db.add(demo_user)
            await db.flush()

        # API key. Plaintext is never stored, so it can't be recovered from an
        # existing row — (re)generate a raw key each startup and keep it only in
        # memory (_demo_api_key), persisting just its hash. Reuses the existing
        # row if present, otherwise creates one.
        # ponytail: rotates the demo key on every auth restart; harmless because
        # it's an internal system key the API service re-fetches lazily.
        raw = generate_api_key()
        result = await db.execute(
            select(APIKey).where(APIKey.tenant_id == tenant.id, APIKey.name == "demo-system-key", APIKey.is_active == True)
        )
        demo_key = result.scalar_one_or_none()
        if not demo_key:
            demo_key = APIKey(
                key=None,
                key_hash=hash_api_key(raw),
                key_prefix=raw[:8],
                name="demo-system-key",
                tenant_id=tenant.id,
                created_by=demo_user.id,
                is_master=True,
                rate_limit=100,  # shared limit across all demo users
            )
            db.add(demo_key)
        else:
            demo_key.key = None
            demo_key.key_hash = hash_api_key(raw)
            demo_key.key_prefix = raw[:8]

        await db.commit()
        print(f"Demo account ready: key={raw[:8]}...")
        return raw


# Store the demo key for the API service to use
_demo_api_key: str | None = None


async def _ensure_admin():
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        return
    from db.src.database import async_session

    async with async_session() as db:
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        if result.scalar_one_or_none():
            return
        result = await db.execute(select(Tenant).where(Tenant.name == "default"))
        tenant = result.scalar_one()
        db.add(User(
            email=ADMIN_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            role=Role.admin,
            tenant_id=tenant.id,
        ))
        await db.commit()
        print(f"Admin user created: {ADMIN_EMAIL}")


async def _get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(creds.credentials)
        if payload.get("type") != "access":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def _require_role(*roles: Role):
    async def check(user: User = Depends(_get_current_user)):
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(r.value for r in roles)}")
        return user
    return check


async def _require_super_admin(admin: User = Depends(_require_role(Role.admin)), db: AsyncSession = Depends(get_db)) -> User:
    """Admin in the 'default' tenant (super admin). Returns the admin user."""
    admin_tenant = await db.get(Tenant, admin.tenant_id)
    if admin_tenant.name != "default":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Super admin required")
    return admin


async def _get_tenant_limits(db: AsyncSession, tenant_id: str) -> dict:
    tenant = await db.get(Tenant, tenant_id)
    return tenant.effective_limits


async def _lock_tenant(db: AsyncSession, tenant_id: str) -> Tenant | None:
    """Fetch a tenant row with a row-level lock (FOR UPDATE).

    Used to serialise concurrent limit checks + inserts so two requests
    can't both pass the "< max_users / max_keys" guard and then both
    insert, overshooting the tenant plan.

    On SQLite the FOR UPDATE clause is silently ignored — but SQLite's
    default SERIALIZABLE-ish isolation (single writer) already prevents
    the TOCTOU we care about, so we only need the explicit lock on
    Postgres.
    """
    dialect = db.bind.dialect.name if db.bind is not None else ""
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    if dialect == "postgresql":
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _login_response(user: User, tenant_name: str) -> LoginResponse:
    return LoginResponse(
        access_token=create_access_token(user.id, user.role.value, user.tenant_id),
        refresh_token=create_refresh_token(user.id),
        user_id=user.id,
        role=user.role.value,
        tenant_id=user.tenant_id,
        tenant_name=tenant_name,
    )


# ── Auth Endpoints ──────────────────────────────────────────────────────────


@app.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # Find or create tenant
    tenant_name = req.tenant_name or "default"
    result = await db.execute(select(Tenant).where(Tenant.name == tenant_name))
    tenant = result.scalar_one_or_none()
    if not tenant:
        tenant = Tenant(name=tenant_name, plan=Plan.free)
        db.add(tenant)
        await db.flush()

    # Lock tenant row + check limit in the same transaction to close a
    # TOCTOU where two concurrent registrations could both pass the guard.
    tenant = await _lock_tenant(db, tenant.id)
    limits = tenant.effective_limits
    if limits["max_users"] > 0:
        user_count_result = await db.execute(
            select(func.count()).select_from(User).where(User.tenant_id == tenant.id)
        )
        if user_count_result.scalar() >= limits["max_users"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Tenant user limit reached ({limits['max_users']})")

    # First user in a non-default tenant becomes admin
    user_count = await db.execute(select(User).where(User.tenant_id == tenant.id))
    is_first = not user_count.scalars().first()
    role = Role.admin if (is_first and tenant_name != "default") else Role.free

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        role=role,
        tenant_id=tenant.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return _login_response(user, tenant.name)


@app.post("/login", response_model=LoginResponse)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    tenant = await db.get(Tenant, user.tenant_id)
    return _login_response(user, tenant.name)


@app.post("/refresh", response_model=LoginResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(req.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")

    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    tenant = await db.get(Tenant, user.tenant_id)
    return _login_response(user, tenant.name)


@app.get("/me", response_model=UserResponse)
async def me(user: User = Depends(_get_current_user)):
    return UserResponse(
        id=user.id, email=user.email, role=user.role.value,
        tenant_id=user.tenant_id, is_active=user.is_active,
    )


# ── API Key Management ──────────────────────────────────────────────────────


@app.post("/api-keys", response_model=APIKeyResponse)
async def create_api_key(
    req: APIKeyCreate,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Lock the tenant row so key-limit check + insert are serialised.
    tenant = await _lock_tenant(db, user.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    limits = tenant.effective_limits

    # Master keys can only be created by admins
    if req.is_master and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can create master keys")

    # Check tenant-wide key limit (0 = unlimited)
    max_keys = limits["max_keys"]
    if max_keys > 0:
        result = await db.execute(
            select(func.count()).select_from(APIKey).where(
                APIKey.tenant_id == user.tenant_id, APIKey.is_active == True
            )
        )
        if result.scalar() >= max_keys:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Tenant key limit reached ({max_keys}). Upgrade plan for more.",
            )

    # Free plan users: max 1 personal key (tenant already locked above)
    if not req.is_master:
        if tenant.plan == Plan.free:
            result = await db.execute(
                select(func.count()).select_from(APIKey).where(
                    APIKey.created_by == user.id, APIKey.is_master == False, APIKey.is_active == True
                )
            )
            if result.scalar() >= 1:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Free plan: 1 personal key max. Upgrade for more.",
                )

    key = generate_api_key()
    api_key = APIKey(
        key=None,  # plaintext returned once below, never persisted
        key_hash=hash_api_key(key),
        key_prefix=key[:8],
        name=req.name,
        tenant_id=user.tenant_id, created_by=user.id,
        is_master=req.is_master,
        rate_limit=limits["rate_limit"],
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return APIKeyResponse(
        id=api_key.id, name=api_key.name, key=key,
        is_master=api_key.is_master, rate_limit=api_key.rate_limit,
        tenant_id=api_key.tenant_id, created_at=api_key.created_at.isoformat(),
    )


@app.get("/api-keys")
async def list_api_keys(
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    # Users see: their own keys + master keys in their tenant
    stmt = select(APIKey).where(
        APIKey.tenant_id == user.tenant_id,
        APIKey.is_active == True,
    )
    # ponytail: limit/offset applied in SQL, before the non-admin Python
    # own+master filter below — a page may thus return < limit rows for
    # non-admins. Default (None) keeps the current "return all" behavior.
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    keys = (await db.execute(stmt)).scalars().all()
    # Non-admins only see their own personal keys + all master keys
    if user.role != Role.admin:
        keys = [k for k in keys if k.is_master or k.created_by == user.id]

    return {
        "keys": [
            {
                "id": k.id, "name": k.name,
                # Plaintext is no longer stored — only ever expose the prefix.
                "key": (k.key_prefix or "") + "…",
                "is_master": k.is_master, "rate_limit": k.rate_limit,
                "created_at": k.created_at.isoformat(),
                "is_own": k.created_by == user.id,
            }
            for k in keys
        ]
    }


@app.delete("/api-keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    api_key = await db.get(APIKey, key_id)
    if not api_key or api_key.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    # Master keys: only admins can revoke
    if api_key.is_master and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can revoke master keys")
    # Personal keys: only owner or admin
    if not api_key.is_master and user.role != Role.admin and api_key.created_by != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only revoke your own keys")
    api_key.is_active = False
    await db.commit()
    return {"status": "revoked"}


# ── API Key Validation (called by other services) ───────────────────────────


@app.post("/validate-key", dependencies=[Depends(_require_internal)])
async def validate_api_key(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    db: AsyncSession = Depends(get_db),
):
    """Validate an API key submitted via ``Authorization: Bearer <key>``.

    Internal endpoint, called by the API service. The key is intentionally
    NOT in the URL path so it doesn't end up in proxy access logs.
    """
    key = credentials.credentials
    result = await db.execute(select(APIKey).where(APIKey.key_hash == hash_api_key(key), APIKey.is_active == True))
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API key")

    tenant = await db.get(Tenant, api_key.tenant_id)
    return {
        "valid": True,
        "tenant_id": api_key.tenant_id,
        "tenant_name": tenant.name if tenant else None,
        "key_name": api_key.name,
        "is_master": api_key.is_master,
        "rate_limit": api_key.rate_limit,
    }


# ── Tenant & Plan Info ──────────────────────────────────────────────────────


@app.get("/tenant", response_model=TenantResponse)
async def get_tenant(
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, user.tenant_id)
    user_count = (await db.execute(
        select(func.count()).select_from(User).where(User.tenant_id == tenant.id)
    )).scalar()
    key_count = (await db.execute(
        select(func.count()).select_from(APIKey).where(
            APIKey.tenant_id == tenant.id, APIKey.is_active == True
        )
    )).scalar()

    return TenantResponse(
        id=tenant.id, name=tenant.name, plan=tenant.plan.value,
        is_active=tenant.is_active,
        user_count=user_count, key_count=key_count,
        limits=tenant.effective_limits,
    )


@app.get("/plans")
async def list_plans():
    return {
        "plans": {p.value: v for p, v in PLAN_LIMITS.items()}
    }


# ── Admin: User Management ──────────────────────────────────────────────────


@app.get("/admin/users")
async def list_users(
    user: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    stmt = select(User).where(User.tenant_id == user.tenant_id)
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    users = (await db.execute(stmt)).scalars().all()
    return {
        "users": [
            UserResponse(
                id=u.id, email=u.email, role=u.role.value,
                tenant_id=u.tenant_id, is_active=u.is_active,
            ).model_dump()
            for u in users
        ]
    }


async def _resolve_target_user(user_id: str, admin: User, db: AsyncSession) -> User:
    """Find target user. Super admins can access any tenant, regular admins only their own."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    admin_tenant = await db.get(Tenant, admin.tenant_id)
    if admin_tenant.name != "default" and target.tenant_id != admin.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return target


@app.patch("/admin/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    req: RoleUpdate,
    admin: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
):
    target = await _resolve_target_user(user_id, admin, db)
    target.role = req.role
    await db.commit()
    return {"status": "updated", "user_id": user_id, "new_role": req.role.value}


@app.patch("/admin/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: str,
    admin: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
):
    target = await _resolve_target_user(user_id, admin, db)
    if target.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot deactivate yourself")
    target.is_active = False
    await db.commit()
    return {"status": "deactivated", "user_id": user_id}


@app.patch("/admin/users/{user_id}/activate")
async def activate_user(
    user_id: str,
    admin: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
):
    target = await _resolve_target_user(user_id, admin, db)
    target.is_active = True
    await db.commit()
    return {"status": "activated", "user_id": user_id}


@app.post("/admin/users", response_model=UserResponse)
async def create_user(
    req: CreateUserRequest,
    admin: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # Determine tenant
    tenant_id = req.tenant_id or admin.tenant_id
    # Only super admin can create users in other tenants
    if tenant_id != admin.tenant_id:
        admin_tenant = await db.get(Tenant, admin.tenant_id)
        if admin_tenant.name != "default":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super admins can create users in other tenants")

    # Lock tenant row + check limit in the same transaction (TOCTOU guard).
    tenant = await _lock_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    limits = tenant.effective_limits
    if limits["max_users"] > 0:
        count = (await db.execute(
            select(func.count()).select_from(User).where(User.tenant_id == tenant_id)
        )).scalar()
        if count >= limits["max_users"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Tenant user limit reached ({limits['max_users']})")

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        role=req.role,
        tenant_id=tenant_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id, email=user.email, role=user.role.value,
        tenant_id=user.tenant_id, is_active=user.is_active,
    )


@app.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: User = Depends(_require_role(Role.admin)),
    db: AsyncSession = Depends(get_db),
):
    target = await _resolve_target_user(user_id, admin, db)
    if target.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete yourself")
    # Deactivate keys created by this user
    keys_result = await db.execute(select(APIKey).where(APIKey.created_by == user_id))
    for key in keys_result.scalars().all():
        key.is_active = False
    await db.delete(target)
    await db.commit()
    return {"status": "deleted", "user_id": user_id}


@app.patch("/admin/users/{user_id}/tenant")
async def move_user_to_tenant(
    user_id: str,
    tenant_id: str = Query(...),
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    new_tenant = await db.get(Tenant, tenant_id)
    if not new_tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target tenant not found")

    target.tenant_id = tenant_id
    await db.commit()
    return {"status": "moved", "user_id": user_id, "new_tenant_id": tenant_id}


# ── Super Admin: Tenant Management (default tenant admins only) ─────────────


@app.patch("/admin/tenants/{tenant_id}/plan")
async def update_tenant_plan(
    tenant_id: str,
    req: PlanUpdate,
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    tenant.plan = req.plan
    await db.commit()
    return {"status": "updated", "tenant_id": tenant_id, "new_plan": req.plan.value}


@app.get("/admin/tenants")
async def list_tenants(
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    stmt = select(Tenant)
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    tenants = (await db.execute(stmt)).scalars().all()

    # Two aggregated GROUP BY queries instead of 2 COUNTs per tenant (N+1).
    # ponytail: counts the full tables regardless of page — two queries total,
    # fine at tenant scale; scope to page tenant ids only if it ever isn't.
    user_counts = dict((await db.execute(
        select(User.tenant_id, func.count()).group_by(User.tenant_id)
    )).all())
    key_counts = dict((await db.execute(
        select(APIKey.tenant_id, func.count())
        .where(APIKey.is_active == True).group_by(APIKey.tenant_id)
    )).all())

    out = [
        TenantResponse(
            id=t.id, name=t.name, plan=t.plan.value, is_active=t.is_active,
            user_count=user_counts.get(t.id, 0), key_count=key_counts.get(t.id, 0),
            limits=t.effective_limits,
        ).model_dump()
        for t in tenants
    ]
    return {"tenants": out}


@app.post("/admin/tenants", response_model=TenantResponse)
async def create_tenant(
    req: TenantCreateRequest,
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Tenant).where(Tenant.name == req.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Tenant name already exists")

    tenant = Tenant(name=req.name, plan=req.plan)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)

    return TenantResponse(
        id=tenant.id, name=tenant.name, plan=tenant.plan.value,
        is_active=tenant.is_active, user_count=0, key_count=0,
        limits=tenant.effective_limits,
    )


@app.delete("/admin/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if tenant.name == "default":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete default tenant")

    # Check for remaining users
    user_count = (await db.execute(
        select(func.count()).select_from(User).where(User.tenant_id == tenant_id)
    )).scalar()
    if user_count > 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tenant still has {user_count} users. Remove them first.")

    # Deactivate keys
    keys = await db.execute(select(APIKey).where(APIKey.tenant_id == tenant_id))
    for key in keys.scalars().all():
        key.is_active = False

    tenant.is_active = False
    await db.commit()
    return {"status": "deleted", "tenant_id": tenant_id}


class TenantUpdateRequest(BaseModel):
    name: str | None = None
    plan: Plan | None = None
    custom_max_users: int | None = None   # None = use plan default, 0 = unlimited
    custom_max_keys: int | None = None
    custom_rate_limit: int | None = None
    clear_custom: bool = False  # set True to reset all custom overrides


@app.patch("/admin/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: str,
    req: TenantUpdateRequest,
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if req.name is not None:
        tenant.name = req.name
    if req.plan is not None:
        tenant.plan = req.plan
    if req.clear_custom:
        tenant.custom_max_users = None
        tenant.custom_max_keys = None
        tenant.custom_rate_limit = None
    else:
        if req.custom_max_users is not None:
            tenant.custom_max_users = req.custom_max_users
        if req.custom_max_keys is not None:
            tenant.custom_max_keys = req.custom_max_keys
        if req.custom_rate_limit is not None:
            tenant.custom_rate_limit = req.custom_rate_limit
    await db.commit()
    await db.refresh(tenant)
    return {
        "status": "updated",
        "tenant_id": tenant_id,
        "limits": tenant.effective_limits,
    }


# ── Super Admin: All Users (across tenants) ─────────────────────────────────


@app.get("/admin/all-users")
async def list_all_users(
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    stmt = select(User)
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    users = (await db.execute(stmt)).scalars().all()

    # Get tenant names
    tenants_result = await db.execute(select(Tenant))
    tenant_map = {t.id: t.name for t in tenants_result.scalars().all()}

    return {
        "users": [
            {
                **UserResponse(
                    id=u.id, email=u.email, role=u.role.value,
                    tenant_id=u.tenant_id, is_active=u.is_active,
                ).model_dump(),
                "tenant_name": tenant_map.get(u.tenant_id, "unknown"),
            }
            for u in users
        ]
    }


# ── Usage Logging (called by API service) ───────────────────────────────────


class UsageLogRequest(BaseModel):
    api_key: str
    endpoint: str
    method: str
    status_code: int


@app.post("/usage/log", dependencies=[Depends(_require_internal)])
async def log_usage(req: UsageLogRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(APIKey).where(APIKey.key_hash == hash_api_key(req.api_key), APIKey.is_active == True))
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")

    db.add(UsageLog(
        api_key_id=api_key.id,
        tenant_id=api_key.tenant_id,
        endpoint=req.endpoint,
        method=req.method,
        status_code=req.status_code,
    ))
    await db.commit()
    return {"status": "logged"}


@app.get("/usage/stats")
async def usage_stats(
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(days=1)

    # Base query: filter by tenant
    base = select(func.count()).select_from(UsageLog).where(UsageLog.tenant_id == user.tenant_id)

    # Non-admins: only their own keys
    if user.role != Role.admin:
        own_keys = select(APIKey.id).where(APIKey.created_by == user.id)
        base = base.where(UsageLog.api_key_id.in_(own_keys))

    total = (await db.execute(base)).scalar()
    last_hour = (await db.execute(base.where(UsageLog.created_at >= hour_ago))).scalar()
    last_day = (await db.execute(base.where(UsageLog.created_at >= day_ago))).scalar()

    # Per-key breakdown
    key_stats_q = (
        select(APIKey.id, APIKey.name, APIKey.is_master, func.count(UsageLog.id))
        .join(UsageLog, UsageLog.api_key_id == APIKey.id)
        .where(APIKey.tenant_id == user.tenant_id, UsageLog.created_at >= day_ago)
    )
    if user.role != Role.admin:
        key_stats_q = key_stats_q.where(APIKey.created_by == user.id)
    key_stats_q = key_stats_q.group_by(APIKey.id, APIKey.name, APIKey.is_master)

    key_rows = (await db.execute(key_stats_q)).all()

    return {
        "total_requests": total,
        "requests_last_hour": last_hour,
        "requests_last_24h": last_day,
        "keys": [
            {"id": r[0], "name": r[1], "is_master": r[2], "requests_24h": r[3]}
            for r in key_rows
        ],
    }


@app.get("/usage/rate-state", dependencies=[Depends(_require_internal)])
async def rate_state(db: AsyncSession = Depends(get_db)):
    """Return per-key request counts for the last hour. Used by API service on startup to restore rate limit state.

    The API limiter keys buckets by the raw plaintext key, which we no longer
    store, so this best-effort restore can no longer be reconstructed here and
    returns nothing. Redis remains the primary source of live counts.
    ponytail: dead restore until the API service keys its limiter by key_hash
    (cross-service change, out of scope for auth-only); Redis covers the gap.
    """
    return {"keys": {}}


# ── Detection Results (called by API service + queried by Studio) ───────────


class DetectionSaveRequest(BaseModel):
    api_key: str
    image_id: str
    endpoint: str
    model_name: str
    detections: list[dict]
    original_path: str | None = None
    censored_path: str | None = None


@app.post("/detections", dependencies=[Depends(_require_internal)])
async def save_detection(req: DetectionSaveRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(APIKey).where(APIKey.key_hash == hash_api_key(req.api_key), APIKey.is_active == True))
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")

    import json as json_mod

    db.add(DetectionResult(
        image_id=req.image_id,
        api_key_id=api_key.id,
        tenant_id=api_key.tenant_id,
        user_id=api_key.created_by,
        endpoint=req.endpoint,
        model_name=req.model_name,
        detections_json=json_mod.dumps(req.detections),
        original_path=req.original_path,
        censored_path=req.censored_path,
    ))
    await db.commit()
    return {"status": "saved"}


@app.get("/detections")
async def list_detections(
    limit: int = Query(50, le=200),
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import json as json_mod

    query = select(DetectionResult).where(DetectionResult.tenant_id == user.tenant_id)

    # Non-admins only see their own detections
    if user.role != Role.admin:
        own_keys = select(APIKey.id).where(APIKey.created_by == user.id)
        query = query.where(DetectionResult.api_key_id.in_(own_keys))

    query = query.order_by(DetectionResult.created_at.desc()).limit(limit)
    result = await db.execute(query)
    rows = result.scalars().all()

    return {
        "detections": [
            {
                "id": r.id,
                "image_id": r.image_id,
                "endpoint": r.endpoint,
                "model_name": r.model_name,
                "detections": json_mod.loads(r.detections_json),
                "original_path": r.original_path,
                "censored_path": r.censored_path,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


# ── Demo Usage (called by API service + queried by super admin) ─────────────


class DemoLogRequest(BaseModel):
    ip: str
    endpoint: str
    model: str
    image_count: int = 1


@app.get("/demo/key", dependencies=[Depends(_require_internal)])
async def get_demo_key():
    """Return the demo system API key (used by API service for demo requests)."""
    if not _demo_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Demo account not ready")
    return {"key": _demo_api_key}


@app.post("/demo/log", dependencies=[Depends(_require_internal)])
async def log_demo_usage(req: DemoLogRequest, db: AsyncSession = Depends(get_db)):
    db.add(DemoLog(
        ip=req.ip, endpoint=req.endpoint,
        model_name=req.model, image_count=req.image_count,
    ))
    await db.commit()
    return {"status": "logged"}


@app.get("/demo/stats")
async def demo_stats(
    admin: User = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Demo usage stats — super admin only."""
    now = datetime.now(timezone.utc)
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(days=1)

    total = (await db.execute(select(func.count()).select_from(DemoLog))).scalar()
    last_hour = (await db.execute(
        select(func.count()).select_from(DemoLog).where(DemoLog.created_at >= hour_ago)
    )).scalar()
    last_day = (await db.execute(
        select(func.count()).select_from(DemoLog).where(DemoLog.created_at >= day_ago)
    )).scalar()
    total_images = (await db.execute(
        select(func.sum(DemoLog.image_count)).where(DemoLog.created_at >= day_ago)
    )).scalar() or 0

    # Per-IP breakdown (last 24h)
    ip_stats = (await db.execute(
        select(DemoLog.ip, func.count(DemoLog.id), func.sum(DemoLog.image_count))
        .where(DemoLog.created_at >= day_ago)
        .group_by(DemoLog.ip)
        .order_by(func.count(DemoLog.id).desc())
        .limit(50)
    )).all()

    return {
        "total_requests": total,
        "requests_last_hour": last_hour,
        "requests_last_24h": last_day,
        "images_last_24h": total_images,
        "unique_ips_24h": len(ip_stats),
        "top_ips": [
            {"ip": r[0], "requests": r[1], "images": r[2]}
            for r in ip_stats
        ],
    }


# ── Cross-Tenant Detail Views (super admin) ─────────────────────────────────


@app.get("/admin/tenants/{tenant_id}/users")
async def tenant_users(tenant_id: str, admin: User = Depends(_require_super_admin), db: AsyncSession = Depends(get_db), limit: int | None = Query(None, ge=1), offset: int = Query(0, ge=0)):
    stmt = select(User).where(User.tenant_id == tenant_id)
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return {"users": [UserResponse(id=u.id, email=u.email, role=u.role.value, tenant_id=u.tenant_id, is_active=u.is_active).model_dump() for u in (await db.execute(stmt)).scalars().all()]}


@app.get("/admin/tenants/{tenant_id}/usage")
async def tenant_usage(tenant_id: str, admin: User = Depends(_require_super_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    hour_ago, day_ago = now - timedelta(hours=1), now - timedelta(days=1)
    base = select(func.count()).select_from(UsageLog).where(UsageLog.tenant_id == tenant_id)
    total = (await db.execute(base)).scalar()
    last_hour = (await db.execute(base.where(UsageLog.created_at >= hour_ago))).scalar()
    last_day = (await db.execute(base.where(UsageLog.created_at >= day_ago))).scalar()
    key_stats = (await db.execute(
        select(APIKey.id, APIKey.name, APIKey.is_master, func.count(UsageLog.id))
        .join(UsageLog, UsageLog.api_key_id == APIKey.id)
        .where(APIKey.tenant_id == tenant_id, UsageLog.created_at >= day_ago)
        .group_by(APIKey.id, APIKey.name, APIKey.is_master)
    )).all()
    return {"tenant_id": tenant_id, "total_requests": total, "requests_last_hour": last_hour, "requests_last_24h": last_day,
            "keys": [{"id": r[0], "name": r[1], "is_master": r[2], "requests_24h": r[3]} for r in key_stats]}


@app.get("/admin/tenants/{tenant_id}/detections")
async def tenant_detections(tenant_id: str, limit: int = Query(50, le=200), admin: User = Depends(_require_super_admin), db: AsyncSession = Depends(get_db)):
    import json as json_mod
    result = await db.execute(select(DetectionResult).where(DetectionResult.tenant_id == tenant_id).order_by(DetectionResult.created_at.desc()).limit(limit))
    return {"detections": [{"id": r.id, "image_id": r.image_id, "endpoint": r.endpoint, "model_name": r.model_name,
            "detections": json_mod.loads(r.detections_json), "original_path": r.original_path, "censored_path": r.censored_path,
            "created_at": r.created_at.isoformat()} for r in result.scalars().all()]}


@app.get("/admin/tenants/{tenant_id}/keys")
async def tenant_keys(tenant_id: str, admin: User = Depends(_require_super_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(APIKey).where(APIKey.tenant_id == tenant_id, APIKey.is_active == True))
    return {"keys": [{"id": k.id, "name": k.name, "key": (k.key_prefix or "") + "…", "is_master": k.is_master, "rate_limit": k.rate_limit,
            "created_at": k.created_at.isoformat()} for k in result.scalars().all()]}


@app.get("/admin/users/{user_id}/details")
async def user_details(user_id: str, admin: User = Depends(_require_super_admin), db: AsyncSession = Depends(get_db)):
    import json as json_mod
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    keys = (await db.execute(select(APIKey).where(APIKey.created_by == user_id, APIKey.is_active == True))).scalars().all()
    day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    own_key_ids = select(APIKey.id).where(APIKey.created_by == user_id)
    usage_24h = (await db.execute(select(func.count()).select_from(UsageLog).where(UsageLog.api_key_id.in_(own_key_ids), UsageLog.created_at >= day_ago))).scalar()
    dets = (await db.execute(select(DetectionResult).where(DetectionResult.user_id == user_id).order_by(DetectionResult.created_at.desc()).limit(50))).scalars().all()
    tenant = await db.get(Tenant, target.tenant_id)
    return {
        "user": UserResponse(id=target.id, email=target.email, role=target.role.value, tenant_id=target.tenant_id, is_active=target.is_active).model_dump(),
        "tenant_name": tenant.name if tenant else None,
        "keys": [{"id": k.id, "name": k.name, "key": (k.key_prefix or "") + "…", "is_master": k.is_master, "rate_limit": k.rate_limit} for k in keys],
        "usage_24h": usage_24h,
        "detections": [{"id": d.id, "image_id": d.image_id, "endpoint": d.endpoint, "model_name": d.model_name,
                "detections": json_mod.loads(d.detections_json), "original_path": d.original_path, "censored_path": d.censored_path,
                "created_at": d.created_at.isoformat()} for d in dets],
    }


# ── Webhooks ────────────────────────────────────────────────────────────────


import secrets as _secrets


class WebhookCreate(BaseModel):
    name: str
    url: str
    trigger_endpoint: WebhookTrigger = WebhookTrigger.any
    trigger_threshold: str = "any_detection"
    enabled: bool = True
    api_key_id: str | None = None  # null = tenant-wide


class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    trigger_endpoint: WebhookTrigger | None = None
    trigger_threshold: str | None = None
    enabled: bool | None = None
    api_key_id: str | None = None


def _webhook_public(w: WebhookEndpoint, include_secret: bool = False) -> dict:
    out = {
        "id": w.id,
        "tenant_id": w.tenant_id,
        "api_key_id": w.api_key_id,
        "name": w.name,
        "url": w.url,
        "enabled": w.enabled,
        "trigger_endpoint": w.trigger_endpoint.value,
        "trigger_threshold": w.trigger_threshold,
        "created_at": w.created_at.isoformat(),
        "updated_at": w.updated_at.isoformat(),
    }
    if include_secret:
        out["secret"] = w.secret
    return out


@app.get("/webhooks")
async def list_webhooks(
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.tenant_id == user.tenant_id))
    hooks = result.scalars().all()
    if user.role != Role.admin:
        # Non-admins: only webhooks tied to their own keys
        own_keys = (await db.execute(select(APIKey.id).where(APIKey.created_by == user.id))).scalars().all()
        own_keys_set = set(own_keys)
        hooks = [h for h in hooks if h.api_key_id is None or h.api_key_id in own_keys_set]
    return {"webhooks": [_webhook_public(h) for h in hooks]}


@app.post("/webhooks")
async def create_webhook(
    req: WebhookCreate,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await validate_webhook_url(req.url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    # Tenant-wide webhooks require admin
    if req.api_key_id is None and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can create tenant-wide webhooks")
    if req.api_key_id:
        key = await db.get(APIKey, req.api_key_id)
        if not key or key.tenant_id != user.tenant_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
        if user.role != Role.admin and key.created_by != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only attach webhooks to your own keys")

    hook = WebhookEndpoint(
        tenant_id=user.tenant_id,
        api_key_id=req.api_key_id,
        name=req.name,
        url=req.url,
        secret=_secrets.token_hex(32),  # 32 bytes -> 64 hex chars
        enabled=req.enabled,
        trigger_endpoint=req.trigger_endpoint,
        trigger_threshold=req.trigger_threshold,
    )
    db.add(hook)
    await db.commit()
    await db.refresh(hook)
    return _webhook_public(hook, include_secret=True)  # return secret ONCE


async def _resolve_webhook(webhook_id: str, user: User, db: AsyncSession) -> WebhookEndpoint:
    hook = await db.get(WebhookEndpoint, webhook_id)
    if not hook or hook.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook not found")
    if user.role != Role.admin:
        if hook.api_key_id is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Tenant-wide webhook — admin only")
        key = await db.get(APIKey, hook.api_key_id)
        if not key or key.created_by != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only manage your own webhooks")
    return hook


@app.patch("/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: str,
    req: WebhookUpdate,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hook = await _resolve_webhook(webhook_id, user, db)
    if req.url is not None:
        try:
            await validate_webhook_url(req.url)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        hook.url = req.url
    if req.name is not None:
        hook.name = req.name
    if req.trigger_endpoint is not None:
        hook.trigger_endpoint = req.trigger_endpoint
    if req.trigger_threshold is not None:
        hook.trigger_threshold = req.trigger_threshold
    if req.enabled is not None:
        hook.enabled = req.enabled
    if req.api_key_id is not None:
        if req.api_key_id == "" :
            # Explicit clear -> tenant-wide (admin only)
            if user.role != Role.admin:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can set tenant-wide")
            hook.api_key_id = None
        else:
            key = await db.get(APIKey, req.api_key_id)
            if not key or key.tenant_id != user.tenant_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
            hook.api_key_id = req.api_key_id
    await db.commit()
    await db.refresh(hook)
    return _webhook_public(hook)


@app.delete("/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: str,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hook = await _resolve_webhook(webhook_id, user, db)
    await db.delete(hook)
    await db.commit()
    return {"status": "deleted", "webhook_id": webhook_id}


@app.post("/webhooks/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import hashlib
    import hmac
    import json as json_mod
    import time

    import httpx

    hook = await _resolve_webhook(webhook_id, user, db)
    try:
        await validate_webhook_url(hook.url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    payload = {"event": "test", "webhook_id": hook.id, "timestamp": int(time.time())}
    body = json_mod.dumps(payload, separators=(",", ":"))
    sig = hmac.new(hook.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": f"sha256={sig}",
        "X-Webhook-Timestamp": str(payload["timestamp"]),
        "X-Webhook-Event": "test",
    }

    response_status = None
    response_body = None
    succeeded = False
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            resp = await client.post(hook.url, content=body, headers=headers)
            response_status = resp.status_code
            response_body = resp.text[:2000]
            succeeded = 200 <= resp.status_code < 300
    except Exception as e:
        response_body = f"error: {e}"[:2000]

    db.add(WebhookDelivery(
        endpoint_id=hook.id,
        event_type="test",
        payload_json=body,
        response_status=response_status,
        response_body=response_body,
        attempt=1,
        succeeded=succeeded,
    ))
    await db.commit()
    return {
        "succeeded": succeeded,
        "response_status": response_status,
        "response_body": response_body,
    }


@app.get("/webhooks/{webhook_id}/deliveries")
async def list_webhook_deliveries(
    webhook_id: str,
    limit: int = Query(20, le=100),
    user: User = Depends(_get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hook = await _resolve_webhook(webhook_id, user, db)
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == hook.id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
    )
    return {
        "deliveries": [
            {
                "id": d.id,
                "event_type": d.event_type,
                "response_status": d.response_status,
                "response_body": d.response_body,
                "attempt": d.attempt,
                "succeeded": d.succeeded,
                "created_at": d.created_at.isoformat(),
                "next_retry_at": d.next_retry_at.isoformat() if d.next_retry_at else None,
            }
            for d in result.scalars().all()
        ]
    }


# Internal: called by API service to fetch endpoints for a given key. The key
# stays in the Authorization header so it cannot leak into proxy access logs.
@app.post("/webhooks/by-key", dependencies=[Depends(_require_internal)])
async def webhooks_by_key(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    db: AsyncSession = Depends(get_db),
):
    key = credentials.credentials
    key_row = (await db.execute(select(APIKey).where(APIKey.key_hash == hash_api_key(key), APIKey.is_active == True))).scalar_one_or_none()
    if not key_row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.tenant_id == key_row.tenant_id,
            WebhookEndpoint.enabled == True,
        )
    )
    hooks = [h for h in result.scalars().all() if h.api_key_id is None or h.api_key_id == key_row.id]
    return {
        "tenant_id": key_row.tenant_id,
        "webhooks": [
            {
                "id": h.id,
                "url": h.url,
                "secret": h.secret,
                "trigger_endpoint": h.trigger_endpoint.value,
                "trigger_threshold": h.trigger_threshold,
            }
            for h in hooks
        ],
    }


class WebhookDeliveryLog(BaseModel):
    endpoint_id: str
    event_type: str
    payload_json: str
    response_status: int | None = None
    response_body: str | None = None
    attempt: int = 1
    succeeded: bool = False


@app.post("/webhooks/deliveries", dependencies=[Depends(_require_internal)])
async def log_webhook_delivery(req: WebhookDeliveryLog, db: AsyncSession = Depends(get_db)):
    """Internal: called by API service to record delivery attempts."""
    db.add(WebhookDelivery(
        endpoint_id=req.endpoint_id,
        event_type=req.event_type,
        payload_json=req.payload_json,
        response_status=req.response_status,
        response_body=(req.response_body or "")[:2000] if req.response_body else None,
        attempt=req.attempt,
        succeeded=req.succeeded,
    ))
    await db.commit()
    return {"status": "logged"}
