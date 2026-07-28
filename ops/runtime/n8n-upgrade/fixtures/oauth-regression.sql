\set ON_ERROR_STOP on
BEGIN;

INSERT INTO n8n_runtime."user" (id,email,"firstName","lastName",password,"roleSlug",disabled,"mfaEnabled")
VALUES ('11111111-1111-4111-8111-111111111111','synthetic@example.invalid','Synthetic','Audit',NULL,'global:member',false,false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO n8n_runtime.oauth_clients (id,name,"redirectUris","grantTypes","clientSecret","tokenEndpointAuthMethod")
VALUES ('audit-client-2325','Synthetic Audit Client','["http://127.0.0.1/callback"]','["authorization_code","refresh_token"]',NULL,'none')
ON CONFLICT (id) DO NOTHING;

INSERT INTO n8n_runtime.oauth_user_consents ("userId","clientId","grantedAt",scope)
VALUES ('11111111-1111-4111-8111-111111111111','audit-client-2325',1000,'["openid","mcp:read","mcp:tools"]')
ON CONFLICT ("userId","clientId") DO UPDATE SET "grantedAt"=excluded."grantedAt", scope=excluded.scope;
INSERT INTO n8n_runtime.oauth_user_consents ("userId","clientId","grantedAt",scope)
VALUES ('11111111-1111-4111-8111-111111111111','audit-client-2325',2000,'["openid","mcp:read","mcp:tools"]')
ON CONFLICT ("userId","clientId") DO UPDATE SET "grantedAt"=excluded."grantedAt", scope=excluded.scope;

DO $$
DECLARE consent_count integer;
BEGIN
  SELECT count(*) INTO consent_count FROM n8n_runtime.oauth_user_consents
    WHERE "userId"='11111111-1111-4111-8111-111111111111' AND "clientId"='audit-client-2325';
  IF consent_count <> 1 THEN RAISE EXCEPTION 'oauth repeat did not remain idempotent'; END IF;
END $$;

INSERT INTO n8n_runtime.oauth_authorization_codes
(code,"clientId","userId","redirectUri","codeChallenge","codeChallengeMethod","expiresAt",scope)
VALUES ('audit-code-2325','audit-client-2325','11111111-1111-4111-8111-111111111111','http://127.0.0.1/callback','synthetic-challenge','S256',4102444800,'["openid","mcp:read"]');
INSERT INTO n8n_runtime.oauth_refresh_tokens (token,"clientId","userId","expiresAt",scope)
VALUES ('audit-refresh-2325','audit-client-2325','11111111-1111-4111-8111-111111111111',4102444800,'["openid","mcp:read"]');
INSERT INTO n8n_runtime.oauth_access_tokens (token,"clientId","userId")
VALUES ('audit-access-2325','audit-client-2325','11111111-1111-4111-8111-111111111111');
DELETE FROM n8n_runtime.oauth_access_tokens WHERE token='audit-access-2325';
DELETE FROM n8n_runtime.oauth_refresh_tokens WHERE token='audit-refresh-2325';
DELETE FROM n8n_runtime.oauth_authorization_codes WHERE code='audit-code-2325';

ROLLBACK;
SELECT 'oauth_regression=pass; transaction rolled back; no fixture retained' AS result;
