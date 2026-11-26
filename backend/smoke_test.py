from __future__ import annotations

import tempfile
import time
from pathlib import Path


def main() -> None:
    # Use an isolated temp cwd so sqlite:///./dev.db does not touch real data.
    with tempfile.TemporaryDirectory(prefix="ams-smoke-") as tmp:
        tmp_path = Path(tmp)

        # Import after cwd selection so DB path is isolated.
        import os

        os.chdir(tmp_path)

        from app.migration_runner import apply_migrations
        from app.db import SessionLocal
        from app.models import User
        from app.bootstrap import get_bootstrap_token
        from app.routes import admin, users
        from app.schemas import LoginIn, LoginProofIn

        apply_migrations()
        db = SessionLocal()

        try:
            status = admin.bootstrap_status(db=db)
            assert status["needs_bootstrap"] is True, status

            uname = f"admin_smoke_{int(time.time())}"
            email = f"{uname}@example.com"

            claim = admin.BootstrapClaimIn(
                token=get_bootstrap_token(),
                username=uname,
                email=email,
                password_salt="AA==",
                password_verifier="AA==",
                rek_ciphertext="AA==",
                rek_nonce="AA==",
                public_key="AA==",
            )
            claim_resp = admin.bootstrap_claim(body=claim, db=db)
            assert claim_resp.get("success") is True, claim_resp

            material_resp = users.login_material(body=LoginIn(username=uname), db=db)
            login_resp = users.login_proof(
                body=LoginProofIn(username=uname, verifier_proof="AA=="),
                db=db,
            )
            assert login_resp.success is True
            assert login_resp.token

            user = db.query(User).filter(User.user_id == login_resp.user.user_id).first()
            assert user is not None

            failure_body = users.ReportDecryptFailureIn(stage="smoke_test_stage", reason="simulated")
            fail_resp = users.report_decrypt_failure(body=failure_body, db=db, user=user)
            assert fail_resp.get("success") is True, fail_resp

            audit_rows = admin.audit(limit=100, offset=0, db=db, _=user)
            assert any(r.get("action_type") == "DECRYPT_FAILURE" for r in audit_rows), audit_rows

            users_list = admin.list_users(limit=100, offset=0, db=db, _=user)
            assert users_list and users_list[0].get("role") == "admin", users_list

            print("ROUTE_SMOKE_OK")
            print(f"user_id={user.user_id}")
            print(f"audit_rows={len(audit_rows)}")
        finally:
            db.close()


if __name__ == "__main__":
    main()
