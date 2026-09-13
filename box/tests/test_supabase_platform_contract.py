import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "202608090001_platform_operations.sql"
EDGE_FUNCTION = ROOT / "supabase" / "functions" / "admin-create-user" / "index.ts"


class SupabasePlatformContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def function_body(self, name: str, next_name: str) -> str:
        start = self.sql.index(f"create or replace function public.{name}")
        end = self.sql.index(f"create or replace function public.{next_name}", start)
        return self.sql[start:end]

    def test_platform_operations_schema_is_present(self):
        self.assertIn("create table if not exists public.center_subscriptions", self.sql)
        self.assertIn("create table if not exists public.feature_flags", self.sql)
        self.assertIn("create table if not exists public.audit_logs", self.sql)
        self.assertIn("create or replace function public.platform_center_overview", self.sql)
        self.assertIn("last_login_at timestamptz", self.sql)
        self.assertIn("max(auth_user.last_sign_in_at)", self.sql)

    def test_audit_request_context_excludes_credentials(self):
        self.assertIn(
            "alter column request_context set default public.safe_request_context()",
            self.sql,
        )
        self.assertIn("request_headers ->> 'user-agent'", self.sql)
        self.assertNotIn("request_headers ->> 'authorization'", self.sql)

    def test_audit_log_is_immutable(self):
        self.assertIn("create trigger audit_logs_immutable", self.sql)
        self.assertIn("raise exception 'audit logs are immutable'", self.sql)

    def test_administrator_cannot_remove_own_access(self):
        body = self.function_body("admin_update_account", "update_member_profile")
        self.assertIn("cannot change the current account access", body)
        self.assertIn("coalesce(p_role, target.role) <> target.role", body)

    def test_center_and_subscription_status_gate_every_tenant_request(self):
        body = self.function_body("account_is_active", "require_platform_admin")
        self.assertIn("center_record.status = 'ACTIVE'", body)
        self.assertIn("subscription.status in ('TRIAL', 'ACTIVE')", body)
        self.assertIn("subscription.ends_at >= current_date", body)

    def test_platform_admin_cannot_mutate_member_profile_by_default(self):
        body = self.function_body("update_member_profile", "save_member_calibration")
        self.assertNotIn("actor.role <> 'PLATFORM_ADMIN'", body)
        self.assertIn("target.user_id <> actor.id", body)

    def test_platform_admin_cannot_save_member_calibration_by_default(self):
        start = self.sql.index("create or replace function public.save_member_calibration")
        end = self.sql.index("alter table public.center_subscriptions enable row level security", start)
        body = self.sql[start:end]
        self.assertNotIn("actor.role <> 'PLATFORM_ADMIN'", body)
        self.assertIn("profile.user_id <> actor.id", body)

    def test_training_mutation_policies_do_not_grant_platform_override(self):
        start = self.sql.index("create policy sessions_insert")
        end = self.sql.index("drop policy if exists labels_all", start)
        mutation_policies = self.sql[start:end]
        self.assertNotIn("PLATFORM_ADMIN", mutation_policies)

    def test_account_creation_checks_center_access_state(self):
        source = EDGE_FUNCTION.read_text(encoding="utf-8")
        self.assertIn('callerClient.rpc("account_is_active")', source)

    def test_public_center_owner_signup_requires_platform_provisioning(self):
        self.assertIn("create trigger before_auth_user_reject_unmanaged_owner", self.sql)
        self.assertIn("center owner accounts require platform provisioning", self.sql)
        self.assertIn("provisioning_nonce is null", self.sql)


if __name__ == "__main__":
    unittest.main()
